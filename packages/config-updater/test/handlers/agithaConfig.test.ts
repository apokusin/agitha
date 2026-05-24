import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAgithaConfig } from "../../src/handlers/agithaConfig.js";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("handleAgithaConfig", () => {
	const agithaHome = "/test/agitha-home";

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.AGITHA_WORKTREES_DIR;
		mockExistsSync.mockReturnValue(false);
		mockReadFileSync.mockReturnValue("");
	});

	afterEach(() => {
		delete process.env.AGITHA_WORKTREES_DIR;
	});

	it("defaults repository workspaceBaseDir to agithaHome/worktrees", async () => {
		const result = await handleAgithaConfig(
			{
				repositories: [
					{
						id: "repo-1",
						name: "repo-1",
						repositoryPath: "/repos/repo-1",
						baseBranch: "main",
					},
				],
			},
			agithaHome,
		);

		expect(result.success).toBe(true);
		expect(mockMkdirSync).toHaveBeenCalledWith(agithaHome, { recursive: true });
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			"/test/agitha-home/config.json",
			expect.stringContaining(
				'"workspaceBaseDir": "/test/agitha-home/worktrees"',
			),
			"utf-8",
		);
	});

	it("uses AGITHA_WORKTREES_DIR when set", async () => {
		process.env.AGITHA_WORKTREES_DIR = "/tmp/custom-worktrees";

		const result = await handleAgithaConfig(
			{
				repositories: [
					{
						id: "repo-1",
						name: "repo-1",
						repositoryPath: "/repos/repo-1",
						baseBranch: "main",
					},
				],
			},
			agithaHome,
		);

		expect(result.success).toBe(true);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			"/test/agitha-home/config.json",
			expect.stringContaining('"workspaceBaseDir": "/tmp/custom-worktrees"'),
			"utf-8",
		);
	});
});
