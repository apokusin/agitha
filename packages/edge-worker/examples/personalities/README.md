# Personality Examples

Two complete custom-personality examples that exercise the full feature set documented in `docs/CONFIG_FILE.md#custom-personalities`. Use them as starting points for your own roles.

## Examples

### `copy-writer.md`

A blog-post / announcement / long-form content personality. Demonstrates:

- **`writeScopes`** — limits the agent's `Write` capability to `./content/**` so it can only produce articles in one directory tree
- **`referenceDirs`** — points the agent at past articles and a voice guide so it learns the house style instead of hallucinating one
- **`requireAllLabels`** — fires only on the combination `["Article", "Draft"]`, not on every "Article"
- **Read-friendly tool set** — includes `Read`, `Glob`, `Grep`, `WebFetch` so the agent can research; excludes `Bash` and unscoped `Edit`

### `code-reviewer.md`

A read-only code-review personality. Demonstrates:

- **`allowedTools: "readOnly"`** — the bundled preset, ensures no writes anywhere
- **`model` override** — pins to `claude-opus-4-7` for stronger analytical reasoning
- **No `referenceDirs`** — reviewers read the diff in the PR, not a static corpus
- **Description** — surfaces the role's identity in the Linear timeline

## Wiring them into `config.json`

Add the personalities under `customPersonalities` either workspace-wide (top-level) or per-repository:

```json
{
  "customPersonalities": {
    "copy-writer": {
      "labels": ["Article", "Draft"],
      "requireAllLabels": true,
      "promptPath": "~/.agitha/personalities/copy-writer.md",
      "allowedTools": ["Read", "Glob", "Grep", "WebFetch", "Write"],
      "writeScopes": ["./content/**"],
      "referenceDirs": ["./content/voice", "./content/posts"],
      "description": "Long-form content writer following house style"
    },
    "code-reviewer": {
      "labels": ["Code Review", "PR Review"],
      "promptPath": "~/.agitha/personalities/code-reviewer.md",
      "allowedTools": "readOnly",
      "model": "claude-opus-4-7",
      "description": "Read-only code review — surfaces bugs, doesn't merge"
    }
  },
  "repositories": [
    {
      "id": "my-blog",
      "name": "Blog",
      "repositoryPath": "~/repos/blog",
      "baseBranch": "main",
      "workspaceBaseDir": "~/.agitha/worktrees"
    }
  ]
}
```

Copy the markdown files into the path you put in `promptPath` (here, `~/.agitha/personalities/`). The path supports `~/` expansion and is resolved at config load time.

## Triggering them

### From Linear labels

For the copy-writer, add **both** `Article` and `Draft` to the issue (the `requireAllLabels: true` flag means a single label won't fire). For the code-reviewer, add `Code Review` or `PR Review`.

### From the issue description

Either personality also accepts the `[personality=<key>]` description tag for ad-hoc invocation without managing labels:

```
Brief: write a 600-word piece on our edge-networking improvements.
Target audience: developers evaluating Cloudflare Workers vs Fly.io.

[personality=copy-writer]
```

The description tag takes precedence over label matching, so any issue carrying it will be routed to the named personality even when the labels would otherwise pick something else.

## What you should change before using these in your own setup

- **`referenceDirs` paths in `copy-writer.md`** are relative to the worktree (Agitha resolves them at session start). If your content lives elsewhere, point them where it actually is.
- **The house-style section of `copy-writer.md`** is opinionated. Replace it with your own voice guide before shipping.
- **The label list in `code-reviewer.md`** is just an example. Match the labels your team actually uses for review requests.
- **Both personalities open PRs / post Linear comments.** Confirm that the credentials Agitha runs with have the required GitHub / Linear scopes before you depend on them in a real workflow.
