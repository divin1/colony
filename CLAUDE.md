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
| Alt engine | Gemini CLI (`gemini`) | Optional; spawned as a subprocess for `engine: gemini` ants |
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
| **Ant** | An autonomous agent session (Claude Agent SDK or Gemini CLI) configured via YAML |
| **Colony** | A set of ants deployed together with shared configuration |
| **Colony runner** | The process that manages ant sessions, restarts them on failure, and bridges integrations |
| **Integration** | A connector to an external service (Discord, GitHub, Jira, etc.) |
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
   - Discover work from backlog source (GitHub Issues, Jira, etc.)
   - Execute work using Claude Code tools (file edits, shell commands, API calls)
   - For dangerous/irreversible actions: apply the ant's `autonomy` policy — ask Discord (`human`), auto-approve (`full`), or auto-deny (`strict`)
   - If `human`: resume after operator reacts ✅ (proceed) or ❌ (skip), or after timeout (treat as ❌)
   - Report results and status to Discord
4. Colony runner wraps each SDK session in a supervisor loop; restarts it on unexpected error

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
```

### `ants/<name>.yaml`

```yaml
name: string                  # ant identifier; used in Discord messages and logs
description: string           # human-readable purpose

instructions: |               # injected as the agent's system prompt
  ...

engine: claude                # "claude" (default) or "gemini"

gemini:                       # only used when engine: gemini
  model: gemini-2.5-pro       # default; any Gemini model name accepted by the CLI

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
  - type: discord_command

backlog:                      # automatic work discovery (planned)
  source: github_issues | jira | linear
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
      jira/                 # planned
      linear/               # planned
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
- **Integration isolation**: each integration is its own workspace package; `discord/` does not import from `github/`
- **Tests**: `bun test`; test files live alongside source as `*.test.ts`

## Open Decisions

- **One container per ant vs. one container per colony**: single container is simpler to deploy; per-ant containers give stronger isolation but multiply resource overhead
- **Ant state persistence**: does an ant remember context (past messages, completed tasks) across restarts, and if so — in-memory, SQLite, or external store?
- **Ant sleep/wake**: how does a scheduled ant "sleep" between runs — exit and restart, or stay alive and use `setTimeout`?
