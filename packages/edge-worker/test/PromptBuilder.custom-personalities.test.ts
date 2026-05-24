import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CustomPersonalities,
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "agitha-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitService } from "../src/GitService.js";
import { PromptBuilder } from "../src/PromptBuilder.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

function makeSpyLogger(): ILogger & { warn: ReturnType<typeof vi.fn> } {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as unknown as ILogger & { warn: ReturnType<typeof vi.fn> };
}

const stubGitService = {} as GitService;

function makeRepo(
	id: string,
	overrides: Partial<RepositoryConfig> = {},
): RepositoryConfig {
	return {
		id,
		name: id,
		repositoryPath: "/tmp/repo",
		workspaceBaseDir: "/tmp/workspace",
		baseBranch: "main",
		linearWorkspaceId: "ws-1",
		...overrides,
	};
}

function makeBuilder(
	repositories: RepositoryConfig[],
	workspacePersonalities?: CustomPersonalities,
	logger: ILogger = silentLogger,
) {
	const repoMap = new Map(repositories.map((r) => [r.id, r]));
	return new PromptBuilder({
		logger,
		repositories: repoMap,
		issueTrackers: new Map<string, IIssueTrackerService>(),
		gitService: stubGitService,
		getWorkspaceCustomPersonalities: workspacePersonalities
			? () => workspacePersonalities
			: undefined,
	});
}

describe("PromptBuilder custom personalities", () => {
	let tmpDir: string;
	let reviewerPromptPath: string;
	let auditorPromptPath: string;

	beforeEach(async () => {
		tmpDir = join(
			tmpdir(),
			`agitha-personality-test-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });
		reviewerPromptPath = join(tmpDir, "reviewer.md");
		auditorPromptPath = join(tmpDir, "auditor.md");
		await writeFile(
			reviewerPromptPath,
			'<version-tag value="reviewer-1" />\n# Reviewer\nYou are a code reviewer.',
			"utf-8",
		);
		await writeFile(
			auditorPromptPath,
			"# Auditor\nYou are a security auditor.",
			"utf-8",
		);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("matches a per-repo custom personality and returns its config inline", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
					allowedTools: "readOnly",
					model: "claude-opus-4-7",
					description: "Review-only personality",
				},
			},
		});
		const builder = makeBuilder([repo]);

		const result = await builder.determineSystemPromptFromLabels(
			["code review"],
			[repo],
		);

		expect(result).toBeDefined();
		expect(result?.prompt).toContain("You are a code reviewer");
		expect(result?.version).toBe("reviewer-1");
		expect(result?.type).toBeUndefined();
		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(result?.customPersonality?.source).toBe("repository");
		expect(result?.customPersonality?.repositoryId).toBe("repo-a");
		expect(result?.customPersonality?.config.allowedTools).toBe("readOnly");
		expect(result?.customPersonality?.config.model).toBe("claude-opus-4-7");
	});

	it("falls back to workspace-wide personality when no per-repo match", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const builder = makeBuilder([repo], {
			"security-auditor": {
				labels: ["Security"],
				promptPath: auditorPromptPath,
				allowedTools: "safe",
			},
		});

		const result = await builder.determineSystemPromptFromLabels(
			["security"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("security-auditor");
		expect(result?.customPersonality?.source).toBe("workspace");
		expect(result?.customPersonality?.repositoryId).toBeUndefined();
		expect(result?.prompt).toContain("security auditor");
	});

	it("prefers per-repo personality over workspace-wide on label match", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Reviewer"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const builder = makeBuilder([repo], {
			reviewer: {
				labels: ["Reviewer"],
				promptPath: auditorPromptPath,
			},
		});

		const result = await builder.determineSystemPromptFromLabels(
			["Reviewer"],
			[repo],
		);

		expect(result?.customPersonality?.source).toBe("repository");
		expect(result?.prompt).toContain("You are a code reviewer");
	});

	it("matches case-insensitively against issue labels", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const builder = makeBuilder([repo]);

		const result = await builder.determineSystemPromptFromLabels(
			["CODE REVIEW"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("reviewer");
	});

	it("returns undefined when no custom personality or built-in matches", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Reviewer"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const builder = makeBuilder([repo]);

		const result = await builder.determineSystemPromptFromLabels(
			["bug"],
			[repo],
		);

		expect(result).toBeUndefined();
	});

	it("custom personalities run before built-in label matchers", async () => {
		const repo = makeRepo("repo-a", {
			labelPrompts: {
				debugger: { labels: ["Debug"] },
			},
			customPersonalities: {
				reviewer: {
					labels: ["Debug"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const builder = makeBuilder([repo]);

		const result = await builder.determineSystemPromptFromLabels(
			["Debug"],
			[repo],
		);

		// Even though "Debug" would match the built-in `debugger` prompt, the
		// custom personality declared on the same label wins.
		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(result?.type).toBeUndefined();
	});

	it("falls through to built-in matcher when custom prompt file cannot be read", async () => {
		const repo = makeRepo("repo-a", {
			labelPrompts: {
				debugger: { labels: ["Debug"] },
			},
			customPersonalities: {
				broken: {
					labels: ["Debug"],
					promptPath: join(tmpDir, "does-not-exist.md"),
				},
			},
		});
		const builder = makeBuilder([repo]);

		const result = await builder.determineSystemPromptFromLabels(
			["Debug"],
			[repo],
		);

		expect(result?.customPersonality).toBeUndefined();
		expect(result?.type).toBe("debugger");
	});

	it("warns when two per-repo personalities share a matching label (first wins)", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Review"],
					promptPath: reviewerPromptPath,
				},
				auditor: {
					labels: ["Review"],
					promptPath: auditorPromptPath,
				},
			},
		});
		const spyLogger = makeSpyLogger();
		const builder = makeBuilder([repo], undefined, spyLogger);

		const result = await builder.determineSystemPromptFromLabels(
			["Review"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(spyLogger.warn).toHaveBeenCalledTimes(1);
		const warnMessage = spyLogger.warn.mock.calls[0]?.[0] as string;
		expect(warnMessage).toContain("Custom personality conflict");
		expect(warnMessage).toContain("'auditor'");
		expect(warnMessage).toContain("repository:repo-a");
		expect(warnMessage).toContain("'reviewer'");
		expect(warnMessage).toContain("Review");
		expect(warnMessage).toContain("(first match wins)");
	});

	it("warns when workspace personality with different key would also match", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Review"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const spyLogger = makeSpyLogger();
		const builder = makeBuilder(
			[repo],
			{
				"security-auditor": {
					labels: ["Review"],
					promptPath: auditorPromptPath,
				},
			},
			spyLogger,
		);

		const result = await builder.determineSystemPromptFromLabels(
			["Review"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(result?.customPersonality?.source).toBe("repository");
		expect(spyLogger.warn).toHaveBeenCalledTimes(1);
		const warnMessage = spyLogger.warn.mock.calls[0]?.[0] as string;
		expect(warnMessage).toContain("Custom personality conflict");
		expect(warnMessage).toContain("'security-auditor'");
		expect(warnMessage).toContain("workspace");
		expect(warnMessage).toContain("'reviewer'");
		expect(warnMessage).toContain("repository:repo-a");
	});

	it("does not warn when workspace personality shares key with per-repo personality (precedence override)", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Review"],
					promptPath: reviewerPromptPath,
				},
			},
		});
		const spyLogger = makeSpyLogger();
		const builder = makeBuilder(
			[repo],
			{
				reviewer: {
					labels: ["Review"],
					promptPath: auditorPromptPath,
				},
			},
			spyLogger,
		);

		const result = await builder.determineSystemPromptFromLabels(
			["Review"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(result?.customPersonality?.source).toBe("repository");
		expect(spyLogger.warn).not.toHaveBeenCalled();
	});

	it("does not warn when only a single personality matches (baseline)", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Review"],
					promptPath: reviewerPromptPath,
				},
				auditor: {
					labels: ["Security"],
					promptPath: auditorPromptPath,
				},
			},
		});
		const spyLogger = makeSpyLogger();
		const builder = makeBuilder([repo], undefined, spyLogger);

		const result = await builder.determineSystemPromptFromLabels(
			["Review"],
			[repo],
		);

		expect(result?.customPersonality?.key).toBe("reviewer");
		expect(spyLogger.warn).not.toHaveBeenCalled();
	});

	describe("requireAllLabels", () => {
		it("matches only when every personality label is on the issue", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					"draft-article": {
						labels: ["Article", "Draft"],
						promptPath: reviewerPromptPath,
						requireAllLabels: true,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const matched = await builder.determineSystemPromptFromLabels(
				["Article", "Draft"],
				[repo],
			);
			expect(matched?.customPersonality?.key).toBe("draft-article");
		});

		it("does NOT match when only some labels are present", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					"draft-article": {
						labels: ["Article", "Draft"],
						promptPath: reviewerPromptPath,
						requireAllLabels: true,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				["Article"],
				[repo],
			);
			expect(result).toBeUndefined();
		});

		it("requireAllLabels=false (default) keeps any-label matching", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					"draft-article": {
						labels: ["Article", "Draft"],
						promptPath: reviewerPromptPath,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				["Article"],
				[repo],
			);
			expect(result?.customPersonality?.key).toBe("draft-article");
		});
	});

	describe("referenceDirs", () => {
		it("appends a <reference_context> block listing each dir to the prompt", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					"copy-writer": {
						labels: ["Article"],
						promptPath: reviewerPromptPath,
						referenceDirs: ["./content/voice", "./content/posts"],
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				["Article"],
				[repo],
			);

			expect(result?.prompt).toContain("<reference_context>");
			expect(result?.prompt).toContain("- ./content/voice");
			expect(result?.prompt).toContain("- ./content/posts");
			expect(result?.prompt).toContain("</reference_context>");
		});

		it("omits the block when referenceDirs is undefined or empty", async () => {
			const repoNone = makeRepo("repo-a", {
				customPersonalities: {
					reviewer: {
						labels: ["Article"],
						promptPath: reviewerPromptPath,
					},
				},
			});
			const repoEmpty = makeRepo("repo-b", {
				customPersonalities: {
					reviewer: {
						labels: ["Article"],
						promptPath: reviewerPromptPath,
						referenceDirs: [],
					},
				},
			});

			const noneResult = await makeBuilder([
				repoNone,
			]).determineSystemPromptFromLabels(["Article"], [repoNone]);
			const emptyResult = await makeBuilder([
				repoEmpty,
			]).determineSystemPromptFromLabels(["Article"], [repoEmpty]);

			expect(noneResult?.prompt).not.toContain("<reference_context>");
			expect(emptyResult?.prompt).not.toContain("<reference_context>");
		});
	});

	describe("[personality=...] description tag", () => {
		it("invokes the named personality regardless of labels", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					"copy-writer": {
						labels: ["Article"],
						promptPath: auditorPromptPath,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				[], // no labels
				[repo],
				"Some draft brief — [personality=copy-writer]",
			);

			expect(result?.customPersonality?.key).toBe("copy-writer");
			expect(result?.customPersonality?.source).toBe("repository");
		});

		it("overrides label matching when both would resolve to different personalities", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					reviewer: {
						labels: ["Code Review"],
						promptPath: reviewerPromptPath,
					},
					"copy-writer": {
						labels: ["Article"],
						promptPath: auditorPromptPath,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				["Code Review"],
				[repo],
				"[personality=copy-writer]",
			);

			expect(result?.customPersonality?.key).toBe("copy-writer");
		});

		it("falls back to label matching when the tag points to a non-existent personality (and warns)", async () => {
			const spyLogger = makeSpyLogger();
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					reviewer: {
						labels: ["Code Review"],
						promptPath: reviewerPromptPath,
					},
				},
			});
			const builder = new PromptBuilder({
				logger: spyLogger,
				repositories: new Map([[repo.id, repo]]),
				issueTrackers: new Map<string, IIssueTrackerService>(),
				gitService: stubGitService,
			});

			const result = await builder.determineSystemPromptFromLabels(
				["Code Review"],
				[repo],
				"[personality=does-not-exist]",
			);

			expect(result?.customPersonality?.key).toBe("reviewer");
			expect(spyLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("does-not-exist"),
			);
		});

		it("looks up workspace-wide personalities by name", async () => {
			const repo = makeRepo("repo-a");
			const builder = makeBuilder([repo], {
				"copy-writer": {
					labels: ["Article"],
					promptPath: auditorPromptPath,
				},
			});

			const result = await builder.determineSystemPromptFromLabels(
				[],
				[repo],
				"Brief: [personality=copy-writer]",
			);

			expect(result?.customPersonality?.key).toBe("copy-writer");
			expect(result?.customPersonality?.source).toBe("workspace");
		});

		it("ignores the tag when no description is provided", async () => {
			const repo = makeRepo("repo-a", {
				customPersonalities: {
					reviewer: {
						labels: ["Code Review"],
						promptPath: reviewerPromptPath,
					},
				},
			});
			const builder = makeBuilder([repo]);

			const result = await builder.determineSystemPromptFromLabels(
				["Code Review"],
				[repo],
				undefined,
			);

			expect(result?.customPersonality?.key).toBe("reviewer");
		});
	});
});
