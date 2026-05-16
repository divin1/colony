# Getting Started

Colony deploys autonomous LLM agents ("ants") that work continuously, react to events, and check in with you over Discord before taking irreversible actions. This guide walks you from zero to a running colony.

## Prerequisites

- **An agent engine** — at least one of:
  - **Anthropic API key** (`ANTHROPIC_API_KEY`) — for Claude-powered ants (the default). Sign up at [console.anthropic.com](https://console.anthropic.com) and create a key under **API Keys**. This is a pay-per-token account separate from any Claude.ai or Claude Code subscription — a subscription does not grant API access.
  - **Gemini API key** (`GEMINI_API_KEY`) — for Gemini-powered ants. Get a free key at [aistudio.google.com](https://aistudio.google.com) under **Get API key**. Google AI Studio has a free tier, making this the zero-cost option to get started.
- **A GitHub token** *(optional)* — needed only if you want ants that read issues or interact with GitHub repos.
- **Discord** *(optional)* — for remote visibility and control. Three options, in order of setup effort:
  - **Full Discord bot** (`DISCORD_TOKEN`) — two-way: ants post status updates, you send commands back. Requires bot setup (see below).
  - **Webhook** (`DISCORD_WEBHOOK_URL`) — send-only notifications posted to a Discord channel. No bot needed — just create an Incoming Webhook in your server's channel settings.
  - **None** — all output goes to the terminal. Use this to try Colony locally before setting up any messaging.

### Setting up a Discord bot *(optional — only for full two-way control)*

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, enable **Message Content Intent** and **Server Members Intent**.
3. Copy the **bot token** — this becomes `DISCORD_TOKEN` in your `.env`.
4. Under **OAuth2 → URL Generator**, select scopes `bot` and permissions: *Send Messages*, *Add Reactions*, *Read Message History*. Open the generated URL to invite the bot to your server.
5. Create one Discord text channel per ant (e.g. `#worker-logs`). The bot needs access to those channels.

---

## Step 1 — Install Colony

```bash
curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
```

This downloads a standalone binary to `~/.local/bin/colony`. No runtime dependencies required.

If `~/.local/bin` is not on your PATH yet:

```bash
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc
```

Verify:

```bash
colony --version
```

> **Windows:** Download `colony-windows-x64.exe` from the [latest release](https://github.com/divin1/colony/releases/latest) and add it to a directory on your PATH.

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
  .env                 # fill in your tokens here
```

Colony directories are local on-disk configurations — not git repositories. If you later choose to commit your colony config to git, add a `.gitignore` to exclude `.env` from version control.

Move into the directory and fill in your secrets:

```bash
cd my-colony
```

Open `.env` and fill in your tokens:

```env
ANTHROPIC_API_KEY=your-anthropic-api-key         # required for claude-cli ants (default engine)
GEMINI_API_KEY=your-gemini-api-key               # required for gemini-cli ants
DISCORD_TOKEN=your-discord-bot-token             # optional — for full Discord bot integration
DISCORD_WEBHOOK_URL=https://discord.com/api/...  # optional — for webhook-only notifications
GITHUB_TOKEN=your-github-personal-access-token   # optional — for GitHub triggers and repos
```

> **Secrets stay in `.env` only.** YAML files never contain tokens — they reference environment variables with `${VAR_NAME}` syntax.

---

## Step 3 — Configure the colony

Edit `colony.yaml`. The simplest possible config needs only a name:

```yaml
name: my-colony
```

Add integrations as needed:

```yaml
name: my-colony

integrations:
  # Full Discord bot — two-way control (pause, resume, work instructions).
  discord:
    token: ${DISCORD_TOKEN}
    guild: My Server          # name or ID of your Discord server

  # OR: webhook-only — send-only status notifications, no bot setup needed.
  # discord_webhook:
  #   url: ${DISCORD_WEBHOOK_URL}

  github:
    token: ${GITHUB_TOKEN}   # remove this block if you don't need GitHub

defaults:
  poll_interval: 5m          # pause between runs for ants with no triggers or schedule
```

`name` is used in startup logs and Discord messages. When using the full Discord bot, `guild` must match the server name or numeric ID exactly.

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
| `engine` | `claude-cli` (default), `gemini-cli`, `codex`, `opencode`, or `cli`. Selects the CLI tool for this ant. |
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

**`discord_command`** — makes the ant event-only: it only runs when you send a message in its Discord channel (rather than running autonomously on a loop). Slash commands (`/pause`, `/stop`, `/resume`, `/start`, etc.) and the plain-text equivalents (`pause`, `stop`, `resume`, `start`) are handled at the runner level and are never forwarded as work instructions.

```yaml
triggers:
  - type: discord_command
```

Ants can have multiple triggers. An ant with no triggers and no schedule runs continuously (sleeping for `poll_interval` between sessions).

> **Note:** You can send messages and control commands to *any* ant through its Discord channel — the `discord_command` trigger only affects whether the ant runs autonomously between messages, not whether it listens.

### Writing good instructions

Instructions are injected as additional context into the agent's system prompt. A few principles:

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
- Text responses from Claude as it narrates its work
- Confirmation requests (see below) for dangerous actions
- `✅ **worker** completed its work session.` when the run finishes

If something goes wrong, the supervisor posts a message and responds based on the type of error:

| Message | Cause | What happens next |
|---|---|---|
| `❌ **worker** crashed: … Restarting in Xs…` | Transient error (server error, network, etc.) | Restarts automatically after exponential backoff (10 s, 20 s, 40 s… up to 5 min) |
| `⏳ **worker** is rate limited. Resuming in Xs…` | API rate limit hit | Waits until the rate limit resets (uses the exact timestamp from the API if available) |
| `🚫 **worker** encountered a permanent error: … Restarting in Xs…` | Invalid request or structured output failure | Restarts after backoff; check your ant's instructions or config |
| `💳 **worker** has a billing error — check your Anthropic account. Pausing until resumed.` | Billing / payment issue | **Ant pauses indefinitely.** Fix the issue (refill credits, update payment), then type `/resume` in the channel. |
| `🔐 **worker** failed to authenticate — check credentials. Pausing until resumed.` | Bad API key | **Ant pauses indefinitely.** Fix the credential (update `.env`, restart), then type `/resume`. |
| `💰 **worker** exceeded its USD budget cap. Pausing until resumed.` | USD budget cap hit | **Ant pauses indefinitely.** Top up credits or raise the budget cap, then type `/resume`. |

Turn-limit completions (`error_max_turns`) are treated as normal sessions — no error message is posted and the ant restarts immediately.

See [Supervisor behavior](./supervisor.md) for the full reference on error categories and backoff.

### Sending commands to an ant

Every ant listens to its Discord channel for human messages. You can write there at any time.

**Slash commands** are intercepted by the colony runner and answered immediately — no LLM round-trip, no tokens consumed:

| Command | Effect |
|---|---|
| `/help` | List available commands |
| `/status` | Current state (running / paused) and queue depth |
| `/stats` or `/usage` | Uptime and session statistics |
| `/pause` or `/stop` | Pause after the current session |
| `/resume` or `/start` | Resume a paused ant |
| `/clear` | Discard all queued work items |

**Any other message** is forwarded to the ant as a direct work instruction. If the ant is paused, it auto-resumes.

```
you:    Fix the failing tests in packages/core
worker: ▶️ **worker** resuming.
worker: Starting on the failing tests…
```

This works for all ants regardless of their `triggers` configuration. No special setup is required beyond the ant having a Discord channel.

---

## Web dashboard

Colony includes a local web dashboard for monitoring ants, assigning work on a Kanban board, and editing configuration through forms — no terminal or YAML required after initial setup.

Enable it by adding `monitoring.port` to `colony.yaml`:

```yaml
monitoring:
  port: 8080
```

Then start the web frontend in a second terminal:

```bash
bun --cwd packages/web next dev   # http://localhost:3000
```

The frontend proxies all API calls to `http://localhost:8080` (set `COLONY_API_URL` to override).

To protect the dashboard with an API key, set `COLONY_API_KEY` in the runner's environment. The web frontend will prompt for the key on first load.

---

## MCP server (Claude Desktop / Claude Code integration)

If you use Claude Desktop or Claude Code, you can manage your colony directly from Claude via the MCP server:

```bash
colony mcp --url http://localhost:8080
```

Configure once in `claude_desktop_config.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "colony": {
      "command": "colony",
      "args": ["mcp", "--url", "http://localhost:8080"]
    }
  }
}
```

This gives Claude tools to check ant status, queue work instructions, pause/resume ants, and stream recent output. See [mcp.md](./mcp.md) for the full reference.

---

## Next steps

- **Production deployment** — see [docker.md](./docker.md) to run your colony 24/7 in a container.
- **Full config reference** — see [configuration.md](./configuration.md) for every available option.
- **CLI reference** — see [cli.md](./cli.md) for all commands and flags.
- **MCP integration** — see [mcp.md](./mcp.md) for Claude Desktop / Claude Code setup.
- **More ant examples** — see `config/examples/` for a code reviewer, issue triager, and dependency updater.
