import type { FastifyInstance } from "fastify";
import { handleAgithaConfig } from "./handlers/agithaConfig.js";
import { handleAgithaEnv } from "./handlers/agithaEnv.js";
import { handleCheckGh } from "./handlers/checkGh.js";
import { handleCheckGlab } from "./handlers/checkGlab.js";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import {
	handleRepository,
	handleRepositoryDelete,
} from "./handlers/repository.js";
import {
	handleDeleteSkill,
	handleListSkills,
	handleUpdateSkill,
} from "./handlers/skills.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import type {
	AgithaConfigPayload,
	AgithaEnvPayload,
	ApiResponse,
	CheckGhPayload,
	CheckGlabPayload,
	ConfigureMcpPayload,
	DeleteRepositoryPayload,
	DeleteSkillPayload,
	ListSkillsPayload,
	RepositoryPayload,
	TestMcpPayload,
	UpdateSkillPayload,
} from "./types.js";

/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: agitha-config, agitha-env, repository, update/test-mcp, update/configure-mcp, check-gh endpoints
 *
 * `getApiKey` is invoked on every auth check, so callers reading from
 * `process.env.AGITHA_API_KEY` pick up `.env` reloads (triggered by
 * `agitha auth` after a credential rotation) without restarting the process.
 */
export class ConfigUpdater {
	private fastify: FastifyInstance;
	private agithaHome: string;
	private getApiKey: () => string;

	constructor(
		fastify: FastifyInstance,
		agithaHome: string,
		getApiKey: () => string,
	) {
		this.fastify = fastify;
		this.agithaHome = agithaHome;
		this.getApiKey = getApiKey;
	}

	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register(): void {
		// Register all routes with authentication
		this.registerRoute(
			"/api/update/agitha-config",
			this.handleAgithaConfigRoute,
		);
		this.registerRoute("/api/update/agitha-env", this.handleAgithaEnvRoute);
		this.registerRoute("/api/update/repository", this.handleRepositoryRoute);
		this.registerDeleteRoute(
			"/api/update/repository",
			this.handleRepositoryDeleteRoute,
		);
		this.registerRoute("/api/update/test-mcp", this.handleTestMcpRoute);
		this.registerRoute(
			"/api/update/configure-mcp",
			this.handleConfigureMcpRoute,
		);
		this.registerRoute("/api/check-gh", this.handleCheckGhRoute);
		this.registerRoute("/api/check-glab", this.handleCheckGlabRoute);
		this.registerRoute("/api/update/skill", this.handleUpdateSkillRoute);
		this.registerDeleteRoute("/api/update/skill", this.handleDeleteSkillRoute);
		this.registerGetRoute("/api/skills", this.handleListSkillsRoute);
	}

	/**
	 * Register a route with authentication
	 */
	private registerRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.post(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.body);
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Register a DELETE route with authentication
	 */
	private registerDeleteRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.delete(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.body);
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Register a GET route with authentication
	 */
	private registerGetRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.get(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.query || {});
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Verify Bearer token authentication
	 */
	private verifyAuth(authHeader: string | undefined): boolean {
		const apiKey = this.getApiKey();
		if (!authHeader || !apiKey) {
			return false;
		}

		const expectedAuth = `Bearer ${apiKey}`;
		return authHeader === expectedAuth;
	}

	/**
	 * Handle agitha-config update
	 */
	private async handleAgithaConfigRoute(
		payload: AgithaConfigPayload,
	): Promise<ApiResponse> {
		const response = await handleAgithaConfig(payload, this.agithaHome);

		// Emit restart event if requested
		if (response.success && response.data?.restartAgitha) {
			this.fastify.log.info("Config update requested Agitha restart");
		}

		return response;
	}

	/**
	 * Handle agitha-env update
	 */
	private async handleAgithaEnvRoute(
		payload: AgithaEnvPayload,
	): Promise<ApiResponse> {
		const response = await handleAgithaEnv(payload, this.agithaHome);

		// Emit restart event if requested
		if (response.success && response.data?.restartAgitha) {
			this.fastify.log.info("Env update requested Agitha restart");
		}

		return response;
	}

	/**
	 * Handle repository clone/verify
	 */
	private async handleRepositoryRoute(
		payload: RepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepository(payload, this.agithaHome);
	}

	/**
	 * Handle MCP connection test
	 */
	private async handleTestMcpRoute(
		payload: TestMcpPayload,
	): Promise<ApiResponse> {
		return handleTestMcp(payload);
	}

	/**
	 * Handle MCP server configuration
	 */
	private async handleConfigureMcpRoute(
		payload: ConfigureMcpPayload,
	): Promise<ApiResponse> {
		return handleConfigureMcp(payload, this.agithaHome);
	}

	/**
	 * Handle GitHub CLI check
	 */
	private async handleCheckGhRoute(
		payload: CheckGhPayload,
	): Promise<ApiResponse> {
		return handleCheckGh(payload, this.agithaHome);
	}

	/**
	 * Handle GitLab CLI check
	 */
	private async handleCheckGlabRoute(
		payload: CheckGlabPayload,
	): Promise<ApiResponse> {
		return handleCheckGlab(payload, this.agithaHome);
	}

	/**
	 * Handle repository deletion
	 */
	private async handleRepositoryDeleteRoute(
		payload: DeleteRepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepositoryDelete(payload, this.agithaHome);
	}

	/**
	 * Handle creating or updating a user skill
	 */
	private async handleUpdateSkillRoute(
		payload: UpdateSkillPayload,
	): Promise<ApiResponse> {
		return handleUpdateSkill(payload, this.agithaHome);
	}

	/**
	 * Handle deleting a user skill
	 */
	private async handleDeleteSkillRoute(
		payload: DeleteSkillPayload,
	): Promise<ApiResponse> {
		return handleDeleteSkill(payload, this.agithaHome);
	}

	/**
	 * Handle listing user skills
	 */
	private async handleListSkillsRoute(
		payload: ListSkillsPayload,
	): Promise<ApiResponse> {
		return handleListSkills(payload, this.agithaHome);
	}
}
