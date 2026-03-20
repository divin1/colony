# Colony — Project Plan

_Last updated: 2026-03-20_

---

## Current State

The core framework is **production-ready**. All primary roadmap items are complete and tested. Remaining work is feature expansion (additional integrations, backlog management, polish).

### What is fully implemented

| Area | Status | Notes |
|---|---|---|
| Colony runner | ✅ | Ant lifecycle, supervisor loop, restart on crash, cron, GitHub polling |
| Ant session (Claude) | ✅ | Full Agent SDK `query()` integration, hooks wired |
| Ant session (Gemini) | ✅ | In-process `@google/genai` SDK loop, full hook interception (same as Claude) |
| Confirmation flow | ✅ | PreToolUse hooks, Discord ✅/❌ reactions, timeout → deny |
| PostToolUse logging | ✅ | Configurable: `"off"`, `"impactful"` (default), `"all"` |
| Discord integration | ✅ | send, addReaction, waitForReaction, resolveChannelId |
| Human → Ant commands | ✅ | pause/stop, resume/start, work instructions; all ants always listen |
| GitHub integration | ✅ | listIssues (with label filter), createIssueComment |
| Config validation | ✅ | Zod schemas, env interpolation, fail-fast on missing vars |
| State persistence | ✅ | memory and SQLite backends; issue deduplication |
| PLAN.md convention | ✅ | Injected into every ant's system prompt |
| Git identity | ✅ | Injected into every ant's system prompt from colony.yaml defaults |
| CLI: init | ✅ | Scaffolds colony directory with example configs |
| CLI: validate | ✅ | Validates all YAML and environment variable resolution |
| CLI: run | ✅ | Wires integrations and starts the colony runner |
| Docker deployment | ✅ | Dockerfile + docker-compose, volume mounting, env file |
| CLI binary distribution | ✅ | `bun build --compile`, GitHub Actions release workflow, install.sh |
| Documentation | ✅ | getting-started, configuration, cli, docker |

### Test coverage

- **Core:** Full coverage — runner, ant, hooks, config, state, gemini, errors
- **CLI:** `init`, `validate`, and `run` all have integration tests
- **Integrations:** Discord and GitHub fully tested
- All 198 tests pass (`bun test`)

---

## Open Decisions

These are unresolved architectural questions that need a decision before implementing certain features:

### ~~1. Container isolation strategy~~ — resolved
**Decision:** Keep one container per colony. See [DECISIONS.md](./DECISIONS.md#decision-1-container-isolation-strategy).

### ~~2. Ant session memory / state persistence~~ — resolved
**Decision:** Add `MEMORY.md` convention (preference memory per ant, engine-agnostic). Keep `persistSession: false`; session resume stays a future backlog item. See [DECISIONS.md](./DECISIONS.md#decision-2-ant-session-memory-and-preference-persistence).

### ~~3. PostToolUse logging verbosity~~ — resolved
**Decision:** Add `logging.tool_calls: "off" | "impactful" | "all"` to ant config, default `"impactful"`. See [DECISIONS.md](./DECISIONS.md#decision-3-posttooluse-logging-verbosity).

---

## Backlog

Ordered by priority / impact.

### High priority

#### ~~PostToolUse logging — make opt-in~~ — done
`logging.tool_calls: "off" | "impactful" | "all"` implemented (default `"impactful"`). Read-only tools (`Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoRead`) are skipped by default; `"all"` restores previous verbose behaviour; `"off"` disables the hook entirely.

#### ~~CLI: tests for `validate` and `run` commands~~ — done
Integration tests added for both commands. Spawn uses `process.execPath` to find `bun` reliably in any environment.

#### `persistSession: true` investigation
- **Problem:** The Agent SDK call uses `persistSession: false`, meaning each ant session has no memory of prior sessions.
- **Proposal:** Evaluate `persistSession: true` with a named session ID derived from the ant name, allowing context carryover between runs.
- **Risk:** Persistent sessions accumulate tokens and may hit limits; need a truncation strategy.
- **Files:** `packages/core/src/ant.ts`

---

### Medium priority

#### GitHub webhooks (replace polling)
- **Problem:** GitHub issues are polled every 5 minutes (`GITHUB_POLL_INTERVAL_MS = 5 * 60 * 1000`). New issues have a 5-minute response lag.
- **Proposal:** Add webhook receiver (HTTP server) that receives GitHub push events; replace polling for ants with `triggers[].type: github_issue`.
- **Considerations:** Requires exposing an HTTP endpoint; needs a secret for webhook validation; URL needs to be reachable from GitHub.
- **Files:** New `packages/integrations/github/src/webhooks.ts`; update `runner.ts`

#### Backlog management
- **Problem:** No unified "backlog" abstraction. Ants discover work ad-hoc via cron, issue triggers, or Discord messages.
- **Proposal:** Implement the `backlog` config block (already in the CLAUDE.md schema) that auto-discovers and queues work items from GitHub Issues. The ant processes one item per session.
- **Config schema already defined:**
  ```yaml
  backlog:
    source: github_issues
    filter:
      labels: [ant-ready]
      assignee: string
  ```
- **Files:** New `packages/core/src/backlog.ts`; update `runner.ts`; update `config.ts` schema

#### Interrupting a running session
- **Problem:** Human commands (pause, work instructions) only take effect after the current session completes. There is no way to interrupt a session mid-execution.
- **Proposal:** The Agent SDK `query()` returns an async iterator; passing an `AbortSignal` would allow interruption. Add `AbortController` to `runAnt()`; expose abort via the control command handler.
- **Files:** `packages/core/src/ant.ts`, `packages/core/src/runner.ts`

---

### Low priority / future

#### Slack integration
- Discord works well; Slack is useful for teams already using it.
- Implement `packages/integrations/slack/` with the same `MessagingIntegration` interface.
- The `runner.ts` already uses the interface structurally — swapping Discord for Slack requires only wiring changes in `commands/run.ts`.

#### Multi-colony management CLI
- `colony status` — show running ants and their states (requires a running process or status file)
- `colony restart <ant>` — gracefully restart a specific ant without stopping the colony
- `colony logs <ant>` — tail Discord or stdout logs for a specific ant

#### Colony-level event bus
- Allow ants to communicate with each other via internal events, not just through Discord.
- Useful for "coordinator ant" patterns where one ant dispatches work to specialists.

---

## Implementation Notes

### Adding a new integration (checklist)

1. Create `packages/integrations/<name>/` with its own `package.json` and `src/index.ts`
2. Implement the `MessagingIntegration` interface (if messaging) or a custom interface
3. Add the integration to `colony.yaml` schema in `config.ts`
4. Wire it up in `packages/cli/src/commands/run.ts`
5. Document in `docs/configuration.md`
6. Add example to `config/examples/`

### Adding a new trigger type (checklist)

1. Add the new type to `TriggerSchema` in `config.ts`
2. Add detection logic in `runner.ts` (`runAntWithSupervision`)
3. Wire up the listener / poller
4. Update `hasAnyTrigger` if the trigger prevents autonomous looping
5. Document in `docs/configuration.md` and `docs/getting-started.md`

### Key invariants to preserve

- `runAntWithSupervision` never resolves — it loops forever or throws; `runColony` relies on this
- Ant crashes must not propagate to other ants — always catch in the supervisor loop
- Discord token / GitHub token must never be logged or appear in error messages
- `persistSession: false` is intentional until a memory strategy is decided
- Every ant MUST have `integrations.discord.channel` — the runner validates this at startup
