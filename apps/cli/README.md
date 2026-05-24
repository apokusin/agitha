# agitha-ai

AI development agent for Linear powered by Claude Code.

## Installation

```bash
npm install -g agitha-ai
```

## Usage

### Start the agent
```bash
agitha
```

### Available Commands

- **`agitha`** - Start the edge worker (default)
- **`agitha add-repository`** - Add a new repository configuration
- **`agitha check-tokens`** - Check the status of all Linear tokens
- **`agitha refresh-token`** - Refresh a specific Linear token

### Adding Repositories

After initial setup, you can add additional repositories without restarting Agitha:

```bash
agitha add-repository
```

This command will:
1. Check for existing Linear credentials and reuse them if available
2. Start OAuth flow only if no credentials are found
3. Guide you through configuring the new repository
4. Save the updated configuration

The interactive wizard will prompt you for:
- Repository path (must be absolute)
- Base branch (defaults to 'main')
- Workspace directory for git worktrees
- Whether the repository is active

## Configuration

### Environment Variables

- `AGITHA_HOST_EXTERNAL` - Set to `true` to allow external connections (listens on `0.0.0.0` instead of `localhost`). Default: `false`
  - Use this when running in Docker containers or when you need external access to the webhook server
  - When `true`: Server listens on `0.0.0.0` (all interfaces)
  - When `false` or unset: Server listens on `localhost` (local access only)
- `LINEAR_ALLOWED_TOOLS` - Comma-separated list of tools allowed for Linear-triggered sessions. Overrides `linearAllowedTools` in `~/.agitha/config.json` when set.
- `DISALLOWED_TOOLS` - Comma-separated list of tools disallowed across all sessions. Overrides `defaultDisallowedTools` in `~/.agitha/config.json` when set.