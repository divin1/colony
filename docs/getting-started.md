# Getting Started

Colony deploys autonomous LLM agents ("ants") that work continuously, react to events, and check in with you over Discord before taking irreversible actions. This guide walks you from zero to a running colony.

## Prerequisites

- **[Bun](https://bun.sh) 1.x** — Colony's runtime. Install with `curl -fsSL https://bun.sh/install | bash`.
- **A Discord bot** — ants communicate through Discord. You need a bot token and a server where the bot has been invited with message + reaction permissions.
- **An Anthropic API key** — ants run on Claude via the Agent SDK. Set `ANTHROPIC_API_KEY` in your environment.
- **A GitHub token** *(optional)* — needed only if you want ants that read issues or interact with GitHub repos.

### Setting up a Discord bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, enable **Message Content Intent** and **Server Members Intent**.
3. Copy the **bot token** — this becomes `DISCORD_TOKEN` in your `.env`.
4. Under **OAuth2 → URL Generator**, select scopes `bot` and permissions: *Send Messages*, *Add Reactions*, *Read Message History*. Open the generated URL to invite the bot to your server.
5. Create one Discord text channel per ant (e.g. `#worker-logs`). The bot needs access to those channels.

---

## Step 1 — Install Colony

Colony is not yet published to a package registry. Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/colony.git
cd colony
bun install
```

This installs all workspace packages and links the `colony` CLI binary into `node_modules/.bin/`. To use it from anywhere in your shell, add it to your PATH once:

```bash
export PATH="$PATH:$(pwd)/node_modules/.bin"
```

Or prefix every command with `bunx`:

```bash
bunx colony --help
```

Verify the install:

```bash
colony --version
# 0.1.0
```

---

## Step 2 — Scaffold a colony directory

A colony directory holds your configuration. You can generate a skeleton with:

```bash
colony init ./my-colony
```

This creates:

```
my-colony/
  colony.yaml          # top-level config: integrations, shared defaults
  ants/
    worker.yaml        # example ant config
  .env.example         # token placeholders to copy and fill in
```

Move into the directory and set up your secrets:

```bash
cd my-colony
cp .env.example .env
```

Open `.env` and fill in your tokens:

```env
DISCORD_TOKEN=your-discord-bot-token
GITHUB_TOKEN=your-github-personal-access-token   # optional
ANTHROPIC_API_KEY=your-anthropic-api-key
```

> **Secrets stay in `.env` only.** YAML files never contain tokens — they reference environment variables with `${VAR_NAME}` syntax.

---

## Step 3 — Configure the colony

Edit `colony.yaml`:

```yaml
name: my-colony

integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: My Server          # name or ID of your Discord server
  github:
    token: ${GITHUB_TOKEN}   # remove this block if you don't need GitHub

defaults:
  confirmation_timeout: 30m  # deny unacknowledged confirmations after 30 minutes
  poll_interval: 5m          # pause between runs for ants with no triggers or schedule
```

`name` is used in startup logs and Discord messages. `guild` must match the server name or numeric ID exactly.

---

## Step 4 — Create your first ant

Each file in `ants/` defines one ant. Open `ants/worker.yaml` and replace the example content with something meaningful for your use case:

```yaml
name: worker
description: Processes open GitHub issues labelled ant-ready and implements fixes

instructions: |
  You are Worker, a software engineer working on the my-org/my-repo repository.

  Each time you run:
  1. Find open issues labelled "ant-ready" using: gh issue list --label ant-ready
  2. Pick the oldest one, read it carefully, and implement a fix.
  3. Run the test suite (bun test) and fix any failures before committing.
  4. Open a pull request with a clear title and description.
  5. Post a summary of what you did to your Discord channel.

  Rules:
  - Never force-push to main.
  - Never merge your own PRs.
  - If you are blocked or unsure, stop and explain in Discord rather than guessing.

integrations:
  github:
    repos:
      - my-org/my-repo
  discord:
    channel: worker-logs    # create this channel in your Discord server

triggers:
  - type: github_issue
    labels: [ant-ready]    # wake when a matching issue is opened
  - type: discord_command  # also wake when you send a message in #worker-logs
```

### Key fields

| Field | Purpose |
|---|---|
| `name` | Identifier used in Discord messages. Must be unique within the colony. |
| `description` | One-line purpose, included in the agent's opening prompt. |
| `instructions` | The agent's primary directive. Write it as if briefing a new engineer. Be specific. |
| `integrations.discord.channel` | Discord channel name where the ant posts and listens. **Required.** |
| `integrations.github.repos` | Repos the ant may access. Format: `owner/repo`. |
| `schedule.cron` | Standard cron expression. Omit for event-only ants. |
| `triggers` | Events that wake a dormant ant (see below). |

### Trigger types

**`github_issue`** — wakes the ant when a new GitHub issue is opened matching the given labels. If `labels` is empty, any new issue triggers it.

```yaml
triggers:
  - type: github_issue
    labels: [bug, needs-fix]
```

**`discord_command`** — wakes the ant when you send any message in its Discord channel.

```yaml
triggers:
  - type: discord_command
```

Ants can have multiple triggers. An ant with no triggers and no schedule runs continuously (sleeping for `poll_interval` between sessions).

### Writing good instructions

Instructions are injected as additional context into Claude's system prompt. A few principles:

- **Be concrete.** Name the exact commands the ant should run (`gh issue list --label ant-ready`, not "look at GitHub issues").
- **Define constraints.** Tell the ant what it must never do. "Never force-push" and "never merge your own PRs" prevent expensive accidents.
- **Set the exit condition.** Describe what "done" looks like for one work session so the ant knows when to stop and report.
- **Give it a name and role.** `You are Worker, a software engineer responsible for…` gives the model a clearer frame to work from than a generic prompt.

---

## Step 5 — Validate your config

Before starting anything, check that your config parses correctly and all environment variables resolve:

```bash
colony validate .
```

Example output:

```
✓ Colony "my-colony" — config is valid.
  1 ant(s) configured:
  • worker → #worker-logs: Processes open GitHub issues labelled ant-ready and implements fixes
```

If a variable is missing or a field is invalid, `validate` exits with a clear error pointing to the problem. Fix all errors before proceeding.

---

## Step 6 — Run locally

Start the colony:

```bash
colony run .
```

The runner:
1. Connects to Discord
2. Logs `Colony "my-colony" online — 1 ant(s) starting.` to stdout
3. Posts `🐜 Ant **worker** is starting.` in `#worker-logs`
4. Begins the ant's work loop

Stop with Ctrl+C — the runner disconnects from Discord gracefully.

### Watching your ant work

Open `#worker-logs` in Discord. As the ant works you will see:
- Tool use summaries: `` 🔧 `gh issue list --label ant-ready` completed ``
- Text responses from Claude as it narrates its work
- Confirmation requests (see below) for dangerous actions
- `✅ **worker** completed its work session.` when the run finishes
- `❌ **worker** crashed: <reason>` if something goes wrong (it will restart automatically)

### Sending commands

If `discord_command` is in the ant's triggers, send a message in `#worker-logs` and the ant will wake and treat your message as a direct prompt.

---

## How confirmations work

When an ant is about to run a command that matches the built-in dangerous patterns — `git push`, `rm -rf`, `sudo`, pipe-to-shell, or SQL drops — it pauses and posts:

```
⚙️ [Confirmation required]
git push origin feature/my-fix
React ✅ to proceed or ❌ to skip (timeout: 1800s).
```

Two reactions are automatically added to the message. React ✅ to allow the action, ❌ to skip it. If you don't respond within `confirmation_timeout`, the action is denied.

You can extend the confirmation rules per ant — see [configuration.md](./configuration.md#per-ant-confirmation).

---

## Next steps

- **Production deployment** — see [docker.md](./docker.md) to run your colony 24/7 in a container.
- **Full config reference** — see [configuration.md](./configuration.md) for every available option.
- **CLI reference** — see [cli.md](./cli.md) for all commands and flags.
- **More ant examples** — see `config/examples/` for a code reviewer, issue triager, and dependency updater.
