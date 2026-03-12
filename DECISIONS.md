# Colony — Architecture Decisions

This file records architectural decisions, the analysis behind them, and the rationale for the chosen option. Add new entries as decisions are made.

---

## Decision 3: PostToolUse logging verbosity

**Date:** 2026-03-12
**Status:** Decided — three-tier config, default `"impactful"`

### Current state

`createLoggingHook` fires on every tool call and posts a Discord message for each. A typical active coding session produces a Discord channel that looks like:

```
🔧 `Read` completed
🔧 `Glob` completed
🔧 `Grep` completed
🔧 `Read` completed
🔧 `Write` completed
🔧 `bun test` completed
🔧 `git commit -m "..."` completed
```

The first four messages are internal workings — the ant looking around the codebase. The last three are things the operator wants to see. They are visually identical. Signal-to-noise ratio is poor.

### The right frame

An operator monitoring an ant wants to see **what the ant did**, not **what the ant looked at**. This maps to two tool categories:

**Read-only / exploratory — should not log by default:**
`Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoRead`

**Impactful / mutating — should log by default:**
`Write`, `Edit`, `MultiEdit`, `Bash`, `NotebookEdit`, and any unknown/MCP tool (unknown tools default to visible — safer to over-report than under-report for tools with unknown side effects).

### The Gemini engine constraint

The PostToolUse hook is a Claude Agent SDK feature. It does not exist for Gemini ants, which run as subprocesses. Colony has no visibility into Gemini's individual tool calls. For Gemini ants, the only tool-level visibility an operator gets is what the model narrates in its text output. This config option has no effect on Gemini ants.

### Options considered

**Option A — Binary opt-in: `logging.tool_calls: true/false`, default `false` (PLAN.md proposal)**

All or nothing. Default: no logging.

Pros: simple, eliminates noise immediately.
Cons: operators who don't configure it lose all tool visibility; writes, commits, and shell commands disappear too; too aggressive.

**Option B — Smart default with no config: hard-code a `READ_ONLY_TOOLS` skip-list**

Skip posting for known read-only tools; post for everything else. No config option.

Pros: fixes noise immediately with zero config; no API surface change.
Cons: not configurable; operators can't enable verbose mode for debugging; the skip-list must be maintained as the SDK adds tools.

**Option C — Three-tier config: `logging.tool_calls: "off" | "impactful" | "all"`, default `"impactful"` (chosen)**

- `"off"` — no PostToolUse logging
- `"impactful"` (default) — log everything except known read-only tools
- `"all"` — original behavior, log every tool call

### Decision

**Option C.** Add `logging.tool_calls: "off" | "impactful" | "all"` to the ant config schema, defaulting to `"impactful"`.

Implementation:
- `"impactful"` skips: `Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoRead`; logs everything else
- `"off"` does not register the PostToolUse hook at all
- `"all"` preserves current behavior (every tool call logged)
- Unknown/MCP tools are always logged under `"impactful"` — unknown side effects default to visible
- No effect on Gemini ants (no hook interception available)

Rationale:
- The default must be good without any configuration — most operators will never set this field
- `"impactful"` default gives meaningful signal (writes, bash, commits) without flooding the channel with read operations
- `"all"` mode is genuinely useful for debugging a misbehaving ant
- `"off"` gives operators who want a clean channel full control
- Consistent with the confirmation flow mental model: PostToolUse logging should highlight the same class of events that PreToolUse confirmation guards

---

## Decision 2: Ant session memory and preference persistence

**Date:** 2026-03-12
**Status:** Decided — MEMORY.md convention, engine-native files as operator bonus

### The actual question

The goal is for each ant to develop a **memory of preferences** over time — things like "prefer smaller commits", "this repo uses tabs", "always open a PR rather than pushing directly" — so that each agent becomes increasingly customized to the operator's working style. This is distinct from session persistence (replaying tool call history across restarts).

There are two different problems often conflated under "memory":

| | Session persistence | Preference memory |
|---|---|---|
| **What it is** | Verbatim replay of tool calls + results from prior sessions | Compact, curated learnings about working style |
| **Example** | "You previously read auth.ts and it contained X" | "This repo uses tabs. Always run tests before committing." |
| **Token cost** | High, grows unboundedly | Low and stable by design |
| **Who controls it** | The engine (automatic) | The ant (curated) |
| **Value for the stated use case** | Low | High |

Session persistence solves "don't re-do work already done this session." Preference memory solves "get better at this project and operator's style over time." These are separate problems with different solutions.

### How each engine handles memory natively

**Claude Agent SDK:** The `claude_code` SDK preset automatically reads `CLAUDE.md` hierarchically — from the working directory upward to the filesystem root. Any `CLAUDE.md` present in the ant's CWD is injected into the system prompt without the ant needing to be instructed to read it.

**Gemini CLI:** `GEMINI.md` is the exact equivalent. Gemini CLI searches hierarchically from `~/.gemini/GEMINI.md` (global) through the project tree to the working directory. All found files are concatenated and injected into every prompt automatically. There is also a `save_memory` tool and `/memory add <text>` command that appends to `~/.gemini/GEMINI.md`.

**The engine-agnostic constraint:** Colony must support both engines interchangeably — operators configure `engine: claude` or `engine: gemini` per ant. Any memory mechanism must work identically regardless of engine. Relying purely on engine-native auto-loading means two different filenames (`CLAUDE.md` vs `GEMINI.md`), two different paths, and divergent conventions — unacceptable for a unified framework.

### On `persistSession` and session resume

For completeness, the session persistence mechanics per engine:

| Capability | Claude | Gemini |
|---|---|---|
| Sessions saved | Opt-in: `persistSession: true` in `query()` | Always automatic (no flag needed) |
| Resume | Pass `resume: sessionId` to `query()` | Pass `--resume` flag to CLI subprocess |
| Session ID source | `message.session_id` on result message | Hash of working directory (`~/.gemini/tmp/<hash>/`) |
| Automatic truncation | No | No |

The core risk with using session persistence for cross-session continuity is unbounded token accumulation. For a long-running ant processing one work item per session:

| Session | New tokens | Replayed history | Total context |
|---|---|---|---|
| 1 | ~5k | 0 | ~5k |
| 20 | ~5k | ~95k | ~100k |
| 40 | ~5k | ~195k | ~200k ← context limit |
| 41 | overflow | | |

Neither engine truncates or summarizes automatically. A rollover strategy would be required before cross-session persistence is safe to ship. This is a future backlog item, not part of this decision.

### Options considered

**Option A — Engine-native files only (CLAUDE.md / GEMINI.md)**

Each ant uses whichever file its engine auto-loads. Claude ants write to `CLAUDE.md`; Gemini ants write to `GEMINI.md`.

Pros: auto-loaded by the engine without explicit instructions.
Cons: two different files for the same purpose; Colony operators need to know which applies to which ant; the runner must inject different conventions per engine; no unified view across ants.

**Option B — Single `MEMORY.md` by Colony convention**

Colony injects a `MEMORY.md` convention into every ant's system prompt (alongside the existing PLAN.md convention). The ant reads it at session start and updates it when it learns a new preference or makes a lasting decision.

Pros: engine-agnostic; uniform across all ants; human-readable and editable by the operator; version-controlled via git; zero token accumulation.
Cons: not auto-loaded by the engine — relies on the ant following instructions. In practice, since Colony controls the system prompt, this is not a real limitation.

**Option C — `MEMORY.md` convention + engine-native files as operator bonus (chosen)**

Colony injects `MEMORY.md` as the unified convention. Additionally, operators can place seed preferences in `CLAUDE.md` (for Claude ants) or `GEMINI.md` (for Gemini ants), which are auto-loaded by each engine without requiring the ant to follow instructions. This is useful for bootstrapping a new ant's preferences before it has accumulated its own.

### Decision

**Option C.** Add a `MEMORY.md` convention block to `buildCommonInstructions()` in `runner.ts`, parallel to the existing PLAN.md block. The convention instructs every ant to:

- Read `MEMORY.md` at session start if it exists
- Update it when a new preference or lasting decision is made (e.g. "this repo uses tabs", "always PR rather than pushing directly")
- Commit the file when updated

The ant config documentation notes that operators can additionally seed `CLAUDE.md` (Claude ants) or `GEMINI.md` (Gemini ants) with baseline preferences that are auto-loaded by the engine regardless of the ant following instructions — useful for initial setup.

Rationale:
- Directly solves the stated use case: agents that improve over time per operator's style
- Works identically for both Claude and Gemini ants
- Operators can read, edit, and seed MEMORY.md directly — no black box
- Zero token accumulation risk, unlike session persistence
- Survives container rebuilds, restarts, and engine switches

### Future backlog: optional `persistSession` config

A future `session.persist: true` ant config option remains possible. Design constraints when implemented:
- For Claude: set `persistSession: true`, capture `session_id` from the result message, store it per ant in SQLite, pass as `resume:` on the next call
- For Gemini: add `--resume` to the subprocess CLI invocation (`--resume` without an ID resumes the latest session for that working directory)
- A rollover strategy is required (start a fresh session when history exceeds a configurable threshold, e.g. 100k tokens)
- Must be opt-in; the default remains stateless sessions

---

## Decision 1: Container isolation strategy

**Date:** 2026-03-12
**Status:** Decided — keep per-colony

### Question

One container runs all ants (current) vs. each ant gets its own container.

### What the colony runner already gives you (without per-ant containers)

The supervisor loop in `runAntWithSupervision` catches every ant crash and restarts it independently. A crashing ant never crashes the colony. This means the main operational argument for per-ant containers — independent restarts — is already solved inside the process. The container is only the last-resort restart (if the Bun process itself hangs or OOM-kills).

The real remaining reasons to want per-ant containers are:

1. **Security / blast radius** — limit what a misbehaving LLM prompt can do
2. **Resource limits** — set different CPU/memory ceilings per ant
3. **Credential scoping** — give each ant only the env vars it needs
4. **Filesystem scoping** — mount only the repos/directories each ant needs

### Tradeoffs

#### Security / blast radius

| | Per-colony | Per-ant |
|---|---|---|
| Filesystem | All ants can read/write the same mounts | Each ant's volume can be scoped to its repos only |
| Env vars | All ants share the same `.env` | Each ant gets its own env file; credentials can be scoped per ant |
| Network | Shared network namespace | Docker network policies can restrict per-ant outbound |
| LLM prompt injection | A rogue instruction affects any file the container can reach | Blast radius limited to the ant's own mounts |

For personal use (you control all the ants and the instructions), this difference is mostly theoretical. For multi-tenant use (multiple users' ants in the same colony, different credentials, different repos), per-ant containers become important.

#### Resource limits

With per-colony: one set of `deploy.resources.limits` for all ants combined. A memory-hungry researcher ant can starve a lightweight triager ant.

With per-ant: you can set `memory: 2g` on the heavy ant and `memory: 512m` on the lightweight one. In practice this matters when ant workloads differ significantly.

#### Deployment complexity

With per-colony: one service definition, done.

```yaml
services:
  colony:   # one service, done
```

With per-ant containers for a 5-ant colony:

```yaml
services:
  ant-alice:
  ant-bob:
  ant-carol:
  ant-dave:
  ant-eve:
```

Each needs its own build reference, volume mount, env file, and restart policy. The compose file becomes proportional to the number of ants and has to be manually maintained as ants are added or removed.

#### Integration connections

The current architecture creates one Discord WebSocket connection and one GitHub client shared across all ants. Per-ant containers means N separate Discord connections. For small N this is fine, but it is worth knowing.

### Prerequisite for per-ant containers

If you want per-ant containers, you need a way to start a colony with only one ant from the config. Right now `colony run .` always starts all ants. You would need either:

- A `--ant <name>` flag: `colony run . --ant alice` starts only the ant named `alice`
- Or each ant has its own minimal `colony.yaml` — but that duplicates shared config (Discord token, GitHub token, defaults) across every ant

The `--ant` flag is the clean path: a small change that unlocks per-ant deployment without forcing a config restructure.

### Options considered

**Option A — Keep per-colony, no changes**
Simplest. Covers the large majority of real use cases. The supervisor loop already handles ant-level restarts. Document that for stronger isolation, per-ant can be achieved with a future `--ant` flag.

**Option B — Add `--ant <name>` flag, document per-ant pattern**
One small CLI change unlocks the per-ant deployment pattern for users who need it. Per-colony remains the default. No architectural change required.

**Option C — Make per-ant the default**
Breaks the current simple "one compose service" experience. Requires the compose template to be generated or regenerated when ants are added. Significantly more operational overhead for the common case.

### Who needs what

| Scenario | Right choice |
|---|---|
| Personal use — one person, own ants, own repos | Per-colony |
| Small team — trusted people, same codebase | Per-colony |
| Different repos with different GitHub tokens | Per-ant (credential scoping) |
| Multi-tenant / untrusted instructions | Per-ant (blast radius containment) |
| Heavy and light ants mixed | Per-ant (independent resource limits) |
| Frequently adding or removing ants | Per-colony (compose file stays simple) |

### Decision

**Keep per-colony (Option A).** Colony's primary use case is personal and small-team deployments where the operator controls all ant instructions and repos. The supervisor loop already provides the main operational benefit of container-level isolation (independent restarts). The deployment simplicity of a single container is a meaningful advantage for this audience.

Per-ant container support is not ruled out for the future. If a `--ant <name>` flag is ever added to the CLI for other reasons (e.g. testing a single ant locally), it would trivially enable per-ant Docker deployment and could be documented at that point.
