# Multica Analysis

**Repository:** https://github.com/multica-ai/multica
**Website:** https://multica.ai
**Tagline:** "The open-source managed agents platform. Turn coding agents into real teammates — assign tasks, track progress, compound skills."
**Scale:** ~22k GitHub stars (as of April 2026), ~42 MB dual-language monorepo

---

## What Multica Is

**Mental model**: project management for human + agent teams. Agents appear on a Kanban board alongside humans, with avatars, bios, and the same assignment dropdowns. It's a coordination and visibility layer — it does not implement its own agent loop, it manages external CLIs (claude, codex, gemini, etc.).

**Architecture**: Go backend + Next.js frontend + PostgreSQL + local daemon. The daemon runs on the developer's machine, auto-detects agent CLIs on PATH, polls the server every 3s for claimed tasks, spawns the CLI in an isolated directory, and streams output back. Agents never run on Multica's servers.

---

## Core Concept and Design Philosophy

Multica's mental model is **project management for human + agent teams**. The core insight is that existing agent frameworks treat agents as tools you invoke; Multica treats them as teammates you assign work to.

The metaphor is deliberately borrowed from tools like Linear: you drag an issue onto an agent column the same way you drag it onto a colleague. Agents have profiles, avatars, bios, and appear in the same assignment dropdowns as human team members. They leave comments, create issues, update statuses, and report blockers proactively — autonomously and without being prompted.

This is a **coordination and visibility** layer sitting above the agent CLIs, not a new agent runtime. Multica does not write its own agent loop; it manages the lifecycle of external agent CLI tools.

---

## Architecture

Multica is a **three-tier + local execution** architecture:

```
[Browser/Electron] → [Go API + WebSocket server] → [PostgreSQL 17 + pgvector]
                                                    ↕  Redis streams (optional, multi-node fanout)
                            [Local Daemon] ←HTTP poll / WS→ [Go backend]
                                 ↓
                    [Spawns agent CLIs: claude, codex, gemini, ...]
```

**Server** (Go binary): Owns all persistent state — workspaces, issues, members, task queue, skills, runtimes. Acts as central orchestrator. Exposes a REST API (Chi router) and two WebSocket subsystems: one for the browser dashboard (live issue/board updates), one for daemon connections (task dispatch and progress streaming).

**Daemon** (Go binary, runs locally): The execution bridge. It runs on the developer's machine, auto-detects installed agent CLIs on PATH, registers each as a **Runtime** with the server, polls the server every 3 seconds for claimed tasks, spawns the CLI in an isolated workspace directory, and streams output back. Agents never run on Multica's servers — they always execute on a registered runtime (local machine or cloud instance).

**Frontend**: Next.js 16 App Router (web), Electron (desktop), Zustand for state, TanStack Query for server state. Shared headless logic lives in a `packages/` directory (pnpm workspaces + Turborepo).

**Database**: PostgreSQL 17 with pgvector. Tasks are stored with JSONB context blobs — Multica assembles a "snapshot" at dispatch time (issue body, skill files, workspace context) and hands the full JSONB payload to the daemon, so the database stays cold during agent inference. The pgvector extension suggests future semantic search for skills and smart task-to-agent routing.

**Key architectural decision:** One source of truth (Postgres), one event bus, two WS subsystems. The daemon does HTTP polling (not persistent WS) for task claiming, which is simpler and more reliable across NAT/firewalls.

---

## Configuration

Multica has **no per-agent YAML config files** — there is no equivalent to Colony's `ants/*.yaml`. Configuration is entirely in-product through the web/desktop UI and the multica CLI.

**Skills** are the closest thing to declarative agent instructions. A Skill is a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---
Your skill instructions here...
```

Multica adopts the **Anthropic Agent Skills open standard** (`SKILL.md` format), meaning skills from Anthropic's official repository, ClawHub, or skills.sh can be imported directly. Skills are synced to the daemon at task execution time.

---

## Agent Lifecycle

Every agent task follows an explicit state machine:

```
queued → claimed → in_progress → in_review → done
                              ↘ blocked
                              ↘ failed
```

1. Human (or Autopilot) creates an issue and assigns it to an agent
2. Server creates a task in the queue with status `queued`
3. Daemon polls (every 3s), detects the task, **claims** the row
4. Daemon reads the JSONB snapshot, assembles skill files on disk, spawns the agent CLI in an isolated workspace directory
5. Agent CLI runs, streaming output back to daemon via stdout
6. Daemon streams progress to server via WebSocket; server broadcasts to dashboard
7. Agent moves task through board states up to `in_review` autonomously
8. **Human must move to `done`** — agents cannot finalize a task themselves (by design)
9. If agent hits a blocker, it reports it; the task enters `blocked` state

The **Runtime** abstraction is central: it represents any compute environment that can run agent CLIs. A local machine registers one runtime per detected CLI per watched workspace.

---

## Integrations

**Built-in:**
- Agent CLIs auto-detected on PATH: claude, codex, copilot, openclaw, opencode, hermes, gemini, pi, cursor-agent, kimi, kiro-cli
- Email (Resend): magic-link authentication
- MCP (community-built `multica-mcp`): 27 tools wrapping the CLI for use from Claude Desktop or other MCP hosts

**Not yet shipped:**
- GitHub deep integration (issue #666)
- Webhook triggers for Autopilots
- Slack/Discord bridge — no external messaging; communication is in-product only

---

## LLM Support

Multica is **explicitly vendor-neutral** at the execution layer. The daemon auto-detects CLI tools on PATH — any CLI that can be invoked is usable. It does **not** call LLM APIs directly; it delegates entirely to the CLI tool.

---

## Error Handling and Resilience

Multica's error handling philosophy is **surface, don't hide**:

- Agents report blockers proactively; the task enters `blocked` state and appears on the board
- No typed error classification (no equivalent to Colony's `AntSessionError` taxonomy)
- No documented exponential backoff in the supervisor
- Failure states (`failed`) are visible on the board
- The human is the recovery mechanism

Rate limiting, billing errors, and auth failures are handled by the underlying agent CLI — Multica does not intercept or classify these.

---

## Human-in-the-Loop

Multica's HITL model is **board-based review**, not pre-action confirmation:

- No equivalent to Colony's pre-tool-use hook / Discord reaction flow
- Agents move tasks to `in_review`; a human must explicitly move to `done`
- In-product chat sessions allow humans to talk to agents directly (SQL-backed, real-time via WebSocket)
- Autopilot fires agent runs on cron without human assignment

---

## CLI

The `multica` CLI is a Go binary:

- `multica setup` / `multica setup self-host`
- `multica daemon start / stop / logs [-f]`
- `multica workspace watch <id>` / `unwatch` / `get`
- `multica issue list / get / create`
- `multica autopilot trigger-add <id> --cron "..." --timezone "..."`
- `multica update` — self-update

Each profile gets its own config directory (`~/.multica/profiles/<name>/`), supporting multiple Multica instances.

---

## Deployment

**Cloud (managed):** https://multica.ai — install CLI, connect daemon. No server to run.

**Self-hosting (Docker):**
```bash
curl -fsSL https://multica.ai/install.sh | sh -- --with-server
multica setup self-host
```
Three containers: Go backend, Next.js frontend, PostgreSQL 17 + pgvector.

**Railway**: One-click deploy template.

Agent execution always runs locally on registered runtimes — never on Multica's servers.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Go (Chi router, gorilla/websocket, sqlc) |
| Frontend | Next.js 16 App Router, Zustand, TanStack Query |
| Desktop | Electron (electron-vite) |
| Database | PostgreSQL 17 + pgvector |
| Cache / fanout | Redis streams (optional) |
| Monorepo | pnpm workspaces + Turborepo |
| CLI + daemon | Go (single binary) |
| Auth | Email magic links via Resend; JWT |
| Skills format | Anthropic Agent Skills standard (`SKILL.md`) |

---

## What Colony Has That Multica Doesn't

| Colony Strength | Notes |
|---|---|
| **Pre-action confirmation** | Discord ✅/❌ reaction flow before dangerous tool use — Multica only reviews after completion |
| **Typed error taxonomy** | `AntSessionError` with per-category restart behavior — Multica just shows "failed" on the board |
| **Exponential backoff** | Documented 10s→5min cap — not modeled in Multica at all |
| **Billing/auth blocking** | Suspends ant, waits for human `/resume` — not modeled in Multica |
| **Declarative per-agent YAML** | Full config files — Multica is UI/DB only |
| **In-process concurrency** | Multiple ants in one runner process — Multica spawns one CLI process per task |

---

## What Colony Should Adopt From Multica

Ordered by impact:

### 1. Skills as a Reusable Unit (High Impact)
Adopt the **Anthropic Agent Skills open standard** (`SKILL.md` files with YAML frontmatter). Skills are composable, shareable, and attachable to multiple agents. Colony currently buries instructions in per-ant YAML — not reusable. Adopting SKILL.md means Colony agents could pull from the same skill library as Claude Code itself.

### 2. The Runtime Abstraction (High Impact)
Decouple "where does the agent run" from "what colony manages." A Runtime abstraction would let Colony scale to multiple machines or support different CLIs without restructuring the entire runner. Colony currently assumes a single runner process with a hardcoded SDK.

### 3. Task Snapshot at Dispatch (Medium Impact)
Assemble a context blob (instructions, skill files, workspace context) when a task is claimed, not during inference. The DB stays cold during agent execution. If Colony ever adds persistence, this pattern avoids hot-path DB queries during agent loops.

### 4. Board Visibility / Dashboard (Medium Impact)
Colony has zero UI. Even a minimal web dashboard showing ant status (running / paused / crashed / backoff countdown), recent messages, and pending confirmations would close a massive gap. Multica's board is its primary differentiator.

### 5. MCP Server as an Orchestration Interface (Medium Impact)
Expose an MCP server on top of the Colony CLI — create ants, send commands, check status — without requiring direct shell access. Multica's community-built 27-tool MCP wrapper is a strong pattern.

### 6. Autopilot as a Named Concept (Low-Medium Impact)
Cron → creates task → agent picks it up. The indirection through a task gives an audit trail and cancellation point for free. Colony could introduce this as a named abstraction above the current `schedule: cron` trigger.

### 7. Agent Memory (Low-Medium Impact)
Multica documents integration with mem0 for cross-session agent context. Colony has no persistent agent memory — each session starts cold. Even a simple per-ant SQLite context file would be an improvement.

### 8. Vendor Neutrality at the CLI Level (Low Impact for Now)
Multica auto-detects 11+ agent CLIs. Colony supports Claude SDK + Gemini SDK. Wrapping execution as one of multiple supported runtimes (alongside raw CLI invocation) would give Colony more flexibility.

---

## What NOT to Copy

- **Board-level-only HITL** — Multica's "agents move to in_review, human clicks Done" is simpler but weaker than Colony's pre-action confirmation flow. Colony's Discord hook is more powerful for dangerous operations.
- **No typed error classification** — Multica's flat "failed" state is a step backward from what Colony already has.
- **No exponential backoff at the framework level** — delegating this to the CLI is a gap, not a feature.

---

## Summary

Multica wins on **visibility, composability, and vendor neutrality**. Colony wins on **resilience, error handling, and pre-action safety**. The highest-leverage improvements for Colony:

1. Adopt SKILL.md for reusable instruction packs
2. Add a minimal status dashboard
3. Define a Runtime abstraction for pluggable execution environments
4. Expose an MCP server for programmatic control

---

_Analysis date: 2026-05-06_
_Sources: github.com/multica-ai/multica, multica.ai, deepwiki.com/multica-ai/multica, dev.to, antigravity.codes, mem0.ai blog_
