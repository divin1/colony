# Colony — Project Plan

_Last updated: 2026-05-15_ (0.4.0)

---

## Current State

The v0.4.0 architecture rework is complete. Colony has migrated from in-process SDK engines to a CLI-spawn plugin registry, aligning with Multica's daemon pattern. The remaining roadmap focuses on making Discord optional, adding a local web dashboard as the primary control plane, and deepening GitHub Issues integration.

### What is fully implemented

| Area | Status | Notes |
|---|---|---|
| Colony runner | ✅ | Ant lifecycle, supervisor loop, typed error classification, backoff |
| Engine registry | ✅ | Plugin system — registerEngine / getEngine |
| `claude-cli` engine | ✅ | Spawns `claude` binary, NDJSON parsing, structured error classification |
| `gemini-cli` engine | ✅ | Spawns `gemini --yolo` (CLI subprocess, no tool interception) |
| `codex` / `opencode` / `cli` engines | ✅ | Generic CLI runner, streams stdout to Discord |
| Discord integration | ✅ | send, addReaction, waitForReaction, resolveChannelId |
| Human → Ant commands | ✅ | Slash commands (/help, /status, /stats, /pause, /resume, /clear) |
| GitHub integration | ✅ | listIssues (with label filter), createIssueComment |
| Config validation | ✅ | Zod schemas, env interpolation, fail-fast on missing vars |
| State persistence | ✅ | memory and SQLite backends; issue deduplication |
| PLAN.md convention | ✅ | Injected into every ant's system prompt |
| Git identity | ✅ | Injected into every ant's system prompt from colony.yaml defaults |
| CLI: init / validate / run / update | ✅ | Full CLI surface, including self-update |
| Docker deployment | ✅ | Dockerfile + docker-compose; no SDK deps required |
| CLI binary distribution | ✅ | `bun build --compile`, GitHub Actions release workflow, install.sh |
| Documentation | ✅ | getting-started, configuration, cli, docker, supervisor |

### What was removed in v0.4.0

| Removed | Reason |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | Replaced by `claude` CLI subprocess |
| `@google/genai` | Replaced by `gemini` CLI subprocess |
| `autonomy` config field | CLI engines cannot intercept tool calls mid-session |
| `confirmation` config field | Same reason |
| `confirmation_timeout` colony config | No confirmation flow to time out |
| Pre-action Discord ✅/❌ confirmation | Removed with autonomy |
| PostToolUse logging | Removed with SDK hooks |
| `notify_discord` Gemini tool | Gemini is now CLI-only, no custom tools |

### Test coverage

- **Core:** runner helpers, config, errors, state, claude-cli engine, hooks (structural)
- **CLI:** `init`, `validate`, `run` commands
- **Integrations:** Discord and GitHub fully tested
- 144 tests pass (`bun test`)

---

## Roadmap

### Phase 0 — Bug fixes ✅ (complete)

- [x] Fix `init.ts` scaffold: remove `confirmation_timeout` from generated `colony.yaml`
- [x] Wrap engine spawns in try-catch; classify binary-not-found as `permanent` AntSessionError
- [x] Pre-flight binary check in `runColony()` — fail fast before supervisor loops start
- [x] Update PLAN.md to v0.4.0

### Phase 1 — Make Discord optional

Discord is currently required to start the colony runner. The goal is to decouple it so the runner works without Discord (outputting to console), with Discord becoming an opt-in notification webhook.

- [ ] Make `discord` optional in `runColony()` — output to console when absent
- [ ] Add `discord_webhook` config to `colony.yaml` (webhook URL, no bot setup required)
- [ ] Remove `addReaction` / `waitForReaction` from `ConfirmationChannel` interface (unused)
- [ ] Update `commands/run.ts` to not require Discord config

### Phase 2 — Local web dashboard (primary control plane)

Replaces Discord as the main human interface. Embedded HTTP server, opt-in via `monitoring.port`.

- [ ] `Bun.serve()` HTTP server embedded in runner
- [ ] REST API: GET /api/status, POST /api/ants/:name/{pause,resume,prompt,clear}
- [ ] Server-Sent Events stream of live session output per ant
- [ ] Minimal single-page HTML dashboard (ant cards, live output, control buttons)
- [ ] `ColonyState` object tracking per-ant status for the HTTP layer

### Phase 3 — GitHub Issues bidirectional

Agents consume GitHub Issues (already done via trigger) and comment back on them.

- [ ] Inject issue context into session prompt when triggered by `github_issue`
- [ ] Post summary comment on the triggering issue after a successful session
- [ ] Add `issueContext` to `EngineRunOptions`

### Phase 4 — SKILL.md support

Adopt Anthropic Agent Skills standard. Composable instruction files injected at dispatch time.

- [ ] `skills: [path/to/skill.md]` field in ant config
- [ ] `packages/core/src/skill.ts` — load and strip YAML frontmatter
- [ ] Inject skill content into `commonInstructions` at session start
- [ ] Example skill files in `config/examples/skills/`

### Phase 5 — Agent memory

SQLite-backed cross-session context. Ants remember what they did last time.

- [ ] `getLastSessionSummary` / `setSessionSummary` on `AntState` interface
- [ ] `session_summaries` table in SQLiteState
- [ ] Capture last assistant text block from engine output
- [ ] Prepend previous summary to session prompt

### Phase 6 — MCP server

Expose colony control as MCP tools for Claude Desktop and other MCP hosts.

- [ ] `packages/integrations/mcp/` workspace package
- [ ] Tools: colony_status, colony_prompt, colony_pause, colony_resume

---

## Open Decisions

### Discord long-term

Discord remains available as an optional integration but is no longer the primary control plane. The web dashboard (Phase 2) is the target control plane. Long-term, Discord may be replaced by a simple webhook notifier (Phase 1 introduces this). No decision yet on whether to deprecate the full Discord integration.

### Interrupting a running session

Human commands (pause, work instructions) currently only take effect after the current session finishes. Interrupting mid-session requires an AbortSignal passed to the engine runner. Not yet planned.

### GitHub webhooks vs. polling

Issues are polled every 5 minutes. Real-time response requires exposing an HTTP webhook endpoint. Phase 2's HTTP server makes this feasible — add it then.

---

## Key invariants to preserve

- `runAntWithSupervision` never resolves — it loops forever; `runColony` relies on this
- Ant crashes must never propagate to other ants — always catch in the supervisor loop
- Discord token / GitHub token must never be logged or appear in error messages
- Engine binary must exist at startup — checked in `runColony()` pre-flight
