# Colony

Colony is a framework for deploying autonomous LLM-based agents. Each ant is an agent session — powered by [Claude](https://github.com/anthropics/claude-agent-sdk) or [Gemini](https://github.com/google-gemini/gemini-cli) — configured to do work autonomously while you focus on other things.

Ants can maintain software projects, write blog posts, process data, or do anything an LLM agent can do &mdash; guided by a YAML config file and reporting back to you via Discord.

**[Documentation](https://ndv.github.io/colony/)** · [Getting started](https://ndv.github.io/colony/getting-started) · [Configuration reference](https://ndv.github.io/colony/configuration) · [Docker](https://ndv.github.io/colony/docker)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ndv/colony/main/install.sh | sh
```

Downloads a standalone binary to `~/.local/bin/colony`. No dependencies required.

See [docs/cli.md](docs/cli.md) for manual download, Windows instructions, and other options.

---

## Core Concepts

### Ant
An **ant** is an agent session (Claude or Gemini) running in-process with a defined purpose. Each ant:
- Is declared in a YAML config file (name, instructions, integrations, schedule)
- Runs autonomously: on a schedule, in response to events, on human command, or from its own backlog
- Reports its activity to Discord; optionally asks for human approval before dangerous actions
- Has access to only the tools and repos it needs

### Colony
A **colony** is a group of ants deployed together under a shared configuration. A colony can contain multiple specialized ants (one per project) or a single generalist ant.

### Colony Runner
The **colony runner** is the host process that manages the Agent SDK sessions for all ants in a colony. It reads the colony config, starts each ant as an in-process Agent SDK session, bridges messages between ants and external integrations, and restarts ants that fail.

## How It Works

```
Human (Discord)
       ↕
Colony Runner
       ↕
Ant (Claude or Gemini agent session, running in-process)
       ↕
External services (GitHub, etc.)
```

1. You define your ants in YAML config files inside a colony directory
2. You deploy the colony via Docker (or run it locally with the CLI)
3. The colony runner starts each ant as an Agent SDK session with its instructions
4. Each ant enters its work loop: polling for tasks, reacting to events, or waiting for human commands
5. When a dangerous action is detected, Colony applies the ant's autonomy policy: ask Discord (`human`), auto-approve (`full`), or auto-deny (`strict`)
6. Ants report progress, results, and errors to their designated Discord channel

## Ant Configuration

Each ant is declared in a single YAML file:

```yaml
name: alice
description: Maintains the my-app repository — reviews issues, implements fixes, opens PRs

instructions: |
  You are Alice, a software engineer responsible for the my-app repository.
  Review open GitHub issues labelled 'ant-ready', implement fixes, and open PRs.
  Always run the test suite before opening a PR. Never force-push to main.

engine: claude       # "claude" (default) or "gemini"
autonomy: human      # "human" (default) | "full" | "strict"
                     # human:  dangerous actions forwarded to Discord for approval
                     # full:   fully autonomous, no confirmation prompts
                     # strict: dangerous actions auto-denied, no Discord contact

integrations:
  github:
    repos:
      - my-org/my-app
  discord:
    channel: alice-logs      # channel where alice posts updates and asks for confirmation

schedule:
  cron: "0 9 * * 1-5"        # start working at 9 am on weekdays

triggers:
  - type: github_issue        # wake up when a matching issue is opened
    labels: [ant-ready]
  # discord_command trigger makes the ant event-only (no autonomous loop).
  # All ants accept human messages/commands regardless of this setting.
```

### Colony-Level Config

Shared settings (tokens, default integrations, global defaults) live in a top-level `colony.yaml`:

```yaml
name: my-colony

integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: my-server
  github:
    token: ${GITHUB_TOKEN}

defaults:
  confirmation_timeout: 30m   # treat no Discord reaction within 30 min as deny
```

## Human ↔ Ant Communication

Each ant has a dedicated Discord channel.

### Ant → Human

The ant posts to the channel as it works:
- Status: `🐜 starting`, `✅ session complete`, `❌ crashed: … Restarting in 10s…`
- Narration: the ant's own text output describing what it's doing
- Confirmation requests when a dangerous action is detected (requires ✅/❌ reaction)
- Pause/resume acks: `⏸️ will pause after current session`, `▶️ resuming`

### Human → Ant

Write in the ant's channel at any time — no special configuration needed.

**Slash commands** are intercepted by the colony runner and answered immediately (no tokens consumed):

| Command | Effect |
|---|---|
| `/help` | List available commands |
| `/status` | Current state (running / paused) and queue depth |
| `/stats` or `/usage` | Uptime and session statistics |
| `/pause` or `/stop` | Pause after the current session |
| `/resume` or `/start` | Resume a paused ant |
| `/clear` | Discard all queued work items |

**Any other message** is forwarded to the ant as a work instruction. If the ant is paused, it auto-resumes.

Example:
```
you:   Fix the failing auth tests
ant:   ▶️ **alice** resuming.
ant:   Starting on the failing auth tests…
```

React ✅ or ❌ to approve or deny a confirmation request.

### Autonomy and Confirmation

Each ant's `autonomy` setting controls what happens when a dangerous action is detected (`git push`, `rm -rf`, `sudo`, pipe-to-shell, SQL drops, etc.):

| `autonomy` | Behaviour |
|---|---|
| `human` | Pauses and posts a Discord message with ✅/❌ reactions. Timeout = deny. |
| `full` | Auto-approves everything. No Discord prompts. |
| `strict` | Auto-denies everything flagged. No Discord prompts. |

Additional rules — specific tools or bash patterns that should always be flagged — are configured separately in the `confirmation` block.

## Documentation

- [Getting started](./docs/getting-started.md) — install, scaffold, configure, and run your first colony
- [Configuration reference](./docs/configuration.md) — all `colony.yaml` and `ants/*.yaml` options with examples
- [CLI reference](./docs/cli.md) — `colony init`, `validate`, `run`
- [Docker deployment](./docs/docker.md) — docker compose and docker run, persistent state, multi-colony setups

## Deployment

Colony is designed to run in Docker. Install the CLI first (`curl … | sh`), scaffold a colony directory, then containerize it. You do not need to clone or build the repository.

A typical colony layout:

```
my-colony/
  colony.yaml             # colony-level config and shared settings
  ants/
    alice.yaml            # ant config
    bob.yaml              # ant config
  .env                    # secrets (DISCORD_TOKEN, GITHUB_TOKEN, etc.)
```

To build and run with Docker:

```bash
docker build -f docker/Dockerfile -t colony .
docker run --env-file .env -v $(pwd):/colony -w /colony colony run .
```

Or with docker-compose from inside the `docker/` directory:

```bash
docker compose up
```

## CLI

The `colony` CLI manages colonies from your terminal:

```
colony init [dir]         # scaffold a new colony directory (default: ./my-colony)
colony validate [dir]     # validate colony and ant config files
colony run [dir]          # start the colony runner (all ants)
```

See [docs/cli.md](./docs/cli.md) for installation instructions and full command reference.

## Feature Matrix

| Feature | Status | Notes |
|---|---|---|
| Colony runner & supervisor | ✅ Available | Crash recovery, auto-restart, pause/resume |
| Claude Agent SDK engine | ✅ Available | In-process agent sessions with hook support |
| Gemini CLI engine | ✅ Available | Subprocess-based, `engine: gemini` |
| Autonomy levels | ✅ Available | `human`, `full`, `strict` |
| Confirmation flow | ✅ Available | Discord reactions, timeout, dangerous action detection |
| Cron scheduling | ✅ Available | Standard cron expressions via `schedule.cron` |
| Config validation (Zod) | ✅ Available | Env var interpolation, fail-fast on invalid config |
| State persistence | ✅ Available | Memory and SQLite backends |
| PostToolUse logging | ✅ Available | Configurable: `off`, `impactful`, `all` |
| Discord integration | ✅ Available | Messages, reactions, slash commands, confirmations |
| GitHub integration | 🔄 Partial | List issues, post comments, issue polling triggers |
| GitHub PR creation | 📋 Planned | Ants can use `gh` CLI as a workaround |
| GitHub webhooks | 📋 Planned | Currently polls every 5 minutes |
| Backlog management | 📋 Planned | Auto-discover tasks from GitHub/Jira/Linear |
| Session interruption | 📋 Planned | Commands take effect after current session completes |
| Session persistence | 📋 Planned | Ants restart without prior context (`persistSession: false`) |
| Slack integration | 📋 Planned | Alternative to Discord |
| Jira integration | 📋 Planned | Read tickets as ant backlog |
| Linear integration | 📋 Planned | Read issues as ant backlog |
| Health check endpoint | 📋 Planned | HTTP endpoint for Docker monitoring |
| CLI: init / validate / run | ✅ Available | Scaffold, check config, start colony |
| CLI: version / update | ✅ Available | Binary distribution with auto-update |
| Docker deployment | ✅ Available | Dockerfile, docker-compose, docs |
| Install script | ✅ Available | `curl \| sh` for Linux, macOS, WSL |

## Roadmap

- [x] Colony runner: ant lifecycle management (spawn, monitor, restart)
- [x] Claude Agent SDK session integration
- [x] Gemini CLI engine support (`engine: gemini`)
- [x] Autonomy levels: `human`, `full`, `strict`
- [x] Discord integration: message send/receive, confirmation reactions, human commands (pause/resume/instruct)
- [x] Discord slash commands: `/help`, `/status`, `/stats`, `/pause`, `/resume`, `/clear`
- [x] GitHub integration: issue reading, comment creation, issue polling triggers
- [x] Cron scheduling for ants
- [x] CLI: `init`, `validate`, `run`
- [x] Docker / docker-compose deployment support
- [x] Configurable PostToolUse logging (`"off"` / `"impactful"` / `"all"`)
- [ ] Backlog management: auto-discover tasks from GitHub Issues
- [ ] GitHub webhook triggers (replace polling)
- [ ] Slack integration
- [ ] Jira integration
- [ ] Linear integration

## License

[MIT](./LICENSE)
