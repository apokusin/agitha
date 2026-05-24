import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomPersonalityConfig } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

// Mock dependencies BEFORE imports.
// Intentionally do NOT mock `fs/promises` — PromptBuilder loads personality
// markdown via `readFile`, and these tests rely on real files written into
// tmpdir() so the EdgeWorker → PromptBuilder pipeline runs end-to-end.
vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn(() => [
		"Read",
		"Edit",
		"Write",
		"Glob",
		"Grep",
		"Task",
		"WebFetch",
		"WebSearch",
	]),
	getReadOnlyTools: vi.fn(() => [
		"Read",
		"Glob",
		"Grep",
		"WebFetch",
		"WebSearch",
	]),
	getAllTools: vi.fn(() => [
		"Read",
		"Edit",
		"Write",
		"Glob",
		"Grep",
		"Bash",
		"Task",
		"WebFetch",
		"WebSearch",
	]),
}));
vi.mock("@linear/sdk");
vi.mock("cyrus-linear-event-transport");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");

import { LinearClient } from "@linear/sdk";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

describe("EdgeWorker - Custom Personalities Wiring", () => {
	let tmpDir: string;
	let reviewerPromptPath: string;
	let auditorPromptPath: string;
	let savedSlackBotToken: string | undefined;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Save and clear SLACK_BOT_TOKEN to ensure deterministic tool lists
		savedSlackBotToken = process.env.SLACK_BOT_TOKEN;
		delete process.env.SLACK_BOT_TOKEN;

		// Silence console
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Write real personality prompt files into tmpdir() so PromptBuilder's
		// readFile() succeeds and produces a real customPersonality match.
		tmpDir = join(
			tmpdir(),
			`cyrus-edgeworker-personality-test-${Date.now()}-${Math.random()
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

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
					getWebhookUrl: vi
						.fn()
						.mockReturnValue("http://localhost:3456/webhook"),
					setWebhookHandler: vi.fn(),
					setOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		// Mock AgentSessionManager
		vi.mocked(AgentSessionManager).mockImplementation(
			() =>
				({
					addSession: vi.fn(),
					getSession: vi.fn(),
					removeSession: vi.fn(),
					getAllSessions: vi.fn().mockReturnValue([]),
					clearAllSessions: vi.fn(),
					on: vi.fn(),
				}) as any,
		);

		// Mock LinearEventTransport
		vi.mocked(LinearEventTransport).mockImplementation(
			() =>
				({
					register: vi.fn(),
					on: vi.fn(),
					removeAllListeners: vi.fn(),
				}) as any,
		);

		// Mock LinearClient
		vi.mocked(LinearClient).mockImplementation(
			() =>
				({
					viewer: vi
						.fn()
						.mockResolvedValue({ id: "test-user", email: "test@example.com" }),
					issue: vi.fn(),
					comment: vi.fn(),
					createComment: vi.fn(),
					webhook: vi.fn(),
					webhooks: vi.fn(),
					createWebhook: vi.fn(),
					updateWebhook: vi.fn(),
					deleteWebhook: vi.fn(),
					user: vi.fn(),
				}) as any,
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();

		if (savedSlackBotToken === undefined) {
			delete process.env.SLACK_BOT_TOKEN;
		} else {
			process.env.SLACK_BOT_TOKEN = savedSlackBotToken;
		}

		await rm(tmpDir, { recursive: true, force: true });
	});

	function makeBaseRepo(): RepositoryConfig {
		return {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: "/test/repo",
			workspaceBaseDir: "/test/workspaces",
			baseBranch: "main",
			linearWorkspaceId: "test-workspace",
			isActive: true,
		};
	}

	function makeBaseConfig(
		overrides: Partial<EdgeWorkerConfig> = {},
	): EdgeWorkerConfig {
		return {
			proxyUrl: "http://localhost:3000",
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [makeBaseRepo()],
			linearWorkspaces: {
				"test-workspace": { linearToken: "test-token" },
			},
			...overrides,
		};
	}

	it("per-repo custom personality is matched by label and its tool overrides win", async () => {
		const repo: RepositoryConfig = {
			...makeBaseRepo(),
			customPersonalities: {
				reviewer: {
					labels: ["Code Review"],
					promptPath: reviewerPromptPath,
					allowedTools: ["Read", "Grep"],
					disallowedTools: ["Bash", "Write"],
				},
			},
		};

		const edgeWorker = new EdgeWorker(makeBaseConfig({ repositories: [repo] }));

		// 1. The personality should be matched by label (per-repo source).
		const determineSystemPromptFromLabels = (
			edgeWorker as any
		).determineSystemPromptFromLabels.bind(edgeWorker);
		const result = await determineSystemPromptFromLabels(["Code Review"], repo);

		expect(result).toBeDefined();
		expect(result.customPersonality).toBeDefined();
		expect(result.customPersonality.key).toBe("reviewer");
		expect(result.customPersonality.source).toBe("repository");
		expect(result.customPersonality.repositoryId).toBe("test-repo");
		expect(result.customPersonality.config.allowedTools).toEqual([
			"Read",
			"Grep",
		]);
		// type is undefined when a custom personality wins (built-in matchers
		// are bypassed).
		expect(result.type).toBeUndefined();

		// 2. The personality's allowedTools / disallowedTools must be threaded
		// into the EdgeWorker's tool resolvers verbatim — this is the wiring
		// the test is meant to pin.
		const personalityConfig: CustomPersonalityConfig =
			result.customPersonality.config;
		const buildAllowedTools = (edgeWorker as any).buildAllowedTools.bind(
			edgeWorker,
		);
		const buildDisallowedTools = (edgeWorker as any).buildDisallowedTools.bind(
			edgeWorker,
		);

		const allowed = buildAllowedTools(repo, undefined, personalityConfig);
		expect(allowed).toEqual(["Read", "Grep"]);

		const disallowed = buildDisallowedTools(repo, undefined, personalityConfig);
		expect(disallowed).toEqual(["Bash", "Write"]);

		// 3. Sanity check: omitting the personality returns a different tool
		// surface (proves the override is doing real work).
		const allowedWithoutPersonality = buildAllowedTools(repo, undefined);
		expect(allowedWithoutPersonality).not.toEqual(["Read", "Grep"]);
	});

	it("workspace-wide custom personality is picked up via top-level EdgeWorkerConfig", async () => {
		const repo = makeBaseRepo();
		// Per-repo personalities intentionally absent — the workspace map
		// supplies the personality instead.
		const edgeWorker = new EdgeWorker(
			makeBaseConfig({
				repositories: [repo],
				customPersonalities: {
					"security-auditor": {
						labels: ["Security"],
						promptPath: auditorPromptPath,
						allowedTools: "safe",
					},
				},
			}),
		);

		const determineSystemPromptFromLabels = (
			edgeWorker as any
		).determineSystemPromptFromLabels.bind(edgeWorker);
		const result = await determineSystemPromptFromLabels(["Security"], repo);

		expect(result).toBeDefined();
		expect(result.customPersonality).toBeDefined();
		expect(result.customPersonality.key).toBe("security-auditor");
		expect(result.customPersonality.source).toBe("workspace");
		expect(result.customPersonality.repositoryId).toBeUndefined();
		expect(result.prompt).toContain("security auditor");
	});

	it("per-repo custom personality wins over workspace-wide on the same label", async () => {
		const repo: RepositoryConfig = {
			...makeBaseRepo(),
			customPersonalities: {
				"repo-reviewer": {
					labels: ["Review"],
					promptPath: reviewerPromptPath,
				},
			},
		};
		const edgeWorker = new EdgeWorker(
			makeBaseConfig({
				repositories: [repo],
				customPersonalities: {
					"workspace-auditor": {
						labels: ["Review"],
						promptPath: auditorPromptPath,
					},
				},
			}),
		);

		const determineSystemPromptFromLabels = (
			edgeWorker as any
		).determineSystemPromptFromLabels.bind(edgeWorker);
		const result = await determineSystemPromptFromLabels(["Review"], repo);

		expect(result).toBeDefined();
		expect(result.customPersonality).toBeDefined();
		expect(result.customPersonality.source).toBe("repository");
		expect(result.customPersonality.key).toBe("repo-reviewer");
		expect(result.prompt).toContain("You are a code reviewer");
	});
});
