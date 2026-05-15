# CLAUDE.md — Colony

## Project Overview

Colony is a framework for deploying autonomous LLM-based agents. Each "ant" is an **agent session** (a CLI tool such as `claude`, `gemini`, `codex`, or any compatible binary) managed by a **colony runner** process. The project has three deliverables:

1. **Core framework** — library that handles ant lifecycle, integration bridges, and the supervisor loop
2. **CLI** (`colony`) — command-line tool for scaffolding, validating, and managing colonies
3. **Docker runtime** — a container-based deployment that runs a colony 24/7

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | No JS fallback; all packages are TS |
| Runtime | Bun | No build step; runs `.ts` directly |
| Monorepo | Bun workspaces | `package.json` at root with `workspaces` field |
| Agent engine (default) | `claude` CLI binary | Spawned as a subprocess; NDJSON stream parsed by the runner |
| Alt engines | `codex`, `gemini`, `opencode`, custom CLI | Generic CLI runner — any binary that takes a prompt as its last arg |
| Discord | `discord.js` | Most complete Discord bot library |
| GitHub | `@octokit/rest` | GitHub REST API client |
| YAML parsing | `yaml` | Config file parsing |
| Config validation | `zod` | Runtime schema validation with TS inference |
| CLI framework | `commander` | `@commander-js/extra-typings` for full TS support |
| Testing | Bun test runner | `bun test` — no separate test framework needed |

## Architecture

### Key Terms

| Term | Definition |
|---|---|
| **Ant** | An autonomous agent session driven by a CLI tool (claude, gemini, etc.), configured via YAML |
| **Colony** | A set of ants deployed together with shared configuration |
| **Colony runner** | The process that manages ant sessions, restarts them on failure, and bridges integrations |
| **Engine** | A named plugin that knows how to spawn a specific CLI tool and stream its output |
| **Integration** | A connector to an external service (Discord, GitHub, etc.) |
| **Backlog** | A queue of work items discovered automatically (e.g. from GitHub Issues) |

### Component Diagram

```
┌──────────────────────────────────────────────────────┐
│  Colony Runner (Bun process)                         │
│                                                      │
│  ┌────────────────┐  ┌────────────────┐              │
│  │  Ant           │  │  Ant           │              │
│  │  (CLI process  │  │  (CLI process  │              │
│  │   per session) │  │   per session) │              │
│  └────────────────┘  └────────────────┘              │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │  Integration Bridge                          │    │
│  │  Discord client  |  GitHub client  |  ...    │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
          ↕                              ↕
   External services              Human operator
   (GitHub, etc.)               (Discord / Slack)
```

Each ant session is a **child process** spawned by the colony runner, not an in-process loop. The runner streams stdout from the child process and forwards text output to Discord. Isolation between ants comes naturally from process boundaries; OS-level isolation (if needed) uses Docker.

### Engine Architecture

Engines are plugins registered in a central registry (`packages/core/src/engines/registry.ts`). Each engine is a function with the signature:

```typescript
type EngineRunner = (prompt: string, opts: EngineRunOptions) => Promise<void>;
```

Built-in engines:

| Engine name | Binary spawned | Output format | Notes |
|---|---|---|---|
| `claude-cli` | `claude` | NDJSON (`--output-format stream-json`) | Default; parses assistant/result/rate_limit_event messages |
| `gemini-cli` | `gemini` | Plain text lines | Uses `--yolo` flag to skip confirmations |
| `codex` | `codex` | Plain text lines | Generic CLI runner |
| `opencode` | `opencode` | Plain text lines | Generic CLI runner |
| `cli` | Configurable via `cli.binary` | Plain text lines | Custom binary; args from `cli.args` |

The `claude-cli` engine is the only one with structured error classification (maps NDJSON error codes to `AntSessionError` categories). All other engines treat a non-zero exit code as a transient error.

### Ant Lifecycle

1. Colony runner reads and validates `colony.yaml` and all `ants/*.yaml` configs with Zod at startup; aborts on invalid config
2. For each ant: runner enters a supervisor loop and waits for a work item from the queue
3. When a work item arrives, the runner calls the ant's configured engine, which:
   - Spawns the CLI binary as a child process with the prompt as an argument
   - Streams stdout line by line; forwards text output to Discord
   - Awaits process exit; maps exit code / NDJSON error messages to `AntSessionError`
4. Colony runner catches any thrown `AntSessionError`, classifies the failure, and responds appropriately (see Error Classification below)

### Human → Ant Communication (Detail)

Every ant listens to its Discord channel at all times — regardless of `triggers` config. Messages from non-bot users are classified by the colony runner before being forwarded:

```
Human writes in the ant's Discord channel
            ↓
Colony runner classifies the message:
  Slash command (starts with "/") → handled by runner; never forwarded to ant
  "pause" / "stop"    → set paused=true; ack with ⏸️; ant finishes current session then suspends
  "resume" / "start"  → set paused=false; ack with ▶️; ant dequeues next work item
  anything else       → push to ant's work queue as a prompt; if paused, auto-resume
```

The `discord_command` trigger in the ant's YAML config controls whether the ant runs **autonomously** (event-only when configured), not whether it can receive messages. All ants always accept Discord commands from humans.

**Available slash commands** (handled by the runner, not the LLM):
- `/help` — list available commands
- `/status` — current state (running / paused) and queue depth
- `/stats` — uptime and session statistics
- `/pause` (or `/stop`) — pause after the current session
- `/resume` (or `/start`) — resume a paused ant
- `/clear` — discard all queued work items

Ant → Human communication (outbound) covers:
- Session lifecycle: `🐜 starting`, `✅ completed`
- Crash / error notifications (see Error Classification below)
- Pause/resume acks: `⏸️ will pause`, `▶️ resuming`
- The ant's own text output as it narrates its work

> **Note on pre-action confirmation:** CLI-based engines do not support intercepting individual tool calls before they execute. Colony's human-in-the-loop model is **session-level**: humans control ants by sending Discord commands (pause, resume, work instructions), not by approving individual actions mid-session.

### Error Classification and Supervisor Behavior

The supervisor (`runner.ts`) uses typed errors from `errors.ts` rather than treating all failures identically. The `claude-cli` engine maps NDJSON messages to one of these categories:

| Category | NDJSON source | Discord message | Restart behavior |
|---|---|---|---|
| `max_turns` | `result.subtype: error_max_turns` | *(none — silent)* | Immediate restart, no penalty |
| `rate_limit` | `assistant.error: rate_limit` or `rate_limit_event` with `status: rejected` | ⏳ rate limited, countdown | Waits `resetsAt` timestamp if provided, otherwise exponential backoff |
| `transient` | `server_error`, `unknown`, `max_output_tokens`, `error_during_execution` | ❌ crashed, countdown | Exponential backoff (10s → 20s → 40s… cap 5 min) |
| `permanent` | `invalid_request`, `error_max_structured_output_retries` | 🚫 permanent error, countdown | Exponential backoff |
| `billing` | `billing_error` | 💳 billing error — check Anthropic account | **Pauses indefinitely** — waits for human `/resume` |
| `auth` | `authentication_failed` | 🔐 auth failed — check credentials | **Pauses indefinitely** — waits for human `/resume` |
| `budget` | `error_max_budget_usd` | 💰 USD budget cap exceeded | **Pauses indefinitely** — waits for human `/resume` |

For all other engines (`gemini-cli`, `codex`, etc.): a non-zero exit code maps to `transient`; zero exit is success. No structured error classification is available.

**Blocking errors** (`billing`, `auth`, `budget`) require human intervention — refill credits, rotate a key, raise the budget cap — before the ant can continue. The supervisor sets `paused = true` and calls `waitForResume()`, which blocks on a Promise until the human sends `resume` or `/resume` in the ant's Discord channel. No polling, no retry loop.

**Exponential backoff** starts at 10 s and doubles with each consecutive crash (10 s → 20 s → 40 s → 80 s … cap 5 min). The counter resets to 0 on any successful session.

**`max_turns`** is an expected, normal termination. The supervisor treats it identically to a successful session for backoff purposes: no Discord message, no delay, immediate restart.

Implementation: `packages/core/src/errors.ts` contains `AntSessionError`, `classifyAssistantError`, and `classifyResultError`. `packages/core/src/engines/claude-cli.ts` throws typed errors from `handleMessage`. `runner.ts` catches and dispatches them in the supervisor loop.

## Config Schema

### `colony.yaml`

```yaml
name: string                  # colony identifier
integrations:
  discord:
    token: string             # env var reference, e.g. ${DISCORD_TOKEN}
    guild: string             # Discord server name or ID
  github:
    token: string             # env var reference, e.g. ${GITHUB_TOKEN}
defaults:
  poll_interval: string         # duration string, e.g. "5m"; sleep between runs for trigger-less ants
  git:
    user_name: string           # optional; project owner's git name, injected into all ant prompts
    user_email: string          # optional; project owner's git email
```

### `ants/<name>.yaml`

```yaml
name: string                  # ant identifier; used in Discord messages and logs
description: string           # human-readable purpose

instructions: |               # injected as the agent's system prompt
  ...

engine: claude-cli            # "claude-cli" (default) | "codex" | "gemini-cli" | "opencode" | "cli"
                              # Deprecated aliases: "claude" → "claude-cli", "gemini" → "gemini-cli"

cli:                          # only used when engine: "cli"
  binary: string              # path or name of the CLI binary
  args: [string]              # extra args prepended before the prompt

state:
  backend: memory             # "memory" (default) | "sqlite"
  path: ./colony-state.db     # only used when backend: "sqlite"

poll_interval: string         # overrides colony-level defaults.poll_interval for this ant

logging:
  lm_output: discord          # "discord" (default) | "console" | "both"

integrations:
  github:
    repos: [string]           # repos this ant may access
  discord:
    channel: string           # channel name for this ant's updates

schedule:
  cron: string                # standard cron expression; omit for event-only ants

triggers:                     # events that wake a dormant ant
  - type: github_issue
    labels: [string]
  - type: discord_command     # make ant event-only: only run when human messages it
                              # (all ants accept human commands regardless of this)

backlog:                      # automatic work discovery (planned)
  source: github_issues
  filter:
    labels: [string]
    assignee: string
```

## Integration Interface

Each integration implements this TypeScript interface:

```typescript
interface Integration {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on<T>(event: string, handler: (payload: T) => void): void;
  send(channelId: string, message: string): Promise<SentMessage>;
}

interface MessagingIntegration extends Integration {
  addReaction(messageId: string, emoji: string): Promise<void>;
  waitForReaction(
    messageId: string,
    options: { timeout: number; allowedEmojis: string[]; channelId?: string }
  ): Promise<string | null>; // returns emoji or null on timeout
}
```

Integrations are isolated Bun workspace packages so their dependencies don't bleed into other packages.

## Directory Structure

```
colony/
  package.json              # root workspace config (Bun workspaces)
  bunfig.toml               # Bun config
  tsconfig.json             # base TS config (strict); packages extend this
  packages/
    core/                   # colony runner, ant supervisor, config loading, state
      package.json
      src/
        runner.ts           # colony runner entry point + supervisor loop
        ant.ts              # thin shim: resolves engine and delegates
        config.ts           # Zod schemas + YAML config loading
        hooks.ts            # ConfirmationChannel interface (used by Discord integration)
        errors.ts           # AntSessionError + classify functions (error categories → supervisor behavior)
        state.ts            # AntState interface; MemoryState + SQLiteState implementations
        log.ts              # timestamped console logger
        engines/
          registry.ts       # registerEngine / getEngine plugin system
          types.ts          # EngineRunner type + EngineRunOptions interface
          index.ts          # side-effect imports to register all built-in engines
          claude-cli.ts     # claude CLI engine (NDJSON parsing, structured error classification)
          generic-cli.ts    # generic CLI runner (codex, gemini-cli, opencode, custom cli)
    cli/                    # `colony` CLI
      package.json
      src/
        index.ts            # commander entry point
        commands/           # one file per CLI command
    integrations/
      discord/              # discord.js wrapper
        package.json
        src/
          index.ts
      github/               # @octokit/rest wrapper
        package.json
        src/
          index.ts
      slack/                # planned
  config/
    examples/               # example colony.yaml and ants/*.yaml
  docker/                   # Dockerfile and docker-compose templates
  docs/                     # extended documentation
```

## Conventions

- **TypeScript strict mode** everywhere: `"strict": true` in tsconfig; no `any`
- **No build step**: Bun runs `.ts` files directly; no `tsc` compilation for runtime
- **Bun workspaces**: packages import each other via workspace protocol (`"@colony/core": "workspace:*"`)
- **Zod for all external input**: config files, Discord messages, GitHub webhook payloads — validate at the boundary
- **Fail fast**: invalid config at startup aborts with a clear error; never silently ignore bad config
- **Resilient runner**: an ant session crashing must not crash the colony runner; wrap in try/catch + supervisor
- **Async everywhere**: all I/O is `async/await`; no blocking calls
- **Secrets in env only**: tokens and credentials live in `.env` / environment variables; never in YAML files; never logged
- **PLAN.md convention**: every ant maintains a `PLAN.md` at the root of its working directory to track current goals, active tasks, and completed work; committed after each update
- **Git identity**: ants always commit as the project owner (from `defaults.git` in `colony.yaml`); never as a bot user such as `claude` or `github-actions[bot]`
- **Integration isolation**: each integration is its own workspace package; `discord/` does not import from `github/`
- **Tests**: `bun test`; test files live alongside source as `*.test.ts`

## Open Decisions

- **One container per ant vs. one container per colony**: single container is simpler to deploy; per-ant containers give stronger isolation but multiply resource overhead
- **Ant state persistence**: does an ant remember context (past messages, completed tasks) across restarts? SQLite backend exists; cross-session context injection not yet implemented
- **Ant sleep/wake**: how does a scheduled ant "sleep" between runs — exit and restart, or stay alive and use `setTimeout`?

## Release Checklist

Run this checklist before every version bump and tag.

### Code quality
- [ ] `bun test` — 0 failures
- [ ] No `any` in new code (`tsc --noEmit` clean)
- [ ] No non-null assertions (`!`) on environment variables — use explicit guards with clear error messages
- [ ] New public-facing behaviour covered by at least one test

### Versioning
- [ ] Bump `version` in `package.json` (root), `packages/cli/package.json`, `packages/core/package.json` to the new version
- [ ] Add a `## [x.y.z] — YYYY-MM-DD` entry to `CHANGELOG.md` with **Added / Changed / Fixed / Docs** sections
- [ ] Update the version example in `docs/cli.md` (`COLONY_VERSION=vX.Y.Z`)

### Docs review
- [ ] `docs/index.md` — feature cards match current engine/capability set (no stale CLI references)
- [ ] `docs/getting-started.md` — prerequisites, install URL, and `.env` example all accurate
- [ ] `docs/configuration.md` — engine table and env var requirements up to date
- [ ] `docs/cli.md` — install URLs use the correct GitHub username (`divin1/colony`), env var descriptions accurate
- [ ] `docs/supervisor.md` — error categories and recovery steps cover all engines
- [ ] `docs/docker.md` — `.env` example includes all required keys
- [ ] Search for removed features across all docs: `grep -r "<removed-term>" docs/`

### PLAN.md
- [ ] Update `_Last updated_` date
- [ ] Mark completed backlog items as done (strike-through or move to completed section)
- [ ] Update test count in "Test coverage" section

### Pre-tag sanity
- [ ] `colony validate config/examples/` passes
- [ ] No `divin1/colony` or other stale org/repo references in docs
- [ ] No hardcoded old version numbers outside of CHANGELOG historical entries
