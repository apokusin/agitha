import { join } from "node:path";
import type { ILogger } from "agitha-core";
import { describe, expect, it } from "vitest";
import {
	type IChatToolResolver,
	type IMcpConfigProvider,
	type IRunnerSelector,
	RunnerConfigBuilder,
} from "../src/RunnerConfigBuilder.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

function makeBuilder(): RunnerConfigBuilder {
	const chatToolResolver: IChatToolResolver = {
		buildChatAllowedTools: () => ["Read(**)"],
	};
	const mcpConfigProvider: IMcpConfigProvider = {
		buildMcpConfig: () => ({}),
		buildMergedMcpConfigPath: () => undefined,
	};
	const runnerSelector: IRunnerSelector = {
		determineRunnerSelection: () => ({ runnerType: "claude" as const }),
		getDefaultModelForRunner: () => "",
		getDefaultFallbackModelForRunner: () => "",
	};
	return new RunnerConfigBuilder(
		chatToolResolver,
		mcpConfigProvider,
		runnerSelector,
	);
}

describe("RunnerConfigBuilder.buildChatConfig", () => {
	it("includes autoMemoryDirectory in allowedDirectories so the session can read existing memory files (CYPACK-1197)", () => {
		const builder = makeBuilder();
		const agithaHome = "/tmp/agitha-home-test";
		const workspacePath = join(agithaHome, "slack-workspaces", "thread-x");
		const repositoryPaths = ["/repo/one", "/repo/two"];

		const config = builder.buildChatConfig({
			workspacePath,
			workspaceName: "slack-thread-x",
			systemPrompt: "test",
			sessionId: "sess-1",
			agithaHome,
			platformName: "slack",
			repositoryPaths,
			logger: silentLogger,
			onMessage: () => {},
			onError: () => {},
		});

		const expectedAutoMemoryDir = join(agithaHome, "slack-memory");
		expect(config.autoMemoryDirectory).toBe(expectedAutoMemoryDir);
		expect(config.allowedDirectories).toEqual([
			workspacePath,
			expectedAutoMemoryDir,
			...repositoryPaths,
		]);
	});
});
