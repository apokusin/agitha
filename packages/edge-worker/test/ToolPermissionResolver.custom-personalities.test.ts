import type {
	CustomPersonalityConfig,
	EdgeWorkerConfig,
	ILogger,
	RepositoryConfig,
} from "cyrus-core";
import { describe, expect, it } from "vitest";
import { ToolPermissionResolver } from "../src/ToolPermissionResolver.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

function makeRepo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
	return {
		id: "repo-a",
		name: "repo-a",
		repositoryPath: "/tmp/repo",
		workspaceBaseDir: "/tmp/workspace",
		baseBranch: "main",
		...overrides,
	};
}

function makeConfig(
	overrides: Partial<EdgeWorkerConfig> = {},
): EdgeWorkerConfig {
	return {
		repositories: [],
		cyrusHome: "/tmp/cyrus",
		...overrides,
	} as EdgeWorkerConfig;
}

describe("ToolPermissionResolver custom personalities", () => {
	it("allowedTools override (array) replaces repo and global resolution", () => {
		const config = makeConfig({
			linearAllowedTools: ["Read", "Edit", "Bash"],
		});
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo({
			allowedTools: ["Read", "Edit", "Bash", "WebFetch"],
		});
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			allowedTools: ["Read", "Grep"],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual(["Read", "Grep"]);
	});

	it("allowedTools preset string is resolved via the preset table", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo({ allowedTools: ["Bash"] });
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			allowedTools: "readOnly",
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		// readOnly preset uses the Slack default set — at minimum it must be
		// non-empty and exclude the dangerous write tools the personality
		// intentionally drops.
		expect(tools.length).toBeGreaterThan(0);
		expect(tools).not.toContain("Bash");
	});

	it("disallowedTools override replaces repo and global resolution", () => {
		const config = makeConfig({
			defaultDisallowedTools: ["Bash(rm:*)"],
		});
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo({ disallowedTools: ["Read"] });
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			disallowedTools: ["Bash", "Edit"],
		};

		const tools = resolver.buildDisallowedTools(repo, undefined, personality);

		expect(tools).toEqual(["Bash", "Edit"]);
	});

	it("personality without allowedTools falls through to existing repo resolution", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo({ allowedTools: ["Read", "Grep"] });
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			// no allowedTools set
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual(["Read", "Grep"]);
	});

	it("personality with empty allowedTools array is honored (explicit empty surface)", () => {
		const config = makeConfig({
			linearAllowedTools: ["Read", "Bash"],
		});
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			allowedTools: [],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual([]);
	});

	it("github tools also honor personality override", () => {
		const config = makeConfig({
			githubAllowedTools: ["Read", "Edit", "Bash"],
		});
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Reviewer"],
			promptPath: "/tmp/reviewer.md",
			allowedTools: ["Read"],
		};

		const tools = resolver.buildGithubAllowedTools(
			repo,
			undefined,
			personality,
		);

		expect(tools).toEqual(["Read"]);
	});

	it("writeScopes expands a bare Write entry into per-scope variants", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Article"],
			promptPath: "/tmp/copy-writer.md",
			allowedTools: ["Read", "Write"],
			writeScopes: ["./content/**", "./drafts/**"],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual([
			"Read",
			"Write(./content/**)",
			"Write(./drafts/**)",
		]);
		expect(tools).not.toContain("Write");
	});

	it("writeScopes expands both Write and Edit entries per scope", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Article"],
			promptPath: "/tmp/copy-writer.md",
			allowedTools: ["Read", "Write", "Edit", "Grep"],
			writeScopes: ["./content/**", "./drafts/**"],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual([
			"Read",
			"Write(./content/**)",
			"Write(./drafts/**)",
			"Edit(./content/**)",
			"Edit(./drafts/**)",
			"Grep",
		]);
	});

	it("writeScopes leaves already-scoped Write entries alone and appends nothing extra", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Article"],
			promptPath: "/tmp/copy-writer.md",
			allowedTools: ["Write(./other/**)"],
			writeScopes: ["./content/**"],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual(["Write(./other/**)"]);
	});

	it("writeScopes has no effect when allowedTools has neither Write nor Edit", () => {
		const config = makeConfig();
		const resolver = new ToolPermissionResolver(config, silentLogger);
		const repo = makeRepo();
		const personality: CustomPersonalityConfig = {
			labels: ["Reader"],
			promptPath: "/tmp/reader.md",
			allowedTools: ["Read", "Glob", "Grep"],
			writeScopes: ["./content/**"],
		};

		const tools = resolver.buildAllowedTools(repo, undefined, personality);

		expect(tools).toEqual(["Read", "Glob", "Grep"]);
	});
});
