import type {
	AgentActivityCreateInput,
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPoster } from "../src/ActivityPoster.js";
import type { CustomPersonalityMatch } from "../src/PromptBuilder.js";

/**
 * Tests for ActivityPoster.postSystemPromptSelectionThought handling of
 * custom personalities. The custom-personality branch bypasses the built-in
 * if/else ladder entirely and posts a personality-specific announcement
 * instead.
 */
describe("ActivityPoster — custom personality system prompt selection", () => {
	const workspaceId = "workspace-1";
	const repositoryId = "repo-1";
	const sessionId = "agent-session-1";

	let createAgentActivity: ReturnType<typeof vi.fn>;
	let issueTracker: IIssueTrackerService;
	let issueTrackers: Map<string, IIssueTrackerService>;
	let repositories: Map<string, RepositoryConfig>;
	let logger: ILogger;
	let poster: ActivityPoster;

	beforeEach(() => {
		createAgentActivity = vi.fn().mockResolvedValue({ success: true });
		issueTracker = {
			createAgentActivity,
		} as unknown as IIssueTrackerService;

		issueTrackers = new Map();
		issueTrackers.set(workspaceId, issueTracker);

		// The repository is registered but its labelPrompts are irrelevant — when
		// a custom personality is passed in, we must NOT fall back to the built-in
		// ladder.
		const repository = {
			id: repositoryId,
			name: "repo",
			labelPrompts: {
				debugger: ["Bug"],
				builder: ["Feature"],
			},
		} as unknown as RepositoryConfig;
		repositories = new Map();
		repositories.set(repositoryId, repository);

		logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogger;

		poster = new ActivityPoster(issueTrackers, repositories, logger);
	});

	it("posts the with-description announcement when description is set", async () => {
		const customPersonality: CustomPersonalityMatch = {
			key: "reviewer",
			source: "repository",
			repositoryId,
			config: {
				labels: ["Review", "code-review"],
				promptPath: "/tmp/reviewer.md",
				description: "Thorough code reviewer",
			},
		};

		// Issue labels include "Review" (different casing intentional — the
		// matcher should be case-insensitive).
		await poster.postSystemPromptSelectionThought(
			sessionId,
			["review", "other"],
			workspaceId,
			repositoryId,
			customPersonality,
		);

		expect(createAgentActivity).toHaveBeenCalledTimes(1);
		const call = createAgentActivity.mock
			.calls[0]![0] as AgentActivityCreateInput;
		expect(call.agentSessionId).toBe(sessionId);
		const content = call.content as { type: string; body: string };
		expect(content.type).toBe("thought");
		// Trigger label uses the personality's configured casing ("Review"),
		// since findMatchingLabels picks the first entry from
		// customPersonality.config.labels whose lowercase appears in the issue
		// labels.
		expect(content.body).toBe(
			"Entering 'reviewer' personality (Thorough code reviewer) because of the 'Review' label. I'll follow the custom instructions.",
		);
	});

	it("posts the no-description announcement when description is unset", async () => {
		const customPersonality: CustomPersonalityMatch = {
			key: "auditor",
			source: "workspace",
			config: {
				labels: ["Audit"],
				promptPath: "/tmp/auditor.md",
			},
		};

		await poster.postSystemPromptSelectionThought(
			sessionId,
			["Audit"],
			workspaceId,
			repositoryId,
			customPersonality,
		);

		expect(createAgentActivity).toHaveBeenCalledTimes(1);
		const call = createAgentActivity.mock
			.calls[0]![0] as AgentActivityCreateInput;
		const content = call.content as { type: string; body: string };
		expect(content.body).toBe(
			"Entering 'auditor' personality because of the 'Audit' label. I'll follow the custom instructions.",
		);
	});

	it("does not post when no personality label matches the issue labels", async () => {
		const customPersonality: CustomPersonalityMatch = {
			key: "security",
			source: "repository",
			repositoryId,
			config: {
				labels: ["Security", "compliance"],
				promptPath: "/tmp/security.md",
				description: "Security reviewer",
			},
		};

		// Issue carries the built-in "Bug" label, but the custom personality is
		// gated on "Security"/"compliance" — defensive early return.
		await poster.postSystemPromptSelectionThought(
			sessionId,
			["Bug", "unrelated"],
			workspaceId,
			repositoryId,
			customPersonality,
		);

		expect(createAgentActivity).not.toHaveBeenCalled();
	});
});
