import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "agitha-core";
import { describe, expect, it } from "vitest";
import type { GitService } from "../src/GitService.js";
import { LabelBasedSessionResolver } from "../src/LabelBasedSessionResolver.js";
import { PromptBuilder } from "../src/PromptBuilder.js";
import { ToolPermissionResolver } from "../src/ToolPermissionResolver.js";

/**
 * End-to-end smoke test for the two shipped personality examples in
 * `packages/edge-worker/examples/personalities/`. Loads the real markdown
 * files through the matcher / resolver pipeline that EdgeWorker uses in
 * production. This guards against regressions in the example prompts
 * themselves (e.g. someone deleting the version tag) and the personality
 * config shape (someone introducing a new required field).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = resolve(__dirname, "..", "examples", "personalities");

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

const stubGitService = {} as GitService;

function makeRepo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
	return {
		id: "blog-repo",
		name: "blog",
		repositoryPath: "/tmp/blog",
		workspaceBaseDir: "/tmp/workspace",
		baseBranch: "main",
		linearWorkspaceId: "ws-1",
		...overrides,
	};
}

function makeResolver(repo: RepositoryConfig) {
	const repoMap = new Map([[repo.id, repo]]);
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

describe("shipped personality examples", () => {
	describe("copy-writer", () => {
		const personalityPath = resolve(examplesDir, "copy-writer.md");
		const repo = makeRepo({
			customPersonalities: {
				"copy-writer": {
					labels: ["Article", "Draft"],
					requireAllLabels: true,
					promptPath: personalityPath,
					allowedTools: ["Read", "Glob", "Grep", "WebFetch", "Write"],
					writeScopes: ["./content/**"],
					referenceDirs: ["./content/voice", "./content/posts"],
					description: "Long-form content writer following house style",
				},
			},
		});

		it("does NOT match on 'Article' alone (requireAllLabels enforced)", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Article"],
				primaryRepository: repo,
			});
			expect(result.customPersonalityMatch).toBeUndefined();
		});

		it("matches when both 'Article' and 'Draft' are present", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Article", "Draft"],
				primaryRepository: repo,
			});
			expect(result.customPersonalityMatch?.key).toBe("copy-writer");
			expect(result.systemPrompt).toContain("House style");
			expect(result.systemPrompt).toContain("One idea per sentence");
		});

		it("expands bare Write into Write(./content/**) via writeScopes", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Article", "Draft"],
				primaryRepository: repo,
			});
			expect(result.allowedTools).toContain("Write(./content/**)");
			expect(result.allowedTools).not.toContain("Write");
			expect(result.allowedTools).toContain("Read");
		});

		it("appends a <reference_context> block listing the configured dirs", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Article", "Draft"],
				primaryRepository: repo,
			});
			expect(result.systemPrompt).toContain("<reference_context>");
			expect(result.systemPrompt).toContain("- ./content/voice");
			expect(result.systemPrompt).toContain("- ./content/posts");
		});

		it("is invokable via [personality=copy-writer] description tag without labels", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: [], // no labels — only the description tag triggers
				issueDescription:
					"Write a 600-word piece on our edge-networking work. [personality=copy-writer]",
				primaryRepository: repo,
			});
			expect(result.customPersonalityMatch?.key).toBe("copy-writer");
			expect(result.allowedTools).toContain("Write(./content/**)");
		});
	});

	describe("code-reviewer", () => {
		const personalityPath = resolve(examplesDir, "code-reviewer.md");
		const repo = makeRepo({
			customPersonalities: {
				"code-reviewer": {
					labels: ["Code Review", "PR Review"],
					promptPath: personalityPath,
					allowedTools: "readOnly",
					model: "claude-opus-4-7",
					description: "Read-only code review",
				},
			},
		});

		it("matches on either configured label (case-insensitive, any-match)", async () => {
			const resolver = makeResolver(repo);
			const a = await resolver.resolve({
				labels: ["Code Review"],
				primaryRepository: repo,
			});
			const b = await resolver.resolve({
				labels: ["pr review"],
				primaryRepository: repo,
			});
			expect(a.customPersonalityMatch?.key).toBe("code-reviewer");
			expect(b.customPersonalityMatch?.key).toBe("code-reviewer");
		});

		it("resolves the readOnly preset and excludes Write/Edit/Bash", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Code Review"],
				primaryRepository: repo,
			});
			expect(result.allowedTools.length).toBeGreaterThan(0);
			expect(result.allowedTools).not.toContain("Write");
			expect(result.allowedTools).not.toContain("Edit");
			expect(result.allowedTools).not.toContain("Bash");
		});

		it("carries the model override through to the personality config", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Code Review"],
				primaryRepository: repo,
			});
			expect(result.customPersonality?.model).toBe("claude-opus-4-7");
		});

		it("surfaces the description on the match for the activity poster", async () => {
			const resolver = makeResolver(repo);
			const result = await resolver.resolve({
				labels: ["Code Review"],
				primaryRepository: repo,
			});
			expect(result.customPersonalityMatch?.config.description).toBe(
				"Read-only code review",
			);
		});
	});
});
