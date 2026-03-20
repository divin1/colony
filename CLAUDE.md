# CLAUDE.md — Colony

## Project Overview

Colony is a framework for deploying autonomous LLM-based agents. Each "ant" is an **agent session** (Claude Agent SDK or Gemini CLI) managed by a **colony runner** process. The project has three deliverables:

1. **Core framework** — library that handles ant lifecycle, integration bridges, and confirmation flows
2. **CLI** (`colony`) — command-line tool for scaffolding, validating, and managing colonies
3. **Docker runtime** — a container-based deployment that runs a colony 24/7

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | No JS fallback; all packages are TS |
| Runtime | Bun | No build step; runs `.ts` directly |
| Monorepo | Bun workspaces | `package.json` at root with `workspaces` field |
| Agent engine | `@anthropic-ai/claude-agent-sdk` | Default engine; drives each ant's agentic loop |
| Alt engine | `@google/genai` | Google Gen AI SDK; in-process agentic loop for `engine: gemini` ants |
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
| **Ant** | An autonomous agent session (Claude Agent SDK or Google Gen AI SDK) configured via YAML |
| **Colony** | A set of ants deployed together with shared configuration |
| **Colony runner** | The process that manages ant sessions, restarts them on failure, and bridges integrations |
| **Integration** | A connector to an external service (Discord, GitHub, etc.) |
| **Backlog** | A queue of work items discovered automatically (e.g. from GitHub Issues) |

### Component Diagram

```
┌──────────────────────────────────────────────────────┐
│  Colony Runner (Bun process)                         │
│                                                      │
│  ┌────────────────┐  ┌────────────────┐              │
│  │  Ant           │  │  Ant           │              │
│  │  (Agent SDK    │  │  (Agent SDK    │              │
│  │   session)     │  │   session)     │              │
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

Ants run as concurrent Agent SDK sessions within the colony runner process. They are not separate OS processes. Isolation at the OS level (if needed) comes from deploying each ant in its own Docker container.

### Ant Lifecycle

1. Colony runner reads and validates `colony.yaml` and all `ants/*.yaml` configs with Zod at startup; aborts on invalid config
2. For each ant: runner calls the Agent SDK `query()` function with the ant's `instructions` as system context and a set of allowed tools
3. Ant enters its work loop (managed by the SDK):
   - Check schedule / poll triggers / read pending Discord commands
   - Discover work from backlog source (GitHub Issues, etc.)
   - Execute work using Claude Code tools (file edits, shell commands, API calls)
   - For dangerous/irreversible actions: apply the ant's `autonomy` policy — ask Discord (`human`), auto-approve (`full`), or auto-deny (`strict`)
   - If `human`: resume after operator reacts ✅ (proceed) or ❌ (skip), or after timeout (treat as ❌)
   - Report results and status to Discord
   - Respond to human control commands from Discord (pause/stop, resume/start, work instructions)
4. Colony runner wraps each SDK session in a supervisor loop; classifies the failure and responds appropriately (see Error Classification below)

### Confirmation Flow (Detail)

The flow depends on the ant's `autonomy` setting:

**`autonomy: human` (default)**
```
Ant tool use hook fires for a dangerous action
            ↓
Colony runner (via pre-tool-use hook) intercepts
            ↓
Posts message to Discord: "About to [action]. Proceed?"
Adds ✅ and ❌ reactions to the message
            ↓
Ant SDK session suspends (awaiting Promise resolution)
            ↓
Discord client fires messageReactionAdd event
            ↓
Promise resolves: proceed (✅) or block (❌)
Or: timeout elapses → block
            ↓
Ant resumes or skips the action
```

**`autonomy: full`** — PreToolUse hook is not registered; every action proceeds immediately.

**`autonomy: strict`** — Hook fires, detects danger, returns `{ decision: "block" }` immediately without contacting Discord.

- Timeout is configurable per colony (`confirmation_timeout` in `colony.yaml`); applies to `human` autonomy only
- Confirmations are logged with the Discord username of the reactor

### Human → Ant Communication (Detail)

Every ant listens to its Discord channel at all times — regardless of `triggers` config. Messages from non-bot users are classified by the colony runner before being forwarded:

```
Human writes in the ant's Discord channel
            ↓
Colony runner classifies the message:
  "pause" / "stop"    → set paused=true; ack with ⏸️; ant finishes current session then suspends
  "resume" / "start"  → set paused=false; ack with ▶️; ant dequeues next work item
  anything else       → push to ant's work queue as a prompt; if paused, auto-resume
```

The `discord_command` trigger in the ant's YAML config controls whether the ant runs **autonomously** (event-only when configured), not whether it can receive messages. All ants always accept Discord commands from humans.

Ant → Human communication (outbound) covers:
- Session lifecycle: `🐜 starting`, `✅ completed`
- Crash / error notifications (see Error Classification below)
- Pause/resume acks: `⏸️ will pause`, `▶️ resuming`
- Dangerous action confirmations (requires reaction ✅/❌)
- The ant's own text output as it narrates its work

### Error Classification and Supervisor Behavior

The supervisor (`runner.ts`) uses typed errors from `errors.ts` rather than treating all failures identically. The Agent SDK exposes rich error information that is mapped to one of these categories:

| Category | SDK source | Discord message | Restart behavior |
|---|---|---|---|
| `max_turns` | `error_max_turns` result | *(none — silent)* | Immediate restart, no penalty |
| `rate_limit` | `rate_limit` assistant error or `rate_limit_event` with `status: rejected` | ⏳ rate limited, countdown | Waits `resetsAt` timestamp if provided, otherwise exponential backoff |
| `transient` | `server_error`, `unknown`, `max_output_tokens`, `error_during_execution` | ❌ crashed, countdown | Exponential backoff (10s → 20s → 40s… cap 5 min) |
| `permanent` | `invalid_request`, `error_max_structured_output_retries` | 🚫 permanent error, countdown | Exponential backoff |
| `billing` | `billing_error` | 💳 billing error — check Anthropic account | **Pauses indefinitely** — waits for human `/resume` |
| `auth` | `authentication_failed` | 🔐 auth failed — check credentials | **Pauses indefinitely** — waits for human `/resume` |
| `budget` | `error_max_budget_usd` | 💰 USD budget cap exceeded | **Pauses indefinitely** — waits for human `/resume` |

**Blocking errors** (`billing`, `auth`, `budget`) require human intervention — refill credits, rotate a key, raise the budget cap — before the ant can continue. The supervisor sets `paused = true` and calls `waitForResume()`, which blocks on a Promise until the human sends `resume` or `/resume` in the ant's Discord channel. No polling, no retry loop.

**Exponential backoff** starts at 10 s and doubles with each consecutive crash (10 s → 20 s → 40 s → 80 s … cap 5 min). The counter resets to 0 on any successful session.

**`max_turns`** is an expected, normal termination (the SDK hit its turn budget). The supervisor treats it identically to a successful session for backoff purposes: no Discord message, no delay, immediate restart.

Implementation: `packages/core/src/errors.ts` contains `AntSessionError`, `classifyAssistantError`, and `classifyResultError`. `ant.ts` throws typed errors from `handleMessage`. `runner.ts` catches and dispatches them in the supervisor loop.

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
  confirmation_timeout: string  # duration string, e.g. "30m"; timeout action is deny
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

engine: claude                # "claude" (default) | "gemini"

gemini:                       # only used when engine: gemini
  model: gemini-2.5-pro       # default; any Gemini model name
  max_turns: 100              # default; maximum agentic loop iterations

autonomy: human               # "human" (default) | "full" | "strict"
                              # human:  forward dangerous actions to Discord for approval
                              # full:   auto-approve everything, no Discord prompts
                              # strict: auto-deny everything flagged, no Discord prompts

confirmation:                 # which actions are flagged as dangerous (orthogonal to autonomy)
  always_confirm_tools: [string]   # tool names that are always flagged
  dangerous_patterns:  [string]    # extra regex patterns matched against bash commands

integrations:
  github:
    repos: [string]           # repos this ant may access
  discord:
    channel: string           # channel name for this ant's updates and confirmations

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
    options: { timeout: number; allowedEmojis: string[] }
  ): Promise<string | null>; // returns emoji or null on timeout
}
```

Integrations are isolated Bun workspace packages so their dependencies don't bleed into other packages.

## Agent SDK Hooks

The colony runner uses the Agent SDK's hook system to intercept tool use for the confirmation flow:

```typescript
import { query, type ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

const options: ClaudeAgentOptions = {
  systemPrompt: ant.instructions,
  allowedTools: ant.tools,
  hooks: {
    preToolUse: async (tool) => {
      if (isDangerous(tool)) {
        const approved = await discord.requestConfirmation(tool);
        if (!approved) throw new Error(`Action denied by human: ${tool.name}`);
      }
    },
    postToolUse: async (tool, result) => {
      await discord.logToolResult(tool, result);
    },
  },
};

for await (const message of query({ prompt: workItem, options })) {
  await discord.send(ant.channel, message);
}
```

## Directory Structure

```
ants/
  package.json              # root workspace config (Bun workspaces)
  bunfig.toml               # Bun config
  tsconfig.json             # base TS config (strict); packages extend this
  packages/
    core/                   # colony runner, ant supervisor, event bus, config loading
      package.json
      src/
        runner.ts           # colony runner entry point
        ant.ts              # ant session wrapper + supervisor loop
        config.ts           # Zod schemas + YAML config loading
        hooks.ts            # Agent SDK hook factories (confirmation, logging)
        errors.ts           # AntSessionError + classify functions (error categories → supervisor behavior)
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
- **Bun workspaces**: packages import each other via workspace protocol (`"@ants/core": "workspace:*"`)
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
- **Ant state persistence**: does an ant remember context (past messages, completed tasks) across restarts, and if so — in-memory, SQLite, or external store?
- **Ant sleep/wake**: how does a scheduled ant "sleep" between runs — exit and restart, or stay alive and use `setTimeout`?
