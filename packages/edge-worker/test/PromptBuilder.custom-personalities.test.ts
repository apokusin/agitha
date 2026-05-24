import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CustomPersonalities,
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitService } from "../src/GitService.js";
import { PromptBuilder } from "../src/PromptBuilder.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

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
) {
	const repoMap = new Map(repositories.map((r) => [r.id, r]));
	return new PromptBuilder({
		logger: silentLogger,
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
			`cyrus-personality-test-${Date.now()}-${Math.random()
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
});
