# CLAUDE.md — Ants

## Project Overview

Ants is a framework for deploying autonomous LLM-based agents. Each "ant" is a **Claude Code subprocess** managed by a **colony runner** process. The project has three deliverables:

1. **Core framework** — library that handles ant lifecycle, integration bridges, and confirmation flows
2. **CLI** (`ants`) — command-line tool for scaffolding, validating, and managing colonies
3. **Docker runtime** — a container-based deployment that runs a colony 24/7

## Architecture

### Key Terms

| Term | Definition |
|---|---|
| **Ant** | A Claude Code subprocess configured via YAML to do autonomous work |
| **Colony** | A set of ants deployed together with shared configuration |
| **Colony runner** | The host process that spawns, monitors, and manages ants |
| **Integration** | A connector to an external service (Discord, GitHub, Jira, etc.) |
| **Backlog** | A queue of work items discovered automatically (e.g. from GitHub Issues) |

### Component Diagram

```
┌─────────────────────────────────────────────────┐
│  Colony Runner                                  │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Ant     │  │  Ant     │  │ Integration  │  │
│  │ (Claude  │  │ (Claude  │  │   Bridge     │  │
│  │  Code)   │  │  Code)   │  │ Discord/GH   │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
         ↕                            ↕
  External services            Human operator
  (GitHub, etc.)            (Discord / Slack)
```

### Ant Lifecycle

1. Colony runner reads ant YAML configs at startup
2. For each ant: runner spawns a Claude Code subprocess, injects the ant's `instructions` as its system context
3. Ant enters its work loop:
   - Check schedule / poll triggers / read Discord commands
   - Discover work from backlog source (GitHub Issues, Jira, etc.)
   - Execute work using Claude Code's tools (file edits, shell commands, API calls)
   - For dangerous/irreversible actions: pause and send a Discord confirmation request
   - Resume after human reacts ✅ (proceed) or ❌ (skip), or after timeout (treat as ❌)
   - Report results and status to Discord
4. Colony runner monitors the subprocess; restarts it on unexpected exit

### Confirmation Flow (Detail)

```
Ant identifies a dangerous action
          ↓
Post message to Discord channel:
  "About to [action]. Proceed?"
  [add ✅ reaction] [add ❌ reaction]
          ↓
Ant suspends (blocks on event)
          ↓
Human reacts ✅ or ❌  (or timeout elapses)
          ↓
Ant resumes: proceed or skip action
```

- Timeout is configurable per colony (`confirmation_timeout` in `colony.yaml`); default: deny
- Confirmations are logged with the human's Discord username

## Config Schema

### `colony.yaml`

```yaml
name: string                  # colony identifier
integrations:
  discord:
    token: string             # env var reference, e.g. ${DISCORD_TOKEN}
    guild: string             # Discord server name or ID
  github:
    token: string             # env var reference
defaults:
  confirmation_timeout: duration   # e.g. "30m"; action on timeout is deny
```

### `ants/<name>.yaml`

```yaml
name: string                  # ant identifier; used in Discord messages and logs
description: string           # human-readable purpose

instructions: |               # injected as Claude Code system context
  ...

integrations:
  github:
    repos: [string]           # list of repos this ant can access
  discord:
    channel: string           # channel for this ant's updates and confirmations

schedule:
  cron: string                # cron expression; omit if event-only

triggers:                     # events that wake a sleeping ant
  - type: github_issue
    labels: [string]
  - type: discord_command

backlog:                      # automatic work discovery (planned)
  source: github_issues | jira | linear
  filter:
    labels: [string]
    assignee: string
```

## Integration Interface

Each integration must implement a standard interface:

```
connect()                     → establishes connection; throws on failure
disconnect()                  → clean shutdown
on(event, handler)            → subscribe to incoming events
emit(message)                 → send a message to the integration's channel/endpoint
addReaction(messageId, emoji) → add a reaction to a message (Discord-specific)
waitForReaction(messageId, options) → async wait for a user reaction
```

Integrations are isolated packages with their own dependencies.

## Security Model

- Integration tokens live in environment variables only — never in YAML config files
- Dangerous actions always require explicit Discord confirmation unless whitelisted
- Each ant runs as an isolated subprocess with only the tools its config specifies
- Docker deployment: one container per ant (or one container per colony) for process isolation

## Directory Structure (planned)

```
ants/
  packages/
    core/               # colony runner, ant lifecycle, event bus
    cli/                # `ants` CLI (init, validate, start, stop, status, logs, run)
    integrations/
      discord/          # Discord integration
      github/           # GitHub integration
      slack/            # Slack integration (planned)
      jira/             # Jira integration (planned)
      linear/           # Linear integration (planned)
  config/
    examples/           # example colony and ant YAML files
  docker/               # Dockerfile and docker-compose templates
  docs/                 # extended documentation
```

## Conventions (to be confirmed when stack is chosen)

- Each integration is a separate package to isolate dependency footprint
- Colony runner must be resilient: an ant crashing must not crash the runner
- Config validation is strict: fail fast on invalid YAML at startup
- All external I/O (API calls, subprocess I/O) must be async/non-blocking
- Secrets are never logged

## Open Decisions

- **Language/runtime**: undecided (TypeScript/Node.js is natural for the Claude API/SDK ecosystem, but not committed)
- **Claude Code subprocess API**: how to drive Claude Code programmatically (headless mode, agent SDK, or direct API with tool execution)
- **One container per ant vs. one container per colony**: tradeoff between isolation and resource use
- **Ant state persistence**: does an ant remember context across restarts, and if so, how?
