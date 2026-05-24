import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "agitha-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitService } from "../src/GitService.js";
import { LabelBasedSessionResolver } from "../src/LabelBasedSessionResolver.js";
import { PromptBuilder } from "../src/PromptBuilder.js";
import { ToolPermissionResolver } from "../src/ToolPermissionResolver.js";

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

function makeResolver(repositories: RepositoryConfig[]) {
	const repoMap = new Map(repositories.map((r) => [r.id, r]));
	const promptBuilder = new PromptBuilder({
		logger: silentLogger,
		repositories: repoMap,
		issueTrackers: new Map<string, IIssueTrackerService>(),
		gitService: stubGitService,
	});
	const toolResolver = new ToolPermissionResolver(
		{ repositories: [], cyrusHome: "/tmp" } as never,
		silentLogger,
	);
	return new LabelBasedSessionResolver(
		promptBuilder,
		toolResolver,
		silentLogger,
	);
}

describe("LabelBasedSessionResolver", () => {
	let tmpDir: string;
	let reviewerPromptPath: string;

	beforeEach(async () => {
		tmpDir = join(
			tmpdir(),
			`agitha-resolver-test-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });
		reviewerPromptPath = join(tmpDir, "reviewer.md");
		await writeFile(
			reviewerPromptPath,
			"# Reviewer\nYou are a code reviewer.",
			"utf-8",
		);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("threads custom personality config through to tool resolution", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
					allowedTools: ["Read", "Grep"],
					disallowedTools: ["Bash"],
				},
			},
		});
		const resolver = makeResolver([repo]);

		const result = await resolver.resolve({
			labels: ["Code Review"],
			primaryRepository: repo,
		});

		expect(result.customPersonalityMatch?.key).toBe("reviewer");
		expect(result.customPersonality?.allowedTools).toEqual(["Read", "Grep"]);
		expect(result.allowedTools).toEqual(["Read", "Grep"]);
		expect(result.disallowedTools).toEqual(["Bash"]);
		expect(result.systemPrompt).toContain("You are a code reviewer");
	});

	it("skipLabelBasedPrompt bypasses system-prompt determination entirely", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
					allowedTools: ["Read", "Grep"],
				},
			},
		});
		const resolver = makeResolver([repo]);

		const result = await resolver.resolve({
			labels: ["Code Review"],
			primaryRepository: repo,
			skipLabelBasedPrompt: true,
		});

		expect(result.systemPromptResult).toBeUndefined();
		expect(result.customPersonality).toBeUndefined();
		expect(result.promptType).toBeUndefined();
		// Tools still resolved, but against the default chain (no personality override)
		expect(result.allowedTools.length).toBeGreaterThan(0);
		expect(result.allowedTools).not.toEqual(["Read", "Grep"]);
	});

	it("respects [personality=<key>] description tag", async () => {
		const repo = makeRepo("repo-a", {
			customPersonalities: {
				reviewer: {
					labels: ["Will Not Match"],
					promptPath: reviewerPromptPath,
					allowedTools: ["Read"],
				},
			},
		});
		const resolver = makeResolver([repo]);

		const result = await resolver.resolve({
			labels: [], // no labels — only the description tag should trigger
			issueDescription: "Brief: [personality=reviewer]",
			primaryRepository: repo,
		});

		expect(result.customPersonalityMatch?.key).toBe("reviewer");
		expect(result.allowedTools).toEqual(["Read"]);
	});

	it("returns empty resolution when no labels and no personality matches", async () => {
		const repo = makeRepo("repo-a");
		const resolver = makeResolver([repo]);

		const result = await resolver.resolve({
			labels: [],
			primaryRepository: repo,
		});

		expect(result.systemPromptResult).toBeUndefined();
		expect(result.customPersonality).toBeUndefined();
		expect(result.allowedTools.length).toBeGreaterThan(0);
		expect(result.disallowedTools).toEqual([]);
	});

	it("uses repositoriesForToolUnion for multi-repo tool resolution", async () => {
		const repoA = makeRepo("repo-a", { allowedTools: ["Read"] });
		const repoB = makeRepo("repo-b", { allowedTools: ["Write"] });
		const resolver = makeResolver([repoA, repoB]);

		const result = await resolver.resolve({
			labels: ["foo"], // no match — falls through to repo allowedTools
			primaryRepository: repoA,
			repositoriesForToolUnion: [repoA, repoB],
		});

		// Union of repoA + repoB tool surfaces
		expect(result.allowedTools).toContain("Read");
		expect(result.allowedTools).toContain("Write");
	});
});
