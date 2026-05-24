import type {
	CustomPersonalityConfig,
	ILogger,
	RepositoryConfig,
} from "agitha-core";
import type {
	CustomPersonalityMatch,
	PromptBuilder,
	SystemPromptResult,
} from "./PromptBuilder.js";
import type { ToolPermissionResolver } from "./ToolPermissionResolver.js";

/** Built-in label-based prompt types (the closed enum). */
export type BuiltInPromptType =
	| "debugger"
	| "builder"
	| "scoper"
	| "orchestrator"
	| "graphite-orchestrator";

/**
 * Combined output of label-based session resolution — pairs the system
 * prompt determination with the allowed/disallowed tool surface so callers
 * (the new-session bootstrap and the resume path in EdgeWorker) don't have
 * to unpack the personality config and thread it through tool resolution
 * themselves.
 */
export interface LabelBasedSessionResolution {
	systemPromptResult?: SystemPromptResult;
	systemPrompt?: string;
	systemPromptVersion?: string;
	promptType?: BuiltInPromptType;
	customPersonality?: CustomPersonalityConfig;
	customPersonalityMatch?: CustomPersonalityMatch;
	allowedTools: string[];
	disallowedTools: string[];
}

export interface ResolveLabelBasedSessionInput {
	/** Labels on the issue, in original (preserved-case) form. */
	labels: string[];
	/** Issue description — enables `[personality=<key>]` description-tag invocation. */
	issueDescription?: string;
	/**
	 * Repository the session is anchored to. Used both for system-prompt
	 * matching (per-repo `customPersonalities` and `labelPrompts`) and as
	 * the default for tool resolution when `repositoriesForToolUnion` is
	 * omitted.
	 */
	primaryRepository: RepositoryConfig;
	/**
	 * When the session spans multiple repos (multi-repo Linear sessions),
	 * pass all of them here. Tool allow-lists are the union; disallow-lists
	 * are the intersection. When omitted, defaults to `[primaryRepository]`.
	 */
	repositoriesForToolUnion?: RepositoryConfig[];
	/**
	 * Which platform initiated the session — selects between the Linear
	 * (union, default) and GitHub (single-repo) tool resolution paths.
	 * Defaults to `"linear"`.
	 */
	sessionPlatform?: "linear" | "github";
	/**
	 * When true, skip system-prompt determination entirely and return tools
	 * resolved against the default chain (no `promptType`, no personality).
	 * Use this for `@mention` sessions that don't go through label-based
	 * routing.
	 */
	skipLabelBasedPrompt?: boolean;
}

/**
 * Bundles label-based system-prompt determination with tool-permission
 * resolution into a single call.
 *
 * Both `EdgeWorker.handleAgentSessionCreated` (new sessions) and
 * `EdgeWorker.resumeAgentSession` were independently calling
 * `PromptBuilder.determineSystemPromptFromLabels`, unpacking
 * `customPersonality?.config`, and forwarding it through
 * `ToolPermissionResolver.buildAllowedTools` / `buildDisallowedTools`.
 * That duplication was easy to drift on — e.g. forgetting to thread the
 * personality config in a third call site. This resolver consolidates the
 * pipeline so the EdgeWorker just consumes the bundled result.
 */
export class LabelBasedSessionResolver {
	constructor(
		private readonly promptBuilder: PromptBuilder,
		private readonly toolPermissionResolver: ToolPermissionResolver,
		private readonly logger: ILogger,
	) {}

	async resolve(
		input: ResolveLabelBasedSessionInput,
	): Promise<LabelBasedSessionResolution> {
		const repositoriesForTools = input.repositoriesForToolUnion ?? [
			input.primaryRepository,
		];
		const platform = input.sessionPlatform ?? "linear";

		let systemPromptResult: SystemPromptResult | undefined;
		if (!input.skipLabelBasedPrompt) {
			systemPromptResult =
				await this.promptBuilder.determineSystemPromptFromLabels(
					input.labels,
					[input.primaryRepository],
					input.issueDescription,
				);
		}

		const customPersonalityMatch = systemPromptResult?.customPersonality;
		const customPersonality = customPersonalityMatch?.config;
		const promptType = systemPromptResult?.type;

		const allowedTools =
			platform === "github"
				? this.toolPermissionResolver.buildGithubAllowedTools(
						input.primaryRepository,
						promptType,
						customPersonality,
					)
				: this.toolPermissionResolver.buildAllowedTools(
						repositoriesForTools,
						promptType,
						customPersonality,
					);

		const disallowedTools = this.toolPermissionResolver.buildDisallowedTools(
			repositoriesForTools,
			promptType,
			customPersonality,
		);

		this.logger.debug(
			`Label-based session resolution: promptType=${promptType ?? "none"}, ` +
				`personality=${customPersonalityMatch?.key ?? "none"}, ` +
				`platform=${platform}, allowedTools=${allowedTools.length}, ` +
				`disallowedTools=${disallowedTools.length}`,
		);

		return {
			systemPromptResult,
			systemPrompt: systemPromptResult?.prompt,
			systemPromptVersion: systemPromptResult?.version,
			promptType,
			customPersonality,
			customPersonalityMatch,
			allowedTools,
			disallowedTools,
		};
	}
}
