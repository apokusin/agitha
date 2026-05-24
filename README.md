# Agitha

<div>
  <a href="https://github.com/ceedaragents/agitha/actions">
    <img src="https://github.com/ceedaragents/agitha/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>

</div>

[![Discord](https://img.shields.io/discord/1443747721910685792?label=Discord&logo=discord&logoColor=white)](https://discord.gg/prrtADHYTt)

Your (Claude Code|Codex|Cursor|Gemini) powered (Linear|GitHub|GitLab|Slack) agent. Agitha monitors (Linear|GitHub|GitLab|Slack) issues assigned to it, creates isolated Git worktrees for each issue, runs (Claude Code|Codex|Cursor|Gemini) sessions to process them, and streams detailed agent activity updates back to (Linear|GitHub), along with rich interactions like dropdown selects and approvals.

**Note:** Agitha is a BYOK platform (bring your keys / subscriptions) for tokens.

---

## Getting Started

### End-to-End Self-Hosted (Community)

Zero cost option — host everything yourself with your own Linear OAuth app, GitHub App, and Slack App. An AI-guided setup skill handles the entire onboarding: installing dependencies, configuring auth, creating integration apps, and connecting repositories — so you don't have to follow a manual guide.

```bash
npx skills add ceedaragents/agitha -g
```

Then in any AI coding agent (Claude Code, Codex, Cursor, etc.):

```
/agitha-setup
```

Or follow the **[manual setup guide](./docs/SELF_HOSTING.md)** if you prefer.

---

### Pro & Team Plans

Configure Agitha through the dashboard at [app.atagitha.com](https://app.atagitha.com).

#### For paid self-hosted deployments

It is called 'self-hosted' because it uses a machine you control as the agent runtime. Networking layer and integrations are provided by the Agitha cloud provider.

```bash
# Install Agitha
npm install -g agitha-ai

# Authenticate with your token (provided during onboarding)
agitha auth <your-token>
```

For Agitha to create pull requests or merge requests, configure Git and your hosting CLI. See **[Git & GitHub Setup](./docs/GIT_GITHUB.md)** or **[Git & GitLab Setup](./docs/GIT_GITLAB.md)**.

Keep Agitha running as a persistent process:

- **tmux**: `tmux new -s agitha` then run `agitha` (Ctrl+B, D to detach)
- **pm2**: `pm2 start agitha --name agitha`
- **systemd**: See [Running as a Service](./docs/SELF_HOSTING.md#running-as-a-service)

#### For cloud-hosted deployments

No installation required. Everything is managed through [app.atagitha.com](https://app.atagitha.com).

---

## More Documentation

- **[End-to-End Community Guide](./docs/SELF_HOSTING.md)** - Complete community manual setup
- **[Git & GitHub Setup](./docs/GIT_GITHUB.md)** - Git and GitHub CLI configuration for PRs
- **[Git & GitLab Setup](./docs/GIT_GITLAB.md)** - Git and GitLab CLI configuration for MRs
- **[Configuration Reference](./docs/CONFIG_FILE.md)** - Detailed config.json options
- **[Cloudflare Tunnel Setup](./docs/CLOUDFLARE_TUNNEL.md)** - Expose your local instance
- **[Setup Scripts](./docs/SETUP_SCRIPTS.md)** - Repository and global initialization scripts

---

## License

This project is licensed under the Apache 2.0 license - see the [LICENSE](LICENSE) file for details.

## Credits

This project builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:

- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://www.claude.com/product/claude-code)
