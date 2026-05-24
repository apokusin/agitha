import { join } from "node:path";

/**
 * Shared constants used across Agitha packages
 */

/**
 * Default proxy URL for Agitha hosted services
 */
export const DEFAULT_PROXY_URL = "https://agitha-proxy.ceedar.workers.dev";

/**
 * Default directory name for git worktrees
 */
export const DEFAULT_WORKTREES_DIR = "worktrees";

/**
 * Default directory name for cloned repositories
 */
export const DEFAULT_REPOS_DIR = "repos";

/**
 * Resolves the repos directory, preferring AGITHA_REPOS_DIR env var over the default.
 */
export function getDefaultReposDir(agithaHome: string): string {
	return (
		process.env.AGITHA_REPOS_DIR?.trim() || join(agithaHome, DEFAULT_REPOS_DIR)
	);
}

/**
 * Resolves the worktrees directory, preferring AGITHA_WORKTREES_DIR env var over the default.
 */
export function getDefaultWorktreesDir(agithaHome: string): string {
	return (
		process.env.AGITHA_WORKTREES_DIR?.trim() ||
		join(agithaHome, DEFAULT_WORKTREES_DIR)
	);
}

/**
 * Default base branch for new repositories
 */
export const DEFAULT_BASE_BRANCH = "main";

/**
 * Default config filename
 */
export const DEFAULT_CONFIG_FILENAME = "config.json";
