# Agitha Configuration File

Agitha stores configuration in `~/.agitha/config.json`. This file is created automatically during initial setup and can be edited manually to customize behavior.

Editing this manually only applies to those running the fully end-to-end self-hosted. Those who are paying for Agitha, management of config.json is automated.

---

## Repository Configuration

Each repository in the `repositories` array can have these properties:

### `allowedTools` (array of strings)

Controls which tools Claude can use when processing issues. Default: all standard tools plus `Bash(git:*)` and `Bash(gh:*)`.

Examples:

- `["Read", "Edit", "Bash(git:*)", "Task"]` - Allow reading, editing, git commands, and task management
- `["Read", "Edit", "Bash(npm:*)", "WebSearch"]` - Allow reading, editing, npm commands, and web search
- `["Read", "Edit", "mcp__github"]` - Allow all tools from the GitHub MCP server
- `["Read", "Edit", "mcp__github__search_repositories"]` - Allow only the search_repositories tool from GitHub MCP

For security configuration details, see: https://code.claude.com/docs/en/settings#permission-settings

### `mcpConfigPath` (string or array of strings)

Path(s) to MCP (Model Context Protocol) configuration files. MCP allows Claude to access external tools and data sources like databases or APIs.

Can be specified as:

- A single string: `"mcpConfigPath": "/home/user/myapp/mcp-config.json"`
- An array of strings: `"mcpConfigPath": ["/home/user/myapp/mcp-base.json", "/home/user/myapp/mcp-local.json"]`

When multiple files are provided, configurations are composed together. Later files override earlier ones for the same server names.

Expected file format:

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "command-to-run",
      "args": ["arg1", "arg2"]
    }
  }
}
```

Learn more about MCP: https://code.claude.com/docs/en/mcp

### `teamKeys` (array of strings)

Routes Linear issues from specific teams to this repository. When specified, only issues from matching teams trigger Agitha.

Example: `["CEE", "FRONT", "BACK"]` - Only process issues from teams CEE, FRONT, and BACK

### `projectKeys` (array of strings)

Routes Linear issues from specific projects to this repository. When specified, only issues belonging to the listed Linear projects will be processed by this repository.

Example: `["Mobile App", "Web Platform", "API Service"]` - Only process issues that belong to these Linear projects

Note: This is useful when you want to separate work by project rather than by team, especially in organizations where multiple projects span across teams.

### `routingLabels` (array of strings)

Routes Linear issues with specific labels to this repository. This is useful when you have multiple repositories handling issues from the same Linear team but want to route based on labels (e.g., "backend" vs "frontend" labels).

Example: `["backend", "api"]` - Only process issues that have the "backend" or "api" label

---

## Routing Priority Order

When multiple routing configurations are present, Agitha evaluates them in the following priority order:

1. **`routingLabels`** (highest priority) - Label-based routing
2. **`projectKeys`** (medium priority) - Project-based routing
3. **`teamKeys`** (lowest priority) - Team-based routing

If an issue matches multiple routing configurations, the highest priority match will be used. For example, if an issue has a label that matches `routingLabels` and also belongs to a project in `projectKeys`, the label-based routing will take precedence.

---

## Label-Based AI Modes

### `labelPrompts` (object)

Routes issues to different AI modes based on Linear labels and optionally configures allowed tools per mode.

**Simple format (labels only):**

```json
{
  "debugger": ["Bug"],
  "builder": ["Feature", "Improvement"],
  "scoper": ["PRD"]
}
```

**Advanced format (with dynamic tool configuration):**

```json
{
  "debugger": {
    "labels": ["Bug"],
    "allowedTools": "readOnly"
  },
  "builder": {
    "labels": ["Feature", "Improvement"],
    "allowedTools": "safe"
  },
  "scoper": {
    "labels": ["PRD"],
    "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "mcp__linear"]
  }
}
```

**Modes:**

- **debugger**: Systematic problem investigation mode
- **builder**: Feature implementation mode
- **scoper**: Requirements analysis mode

**Tool Presets:**

- **`"readOnly"`**: Only tools that read/view content (17 tools)
   - `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `Task`, `Skill`, `ListMcpResourcesTool`, `ReadMcpResourceTool`, `Monitor`, `TaskOutput`, `EnterPlanMode`, `ExitPlanMode`

- **`"safe"`**: All tools except Bash (32 tools)
   - All readOnly tools plus: `Edit`, `Write`, `NotebookEdit`, `AskUserQuestion`, `SendMessage`, `EnterWorktree`, `ExitWorktree`, `CronCreate`, `CronDelete`, `CronList`, `RemoteTrigger`, `ScheduleWakeup`, `TaskStop`, `TeamCreate`, `TeamDelete`

- **`"all"`**: All available tools including Bash (33 tools)
   - All safe tools plus: `Bash`

- **Custom array**: Specify exact tools needed, e.g., `["Read", "Edit", "Task"]`

Note: Linear MCP tools (`mcp__linear`) are always included automatically. Slack MCP tools (`mcp__slack`) are included when the `SLACK_BOT_TOKEN` environment variable is set (Linear and Slack sessions only; excluded from GitHub sessions).

---

## Custom Personalities

### `customPersonalities` (object)

User-defined agent personalities that pair Linear labels with your own system prompts and tool permissions. Custom personalities are matched **before** the built-in `labelPrompts` modes (debugger / builder / scoper / orchestrator) and take precedence when their labels match.

Can be configured at the workspace level (top-level `customPersonalities` in `config.json`) or per-repository (inside a repository entry). Per-repository definitions are checked first and override workspace-level definitions on key collisions.

**Properties per entry:**

- **`labels`** (array of strings, required) — Linear label names that trigger this personality. Matching is case-insensitive.
- **`promptPath`** (string, required) — Path to the system-prompt markdown file. Supports `~/` expansion (resolved against the user's home directory) and is resolved at config load time.
- **`requireAllLabels`** (boolean, optional) — When true, the personality matches only when *every* label in `labels` is present on the issue. Default false (any single label match is enough). Use this for label combinations like `["Article", "Draft"]` that should not fire on every "Article" issue.
- **`referenceDirs`** (array of strings, optional) — Workspace-relative directories the personality should treat as reference material (style guides, past work, voice examples). At session start these are listed in a `<reference_context>` block appended to the personality's system prompt, with an instruction to `Glob` / `Read` / `Grep` them for context. The directories still need to be reachable through the personality's `allowedTools`.
- **`allowedTools`** (string or array, optional) — Tool list or preset (`"readOnly"`, `"safe"`, `"all"`, `"coordinator"`). When set, fully replaces the resolved tool list — the personality owns its tool surface.
- **`disallowedTools`** (array of strings, optional) — Tools to explicitly deny. When set, fully replaces any per-repository / global disallow list.
- **`writeScopes`** (array of strings, optional) — Workspace-relative glob patterns (e.g. `["./content/**"]`) that scope any unscoped `"Write"` or `"Edit"` entry in `allowedTools`. Already-parenthesized entries (e.g. `"Write(./other/**)"`) pass through unchanged. Has no effect when `allowedTools` is unset.
- **`model`** (string, optional) — Model override for the runner (e.g., `"claude-opus-4-7"`). Takes precedence over per-issue description tags, per-repo `model`, and runner defaults.
- **`description`** (string, optional) — Human-readable description shown in logs.

**Workspace-level example:**

```json
{
  "customPersonalities": {
    "code-reviewer": {
      "labels": ["Code Review", "PR Review"],
      "promptPath": "~/.agitha/personalities/code-reviewer.md",
      "allowedTools": "readOnly",
      "model": "claude-opus-4-7",
      "description": "Read-only code review personality"
    },
    "security-auditor": {
      "labels": ["Security"],
      "promptPath": "~/.agitha/personalities/security-auditor.md",
      "allowedTools": ["Read", "Glob", "Grep", "WebFetch"]
    }
  },
  "repositories": [...]
}
```

**Per-repository example:**

```json
{
  "repositories": [
    {
      "id": "...",
      "customPersonalities": {
        "design-doc-writer": {
          "labels": ["Design Doc"],
          "promptPath": "/abs/path/to/repo/.agitha/personalities/design.md",
          "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "mcp__linear"]
        }
      }
    }
  ]
}
```

**Notes:**

- The prompt file should be valid markdown. Optionally include `<version-tag value="..." />` near the top to surface a version in logs.
- When a custom personality matches, the built-in `labelPrompts` resolution is skipped and the personality's `allowedTools` / `disallowedTools` / `model` (when set) replace the corresponding chain entries.
- When the personality omits `allowedTools` / `disallowedTools`, normal resolution applies (repository overrides, then global defaults).
- If the prompt file cannot be read at session start, the personality is skipped and the built-in matcher runs as a fallback.

### Scoping write access

By default, granting a personality `"Write"` (or `"Edit"`) in `allowedTools` lets the agent write anywhere in the worktree. For personalities that should only touch a specific subtree — e.g. a copy-writer that only edits articles under `./content/` — declare `writeScopes` to constrain where writes can land:

```json
"copy-writer": {
  "labels": ["Article"],
  "promptPath": "~/.agitha/personalities/copy-writer.md",
  "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "Write"],
  "writeScopes": ["./content/**"]
}
```

At session start the bare `"Write"` is expanded into `"Write(./content/**)"`, so the final allow-list passed to the runner is `["Read", "Glob", "Grep", "WebFetch", "Write(./content/**)"]`. List multiple patterns to allow writes in several directories (e.g. `["./content/**", "./drafts/**"]` produces one `Write(<scope>)` entry per scope). Entries that are already parenthesized — for example `"Write(./other/**)"` — pass through verbatim and are not duplicated per scope.

### Invoking a personality from the issue description

Linear authors who don't want to manage labels — or who want to pick a personality ad-hoc — can name one directly in the issue description with a `[personality=<key>]` tag:

```
Draft a 600-word piece on edge networking. [personality=copy-writer]
```

The tag takes precedence over label matching: if `copy-writer` is configured anywhere (per-repo first, then workspace), it wins regardless of what labels are on the issue. If the tag names a personality that isn't configured, the matcher falls back to label-based matching and logs a warning. The tag syntax matches the existing `[agent=...]` / `[model=...]` description tags — escaped brackets and case-insensitive keys are both accepted.

---

## User Access Control

Control which Linear users can delegate issues to Agitha. Supports both global configuration and per-repository overrides.

### `userAccessControl` (object)

Can be configured at the global level or per-repository.

**Properties:**

- **`allowedUsers`** (array) - Users allowed to delegate issues. If specified, ONLY these users can trigger sessions. Omit to allow everyone.
- **`blockedUsers`** (array) - Users blocked from delegating issues. Takes precedence over allowedUsers.
- **`blockBehavior`** (string) - What happens when a blocked user tries to delegate:
  - `"silent"` (default) - Ignore the webhook quietly
  - `"comment"` - Post a message explaining the user is not authorized
- **`blockMessage`** (string) - Custom message when blockBehavior is "comment". Supports template variables:
  - `{{userName}}` - The user's display name
  - `{{userId}}` - The user's Linear ID

  Default: `"{{userName}}, you are not authorized to delegate issues to this agent."`

**User Identifiers:**

Users can be specified in three formats:
- String (treated as Linear user ID): `"usr_abc123"`
- Object with ID: `{ "id": "usr_abc123" }`
- Object with email: `{ "email": "user@example.com" }` (case-insensitive)

**Example - Global configuration:**

```json
{
  "userAccessControl": {
    "blockedUsers": ["usr_known_bad_actor"],
    "blockBehavior": "comment",
    "blockMessage": "{{userName}}, please contact your team lead to use this agent."
  },
  "repositories": [...]
}
```

**Example - Per-repository configuration:**

```json
{
  "repositories": [{
    "id": "main-app",
    "name": "Main Application",
    "userAccessControl": {
      "allowedUsers": [
        "usr_senior_dev_1",
        { "email": "lead@company.com" },
        { "id": "usr_senior_dev_2" }
      ],
      "blockBehavior": "comment"
    }
  }]
}
```

**Inheritance Rules:**

- **allowedUsers**: Repository config OVERRIDES global (not merged)
- **blockedUsers**: Repository config EXTENDS global (merged/additive)
- **blockBehavior**: Repository config OVERRIDES global
- **blockMessage**: Repository config OVERRIDES global

---

## Sandbox (Network Egress Control)

### `sandbox` (object)

Controls network egress for agent sessions. When enabled, all Bash-spawned subprocess traffic (git, gh, npm, curl, etc.) routes through a local egress proxy for domain filtering, request logging, and per-domain header injection. Claude's inference API, MCP servers, and built-in file tools (Read/Edit/Write) are unaffected.

**Properties:**

- **`enabled`** (boolean) - Enable or disable the egress proxy. Default: `false`
- **`httpProxyPort`** (number) - HTTP proxy port. Default: `9080`
- **`socksProxyPort`** (number) - SOCKS proxy port. Default: `9081`
- **`systemWideCert`** (boolean) - Set to `true` after trusting the CA cert system-wide (e.g., via `sudo security add-trusted-cert`). When true, per-session CA cert env vars (`NODE_EXTRA_CA_CERTS`, `GIT_SSL_CAINFO`, etc.) are skipped — the OS cert store handles trust for all tools. Default: `false`
- **`logRequests`** (boolean) - Log all proxied requests. Default: `true`
- **`networkPolicy`** (object) - Domain allow/deny rules and header transforms. If omitted, all traffic is allowed (passthrough mode with logging).
  - **`preset`** (`"trusted"`) - Pre-populate the allow list with ~200 domains matching [Claude Code on the web's default allowlist](https://docs.anthropic.com/en/docs/claude-code/claude-code-on-the-web#default-allowed-domains). Covers package registries (npm, PyPI, RubyGems, crates.io, Maven, etc.), version control (GitHub, GitLab, Bitbucket), container registries (Docker Hub, GCR, ECR, GHCR), cloud platforms (GCP, Azure, AWS, Oracle), dev tools (Kubernetes, HashiCorp, Anaconda), monitoring (Sentry, Datadog, Honeycomb), and more. Custom `allow` rules are merged on top.
  - **`allow`** (object) - Domain allow rules with optional header transforms. Keys are domain patterns (e.g., `"api.example.com"`, `"*.example.com"`). When present, all unlisted domains are denied.
  - **`subnets`** (object) - IP-range-based allow/deny rules.

**Example — use the trusted preset (recommended starting point):**

```json
{
  "sandbox": {
    "enabled": true,
    "networkPolicy": {
      "preset": "trusted"
    }
  }
}
```

**Example — trusted preset with additional custom domains:**

```json
{
  "sandbox": {
    "enabled": true,
    "networkPolicy": {
      "preset": "trusted",
      "allow": {
        "internal.company.com": [{}],
        "*.internal.corp": [{}]
      }
    }
  }
}
```

**Example — custom allow list with header injection:**

```json
{
  "sandbox": {
    "enabled": true,
    "networkPolicy": {
      "allow": {
        "api.github.com": [{}],
        "registry.npmjs.org": [{}],
        "api.example.com": [
          {
            "transform": [
              {
                "headers": {
                  "Authorization": "Bearer ${API_TOKEN}"
                }
              }
            ]
          }
        ]
      }
    }
  }
}
```

When `networkPolicy.allow` is specified (or expanded from a preset), all domains not in the list are blocked (deny-all). Domains with `transform` rules get TLS termination for header injection; all others pass through as CONNECT tunnels.

### CA Certificate Trust

The egress proxy generates a CA certificate at `~/.agitha/certs/agitha-egress-ca.pem` for TLS interception of domains with transform rules. This cert is stable across restarts — once trusted, it stays trusted.

**Automatic (per-session, when `systemWideCert: false`):** Agitha sets the following env vars automatically for every agent session:

| Env Var | Covers |
|---------|--------|
| `NODE_EXTRA_CA_CERTS` | Node.js, npm, SDK |
| `GIT_SSL_CAINFO` | Git HTTPS |
| `SSL_CERT_FILE` | OpenSSL-based tools, Ruby |
| `REQUESTS_CA_BUNDLE` | Python requests |
| `PIP_CERT` | pip |
| `CURL_CA_BUNDLE` | curl (when compiled against OpenSSL) |
| `CARGO_HTTP_CAINFO` | Rust/Cargo |
| `AWS_CA_BUNDLE` | AWS CLI, boto3 |
| `DENO_CERT` | Deno |

If `NODE_EXTRA_CA_CERTS` is already set in the host environment (e.g., corporate proxy), Agitha merges both certs into a combined bundle.

**Not covered by env vars (require system-wide trust):**

- **Bun** — uses the system cert store; no env var override
- **.NET (dotnet/nuget)** — uses the system cert store on macOS
- **curl on macOS** — when compiled against SecureTransport (the default), uses the system keychain rather than `CURL_CA_BUNDLE`

For these tools, system-wide trust is required.

**System-wide trust (recommended):** Trust the cert in the OS certificate store, then set `systemWideCert: true` to skip per-session env vars:

```bash
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.agitha/certs/agitha-egress-ca.pem

# Linux
sudo cp ~/.agitha/certs/agitha-egress-ca.pem /usr/local/share/ca-certificates/agitha-egress-ca.crt
sudo update-ca-certificates
```

Then update config.json:

```json
{
  "sandbox": {
    "enabled": true,
    "systemWideCert": true
  }
}
```

On startup, Agitha checks whether the cert is trusted system-wide (macOS keychain or Linux CA certificates) and logs the result:

```
🛡️  CA certificate is trusted system-wide ✓
🛡️  systemWideCert: true — per-session CA cert env vars are skipped (OS cert store handles trust)
```

or, if not yet trusted:

```
[WARN] 🛡️  CA certificate is NOT trusted in the macOS System keychain. To trust (requires sudo):
[WARN] 🛡️  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.agitha/certs/agitha-egress-ca.pem
```

---

## Global Configuration

In addition to repository-specific settings, you can configure global defaults:

### `promptDefaults` (object)

Sets default allowed tools for each prompt type across all repositories. Repository-specific configurations override these defaults.

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    },
    "scoper": {
      "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "mcp__linear"]
    }
  }
}
```

### `global_setup_script` (string)

Path to a script that runs for all repositories when creating new worktrees. See the main README for details on setup scripts.

---

## Tool Configuration Priority

When determining allowed tools, Agitha follows this priority order:

1. Repository-specific prompt configuration (`labelPrompts.debugger.allowedTools`)
2. Global prompt defaults (`promptDefaults.debugger.allowedTools`)
3. Repository-level allowed tools (`allowedTools`)
4. Global default allowed tools
5. Safe tools fallback (all tools except Bash)

---

## Example Configuration

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    }
  },
  "repositories": [{
    "id": "workspace-123456",
    "name": "my-app",
    "repositoryPath": "/path/to/repo",
    "allowedTools": ["Read", "Edit", "Bash(git:*)", "Bash(gh:*)", "Task"],
    "mcpConfigPath": "./mcp-config.json",
    "teamKeys": ["BACKEND"],
    "projectKeys": ["API Service", "Backend Infrastructure"],
    "routingLabels": ["backend", "api", "infrastructure"],
    "labelPrompts": {
      "debugger": {
        "labels": ["Bug", "Hotfix"],
        "allowedTools": "all"
      },
      "builder": {
        "labels": ["Feature"]
      },
      "scoper": {
        "labels": ["RFC", "Design"]
      }
    }
  }]
}
```

---

## Core Repository Fields

Each repository configuration includes these required fields:

- `id` - Unique identifier for the repository
- `name` - Repository name
- `repositoryPath` - Absolute path to the repository on disk
- `baseBranch` - Default branch for the repository (e.g., "main")
- `githubUrl` - GitHub repository URL (e.g., `"https://github.com/org/repo"`) — used for webhook matching and routing
- `gitlabUrl` - GitLab repository URL (e.g., `"https://gitlab.com/group/project"`) — used for webhook matching and routing
- `workspaceBaseDir` - Directory for git worktrees
- `isActive` - Whether the repository is active
- `linearWorkspaceId` - Linear workspace UUID (references a key in `linearWorkspaces`)

These fields are managed automatically during setup. For self-hosted instances, use the `agitha self-auth-linear` and `agitha self-add-repo` commands.
