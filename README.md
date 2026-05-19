# Colony

Colony is a framework for deploying autonomous LLM-based agents. Each **ant** is an agent session driven by a CLI tool (claude, gemini, codex, or your own binary), configured via YAML, and managed by a persistent supervisor process. Ants can maintain software projects, write code, process data, or do anything an LLM agent can do — working continuously from a Kanban board while you stay in control.

**[Documentation](https://divin1.github.io/colony/)** · [Getting started](https://divin1.github.io/colony/getting-started) · [Configuration reference](https://divin1.github.io/colony/configuration) · [Docker](https://divin1.github.io/colony/docker)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
```

Downloads a standalone binary to `~/.local/bin/colony`. No runtime dependencies required.

See [docs/cli.md](docs/cli.md) for manual download, Windows instructions, and other options.

---

## Core Concepts

### Ant
An **ant** is an agent session running as a supervised CLI subprocess. Each ant:
- Is declared in a YAML config file (name, instructions, engine, schedule, triggers)
- Runs autonomously: on a cron schedule, on Discord command, or continuously
- Picks up tasks from the Kanban board; reports progress and results
- Has its own Discord channel for status updates and human commands (optional)

### Colony
A **colony** is a group of ants deployed together under a shared configuration. A colony can contain multiple specialized ants (one per project, role, or workflow) or a single generalist.

### Colony Runner
The **colony runner** is the host process that manages all ants. It reads YAML configs, spawns each ant's CLI binary as a child process, streams output, bridges integrations, and supervises restart behavior on failure.

---

## How It Works

```
Human (web dashboard or Discord)
              ↕
        Colony Runner
              ↕
  Ant (CLI subprocess: claude, gemini, …)
              ↕
     External services (git, gh, etc.)
```

1. Define ants in YAML inside a colony directory
2. Deploy via Docker (or run locally with `colony run`)
3. The runner spawns each ant's CLI binary, streams its output, and manages its lifecycle
4. Assign tasks through the web dashboard's Kanban board — ants pick them up automatically
5. Ants report progress to Discord; humans review completed work before marking it done
6. The web dashboard shows live output, task status, and lets you edit config without restarting

---

## Ant Configuration

Each ant is declared in a single YAML file:

```yaml
name: worker
description: Software engineer — implements tasks from the Kanban board

engine: claude-cli   # "claude-cli" (default) | "gemini-cli" | "codex" | "opencode" | "cli"

instructions: |
  You are Worker, a software engineer for the acme/platform repository.
  Each session you receive a task. Implement it, run the tests, and open a PR.
  Never force-push to main. Never merge your own PRs.

integrations:
  discord:
    channel: worker-logs   # optional — where the ant posts updates

triggers:
  - type: discord_command  # only run when a human sends a message (event-only mode)
  # omit triggers entirely for continuous/cron-based operation

schedule:
  cron: "0 9 * * 1-5"     # optionally also run on a schedule

skills:
  - skills/code-review-standards.md   # optional instruction files injected at session start

state:
  backend: sqlite          # persist session memory across restarts
  path: ./worker-state.db
```

### Colony-Level Config

Shared settings live in `colony.yaml`:

```yaml
name: my-colony

integrations:
  discord:                 # optional
    token: ${DISCORD_TOKEN}
    guild: my-server

defaults:
  poll_interval: 5m
  git:
    user_name: "Your Name"
    user_email: "you@example.com"

monitoring:
  port: 8080               # enables web dashboard at http://localhost:8080
```

---

## Human ↔ Ant Communication

### Web Dashboard (primary)

Enable the dashboard with `monitoring.port` in `colony.yaml`, then open `http://localhost:8080`.

- **Kanban board** — create projects, add tasks (Backlog → To Do → In Progress → In Review → Done), assign to ants or yourself; ants pick up To Do tasks automatically
- **Ant detail** — live output stream, recent tasks, session memory, config editor
- **Skill manager** — create and edit skill files that inject instructions into ant sessions
- **MCP** — control Colony from Claude Desktop or Claude Code via `colony mcp`

### Discord (optional)

Each ant listens to its configured Discord channel. Write there at any time.

**Slash commands** are intercepted by the runner and answered immediately — no tokens consumed:

| Command | Effect |
|---|---|
| `/help` | List available commands |
| `/status` | Current state and queue depth |
| `/stats` | Uptime and session statistics |
| `/pause` or `/stop` | Pause before the next task |
| `/resume` or `/start` | Resume a paused ant |
| `/clear` | Move all queued tasks back to backlog |

**Any other message** is queued as a task for the ant. If paused, it auto-resumes.

### Status messages posted by ants

| Emoji | Event |
|---|---|
| 🐜 | Ant starting |
| ✅ | Session completed successfully |
| ❌ | Transient crash — exponential backoff (10 s → 20 s → 40 s… cap 5 min) |
| ⏳ | Rate limited — waits until reset |
| 🚫 | Permanent error — backoff then retry |
| 💳 | Billing error — paused until human sends `/resume` |
| 🔐 | Auth error — paused until human sends `/resume` |
| 💰 | Budget cap hit — paused until human sends `/resume` |
| ⏸️ | Pause acknowledged |
| ▶️ | Resuming |

---

## Deployment

Colony runs in Docker. Install the CLI, scaffold a colony directory, then use the two-service compose setup (runner + web dashboard):

```
my-colony/
  colony.yaml
  ants/
    worker.yaml
  .env             # ANTHROPIC_API_KEY, DISCORD_TOKEN, COLONY_API_KEY, etc.
  docker-compose.yml
```

```bash
docker compose build
docker compose up -d
```

Open **http://localhost:8080**. Set `COLONY_API_KEY` in `.env` to protect the dashboard with a Bearer token.

See [Docker deployment guide](docs/docker.md) for full instructions including persistent state, multi-colony setups, and config hot-reload.

---

## CLI

```
colony init [dir]       # scaffold a new colony directory
colony validate [dir]   # validate config without starting
colony run [dir]        # start the colony runner
colony mcp              # start the MCP server for Claude Desktop / Claude Code
colony version          # show current version
colony update           # download the latest binary
```

See [CLI reference](docs/cli.md) for all options and flags.

---

## Feature Matrix

| Feature | Status |
|---|---|
| Colony runner & supervisor | ✅ |
| Typed error classification (rate limit, billing, auth, budget, transient, permanent) | ✅ |
| Exponential backoff | ✅ |
| Mid-session interrupt (SIGTERM on pause) | ✅ |
| `claude-cli` engine (NDJSON stream parsing) | ✅ |
| `gemini-cli`, `codex`, `opencode`, custom `cli` engines | ✅ |
| Cron scheduling | ✅ |
| Discord command trigger | ✅ |
| Discord integration (optional) | ✅ |
| Discord webhook (send-only, no bot) | ✅ |
| Web dashboard (Kanban, config editor, live output) | ✅ |
| Project & task management | ✅ |
| Skill management UI | ✅ |
| Session memory (SQLite) | ✅ |
| Real-time SSE push | ✅ |
| API key auth | ✅ |
| Hot reload | ✅ |
| MCP server (Claude Desktop / Claude Code) | ✅ |
| Docker two-service deployment | ✅ |
| CLI binary distribution + auto-update | ✅ |
| Config validation (Zod, env interpolation) | ✅ |

---

## License

[MIT](./LICENSE)
