#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setGlobalErrorReporter } from "agitha-core";
import { Command } from "commander";
import dotenv from "dotenv";
import { Application } from "./Application.js";
import { AuthCommand } from "./commands/AuthCommand.js";
import { CheckTokensCommand } from "./commands/CheckTokensCommand.js";
import { RefreshTokenCommand } from "./commands/RefreshTokenCommand.js";
import { SelfAddRepoCommand } from "./commands/SelfAddRepoCommand.js";
import { SelfAuthCommand } from "./commands/SelfAuthCommand.js";
import { StartCommand } from "./commands/StartCommand.js";
import { createErrorReporter } from "./services/createErrorReporter.js";

// Get the directory of the current module for reading package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the actual version
// When compiled, this is in dist/src/, so we need to go up two levels
const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

// Pre-load env vars from the resolved .env file before initialising Sentry, so
// that AGITHA_SENTRY_DISABLED / AGITHA_SENTRY_DSN take effect on the first run.
// We re-resolve the path inside Application using the same precedence (CLI
// flag wins); this preliminary load only honours AGITHA_HOME and the default.
foldLegacyCyrusEnvVars();
preloadEnvForBootstrap();

// Initialise the error reporter as early as possible so that exceptions
// thrown by subsequent imports/bootstrap are captured. Install it as the
// process-wide reporter so that every Logger.error(...) call across the
// codebase forwards to Sentry automatically.
const errorReporter = createErrorReporter({ release: packageJson.version });
setGlobalErrorReporter(errorReporter);

// Setup Commander program
const program = new Command();

program
	.name("agitha")
	.description("AI-powered Linear issue automation using Claude")
	.version(packageJson.version)
	.option(
		"--agitha-home <path>",
		"Specify custom Agitha config directory (default: ~/.agitha; falls back to ~/.cyrus if migrating from Cyrus and only the legacy dir exists)",
		resolveDefaultAgithaHome(),
	)
	.option("--env-file <path>", "Path to environment variables file");

// Start command (default)
program
	.command("start", { isDefault: true })
	.description("Start the edge worker")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.agithaHome,
			opts.envFile,
			packageJson.version,
			errorReporter,
		);
		await new StartCommand(app).execute([]);
	});

// Auth command
program
	.command("auth <auth-key>")
	.description("Authenticate with Agitha using auth key")
	.action(async (authKey: string) => {
		const opts = program.opts();
		const app = new Application(
			opts.agithaHome,
			opts.envFile,
			packageJson.version,
			errorReporter,
		);
		await new AuthCommand(app).execute([authKey]);
	});

// Check tokens command
program
	.command("check-tokens")
	.description("Check the status of all Linear tokens")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.agithaHome,
			opts.envFile,
			packageJson.version,
			errorReporter,
		);
		await new CheckTokensCommand(app).execute([]);
	});

// Refresh token command
program
	.command("refresh-token")
	.description("Refresh a specific Linear token")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.agithaHome,
			opts.envFile,
			packageJson.version,
			errorReporter,
		);
		await new RefreshTokenCommand(app).execute([]);
	});

// Self-auth-linear command - Linear OAuth directly from CLI
program
	.command("self-auth-linear")
	.description("Authenticate with Linear OAuth directly")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.agithaHome,
			opts.envFile,
			packageJson.version,
			errorReporter,
		);
		await new SelfAuthCommand(app).execute([]);
	});

// Self-add-repo command - Clone and add repository
program
	.command("self-add-repo [url] [workspace]")
	.description(
		'Clone a repo and add it to config. URL accepts any valid git clone address (e.g., "https://github.com/org/repo.git"). Workspace is the display name of the Linear workspace (e.g., "My Workspace"). If URL is omitted, prompts interactively.',
	)
	.option(
		"-l, --label <labels>",
		"Comma-separated routing labels (defaults to repo name)",
	)
	.option(
		"-b, --base-branch <branch>",
		"Base branch name (auto-detected from remote if not specified)",
	)
	.action(
		async (
			url: string | undefined,
			workspace: string | undefined,
			cmdOpts: { label?: string; baseBranch?: string },
		) => {
			const opts = program.opts();
			const app = new Application(
				opts.agithaHome,
				opts.envFile,
				packageJson.version,
			);
			const args = [url, workspace].filter(Boolean) as string[];
			if (cmdOpts.label) {
				args.push("-l", cmdOpts.label);
			}
			if (cmdOpts.baseBranch) {
				args.push("-b", cmdOpts.baseBranch);
			}
			await new SelfAddRepoCommand(app).execute(args);
		},
	);

// Parse and execute
(async () => {
	try {
		await program.parseAsync(process.argv);
	} catch (error) {
		errorReporter.captureException(error, { tags: { phase: "bootstrap" } });
		await errorReporter.flush(2000).catch(() => false);
		console.error("Fatal error:", error);
		process.exit(1);
	}
})();

/**
 * Backward-compat for the Cyrus → Agitha rename: copy any `CYRUS_*` env var
 * into the matching `AGITHA_*` slot if the new name isn't already set.
 * Runs once at boot before any other env-reading code. Users with existing
 * `~/.cyrus/.env` files or system-wide `CYRUS_*` exports keep working
 * without touching their environment.
 */
function foldLegacyCyrusEnvVars(): void {
	for (const [key, value] of Object.entries(process.env)) {
		if (!key.startsWith("CYRUS_")) continue;
		const renamed = `AGITHA_${key.slice("CYRUS_".length)}`;
		if (process.env[renamed] === undefined && value !== undefined) {
			process.env[renamed] = value;
		}
	}
}

/**
 * Best-effort env preload so the error reporter can read its config before the
 * full {@link Application} bootstrap. We honour `--env-file` only as a literal
 * argv lookup (Commander hasn't parsed yet) and otherwise fall back to the
 * default `<agitha-home>/.env` path.
 */
function preloadEnvForBootstrap(): void {
	const argv = process.argv.slice(2);
	const flagIdx = argv.indexOf("--env-file");
	const agithaHomeIdx = argv.indexOf("--agitha-home");

	const envFile = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;
	const agithaHome =
		agithaHomeIdx >= 0 && argv[agithaHomeIdx + 1]
			? (argv[agithaHomeIdx + 1] as string)
			: resolveDefaultAgithaHome();

	const path = envFile ?? join(agithaHome, ".env");
	if (existsSync(path)) {
		dotenv.config({ path, override: false });
		// Re-fold after .env load so legacy CYRUS_* keys defined in the file
		// (not the system env) also populate the new AGITHA_* names.
		foldLegacyCyrusEnvVars();
	}
}

/**
 * Resolve the default Agitha home directory, preferring `~/.agitha` and
 * falling back to the legacy `~/.cyrus` location when only that exists.
 *
 * Backward-compat for users migrating from the Cyrus fork: their existing
 * config dir (`~/.cyrus/`) keeps working without manual intervention until
 * they either rename it or set `--agitha-home` / `AGITHA_HOME`.
 */
function resolveDefaultAgithaHome(): string {
	const home = homedir();
	const agithaPath = resolve(home, ".agitha");
	const legacyCyrusPath = resolve(home, ".cyrus");
	if (!existsSync(agithaPath) && existsSync(legacyCyrusPath)) {
		return legacyCyrusPath;
	}
	return agithaPath;
}
