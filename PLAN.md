# Colony — Project Plan

_Last updated: 2026-05-16_ (0.5.0)

---

## Current State

v0.5.0 is complete. Colony now ships with a full web dashboard (Kanban board, config editor, live output), an MCP server for Claude Desktop / Claude Code integration, SQLite-backed work item persistence, hot reload, and API key auth for remote deployments. Discord is fully optional.

### What is fully implemented

| Area | Status | Notes |
|---|---|---|
| Colony runner | ✅ | Ant lifecycle, supervisor loop, typed error classification, backoff |
| Engine registry | ✅ | Plugin system — registerEngine / getEngine |
| `claude-cli` engine | ✅ | Spawns `claude` binary, NDJSON parsing, structured error classification |
| `gemini-cli` engine | ✅ | Spawns `gemini --yolo` (CLI subprocess, no tool interception) |
| `codex` / `opencode` / `cli` engines | ✅ | Generic CLI runner, streams stdout to Discord |
| Discord integration | ✅ | Optional; send + resolveChannelId; webhook fallback |
| Human → Ant commands | ✅ | Slash commands (/help, /status, /stats, /pause, /resume, /clear) |
| GitHub integration | ✅ | listIssues (with label filter), createIssueComment |
| Config validation | ✅ | Zod schemas, env interpolation, fail-fast on missing vars |
| State persistence | ✅ | memory and SQLite backends; issue deduplication |
| PLAN.md convention | ✅ | Injected into every ant's system prompt |
| Git identity | ✅ | Injected into every ant's system prompt from colony.yaml defaults |
| CLI: init / validate / run / update / mcp | ✅ | Full CLI surface, including self-update and MCP server |
| Docker deployment | ✅ | Dockerfile + docker-compose; no SDK deps required |
| CLI binary distribution | ✅ | `bun build --compile`, GitHub Actions release workflow, install.sh |
| Web dashboard | ✅ | Next.js 16, Kanban board, live SSE output, config editor, auth gate |
| Work item persistence | ✅ | SQLite (`colony-work.db`); lifecycle queued→running→done/failed/cancelled |
| Hot reload | ✅ | `POST /api/reload` — diffs and restarts changed ants without runner restart |
| MCP server | ✅ | 6 tools; StdioServerTransport; `colony mcp` CLI command |
| API key auth | ✅ | `COLONY_API_KEY` env var; Bearer token on all `/api/*`; `?key=` for SSE |
| Documentation | ✅ | getting-started, configuration, cli, docker, supervisor, mcp |

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

- **Core:** runner helpers, config, errors, state, claude-cli engine, dashboard (including auth), work store, colony-state
- **CLI:** `init`, `validate`, `run` commands
- **Integrations:** Discord, GitHub, MCP fully tested
- 257 tests pass (`bun test`)

---

## Roadmap

### Phase 0 — Bug fixes ✅ (complete)

- [x] Fix `init.ts` scaffold: remove `confirmation_timeout` from generated `colony.yaml`
- [x] Wrap engine spawns in try-catch; classify binary-not-found as `permanent` AntSessionError
- [x] Pre-flight binary check in `runColony()` — fail fast before supervisor loops start
- [x] Update PLAN.md to v0.4.0

### Phase 1 — Make Discord optional ✅ (complete)

Discord is now fully optional. The runner works without any messaging config; Discord is an opt-in notification channel.

- [x] Make `discord` optional in `runColony()` — output to console when absent
- [x] Add `discord_webhook` config to `colony.yaml` (webhook URL, no bot setup required)
- [x] Remove `addReaction` / `waitForReaction` from `MessagingIntegration` and `DiscordIntegration` (dead code since v0.4.0)
- [x] Update `commands/run.ts` to not require Discord config (three-way priority: full bot → webhook → console)
- [x] Update `commands/init.ts` scaffold — Discord is commented out by default; monitoring port enabled

### Phase 2 — Local web dashboard ✅ (complete)

Replaces Discord as the main human interface. Embedded HTTP server, opt-in via `monitoring.port`.

- [x] `Bun.serve()` HTTP server embedded in runner
- [x] REST API: GET /api/status, POST /api/ants/:name/{pause,resume,prompt,clear}
- [x] Server-Sent Events stream of live session output per ant
- [x] Minimal single-page HTML dashboard (ant cards, live output, control buttons)
- [x] `ColonyState` object tracking per-ant status for the HTTP layer

### Phase 3 — GitHub Issues bidirectional ✅ (complete)

Agents consume GitHub Issues (already done via trigger) and comment back on them.

- [x] Inject issue context into session prompt when triggered by `github_issue` (repo, number, URL, body, summary instruction)
- [x] Post summary comment on the triggering issue after a successful session via `github.createIssueComment()`
- [x] `EngineResult.lastOutput` captures last assistant text block; returned from `runAnt()`

### Phase 4 — SKILL.md support ✅ (complete)

Adopt Anthropic Agent Skills standard. Composable instruction files injected at dispatch time.

- [x] `skills: [path/to/skill.md]` field in ant config (paths relative to colony directory)
- [x] `packages/core/src/skill.ts` — `loadSkill()` strips YAML frontmatter, returns body
- [x] Skills loaded fresh each session (task-snapshot pattern) and appended to `commonInstructions`
- [x] Example skill in `config/examples/skills/code-review-standards.md`

### Phase 5 — Agent memory ✅ (complete)

SQLite-backed cross-session context. Ants remember what they did last time.

- [x] `getLastSessionSummary` / `setSessionSummary` on `AntState` interface
- [x] `session_summaries` table in SQLiteState (upsert, scoped per ant)
- [x] `MemoryState` also implements summaries (in-process, resets on restart)
- [x] `lastOutput` (from Phase 3) stored after each successful session
- [x] Previous summary prepended to next session prompt as `## Context from your previous session`

### Phase 6 — MCP server ✅ (complete)

Expose colony control as MCP tools for Claude Desktop and other MCP hosts.

- [x] `packages/integrations/mcp/` workspace package (`@colony/mcp`)
- [x] Tools: colony_status, colony_prompt, colony_pause, colony_resume, colony_clear, colony_output
- [x] `colony mcp [--url <url>] [--key <key>]` CLI command — StdioServerTransport for Claude Desktop / Claude Code
- [x] HTTP client architecture — talks to Colony's existing API; `monitoring.port` must be set
- [x] Docs: `docs/mcp.md`

### Phase 12b — Project & Task Management (UI) ✅ (complete)

Full web UI for the project/task model. Old work-item components replaced throughout.

- [x] `StatusDot.tsx` — `"idle"` state added (muted dot)
- [x] `TaskCard.tsx` (new) — title, assignee chip (ant/human), source icon, comment count
- [x] `TaskDrawer.tsx` (new) — task detail drawer: status badge, assignee dropdown, description, last output, GitHub issue link, comment thread, add-comment form; "Approve" (in_review→done), "Re-queue" (done/in_review→todo), "Move to To Do" (backlog→todo) quick actions
- [x] `AddTaskModal.tsx` (new) — project selector, title, description, ant/human toggle, ant picker, initial status (backlog or todo)
- [x] `KanbanBoard.tsx` — rebuilt: 5 columns (Backlog muted, To Do sortable via dnd-kit, In Progress/In Review/Done read-only); project-scoped; `+` button per column opens `AddTaskModal` pre-set to that status
- [x] `Nav.tsx` — project switcher dropdown (select element); "New project…" option; shown only on board page
- [x] `app/page.tsx` — owns project state; auto-selects first project; "Create your first project" empty state; "New project" dialog
- [x] `app/work/page.tsx` — repurposed as task list/history table; filters by status and assignee; `TaskDrawer` for detail
- [x] `app/ants/page.tsx` — updated to `AddTaskModal`
- [x] `app/ants/[name]/page.tsx` — "Recent tasks" sidebar uses `api.taskList({ assignee })`; actions use `AddTaskModal` and `TaskDrawer`
- [x] Deleted: `WorkItemCard.tsx`, `WorkItemDrawer.tsx`, `AddWorkModal.tsx`

### Phase 12a — Project & Task Management (backend) ✅ (complete)

Replaces the ant-centric `WorkStore` with a proper project/task model. `WorkStore` and `colony-work.db` are gone; `TaskStore` and `colony-tasks.db` are the new source of truth.

- [x] `task-store.ts` — three SQLite tables: `projects`, `tasks`, `task_comments`; full CRUD; pull-model helpers `listTodo`, `countTodo`, `cancelAllTodo`; `reorder`; `getOrCreateDefaultProject`
- [x] `colony-state.ts` — `AntControlHandles` slimmed to `{pause, resume, wake, clearQueue, getQueueSize}`; `"idle"` added to `AntRuntimeState`; `pushPrompt/cancelWorkItem/reorderWorkItem/getWorkStore` removed; `wake()` and `listAntNames()` added
- [x] `runner.ts` — supervisor rewritten: `PromiseQueue<void>` wake-signal queue replaces `PromiseQueue<WorkItem>`; ant pulls tasks from `TaskStore.listTodo` each iteration; Discord messages, GitHub poll, cron, and webhook all create tasks; on session success → task `in_review` + comment; on failure/interrupt → task back to `todo` + comment; `TaskStore` always created (not just when monitoring port configured)
- [x] `dashboard.ts` — new project/task/comment API routes (14 endpoints); prompt endpoint creates task + wakes ant; old `/api/work` routes removed; `DashboardOptions.taskStore` added
- [x] `index.ts` — exports `task-store` instead of `work-store`
- [x] Web `types.ts` — `Project`, `Task`, `TaskComment`, `TaskStatus`, `AssigneeType`, `AntRuntimeState` (now includes "idle"); `PersistedWorkItem` removed
- [x] Web `api.ts` — project/task/comment API calls; old work-item calls removed
- [x] `work-store.ts` and `work-store.test.ts` deleted (fresh start)
- [x] 25 new `task-store.test.ts` tests + updated colony-state + dashboard tests; total: 289

### Phase 11 — Drag-and-drop Kanban + `PATCH /api/work/:id` ✅ (complete)

Queued work items can be reordered by dragging within the Queued column.

- [x] `work-store.ts` — `position` column added (migration-safe); `create()` sets position to `MAX + 1`; `list()` sorts queued items by position ASC, others by `created_at DESC`; `reorder(id, newIndex)` updates all positions atomically in a SQLite transaction
- [x] `PromiseQueue.reorderBy(predicate, newIndex)` — in-memory counterpart
- [x] `AntControlHandles.reorderWorkItem` + `ColonyState.reorderWorkItem` wired through
- [x] `PATCH /api/work/:id` — body `{ position: number }`: validates queued status, updates store + in-memory queue; 409 if running
- [x] `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` installed
- [x] `KanbanBoard.tsx` — `DndContext` wraps the board; `SortableContext` + `verticalListSortingStrategy` on Queued column only; `SortableWorkItemCard` with drag-handle grip icon (click and drag don't conflict); `DragOverlay` for floating card; optimistic reorder via `queryClient.setQueryData`, reverts on API error
- [x] `api.workReorder(id, position)` added to web API client
- [x] 11 new backend tests (work-store reorder + dashboard PATCH); total: 281

### Phase 10 — Mid-session interrupt ✅ (complete)

Pause takes effect immediately — the running agent process is terminated rather than waiting for the session to finish.

- [x] `signal?: AbortSignal` added to `EngineRunOptions` and `AntRunOptions`
- [x] `claude-cli.ts` — `raceSignal` helper races `reader.read()` against the signal; on abort kills the child process (SIGTERM + 5s SIGKILL escalation) and re-throws `AbortError`
- [x] `generic-cli.ts` — same pattern
- [x] `runner.ts` — per-session `AbortController` (`sessionController`) tracked alongside the ant-level one; `pause()` signals `sessionController` when a session is active (broadcasts "pausing…") vs queues for later ("will pause after current session")
- [x] Supervisor distinguishes session-level abort (pause) from ant-level abort (stop): session abort marks work item `failed`, does not increment crash counter, lets outer loop fall into `waitForResume()`
- [x] 4 new engine signal tests; total: 270

### Phase 9 — GitHub webhooks ✅ (complete)

Real-time issue triggers via GitHub webhook push instead of 5-minute polling.

- [x] `POST /api/webhooks/github` — exempt from API key auth; HMAC-SHA256 signature verification via `X-Hub-Signature-256`
- [x] Handles `issues` events with `action: opened | labeled`; ignores everything else
- [x] `onGithubWebhook` callback in `createDashboardHandler` options; runner registers with ant-config-aware match logic
- [x] `DashboardOptions` interface replaces positional `apiKey?` arg on `createDashboardHandler`
- [x] `GitHubIssueEvent` type exported from `dashboard.ts`
- [x] `integrations.github.webhook_secret` field in `ColonyConfigSchema` and `RawColonyConfigSchema`
- [x] `IssueContext` exported as named type from `work-store.ts`
- [x] `AntControlHandles.pushPrompt` + `ColonyState.pushPrompt` extended to forward `issueContext?`
- [x] Label matching: `action: labeled` checks only the newly added label; `action: opened` checks all issue labels
- [x] Repo filter: ant must list the event's repo in `integrations.github.repos` (if any configured)
- [x] 9 new tests; total: 266

### Phase 8 — Docker update ✅ (complete)

Runner + web dashboard deployable as a single `docker compose up`.

- [x] `docker/Dockerfile.web` — multi-stage: `oven/bun:1` builder → `node:24-slim` runtime via Next.js standalone output
- [x] `packages/web/next.config.ts` — `output: "standalone"` + `outputFileTracingRoot` for monorepo support
- [x] `docker/docker-compose.yml` — two services: `runner` and `web`; web proxied to `http://runner:8080`
- [x] `docker/.env.example` — all env vars documented including `COLONY_API_KEY`
- [x] `.dockerignore` — excludes `node_modules`, `.next`, `.env`, `*.db` from build context
- [x] `docs/docker.md` — rewritten for two-service setup; auth, multi-colony, and updating sections

### Phase 7 — Kanban dashboard + config editor + auth ✅ (complete)

Full web application for managing Colony without touching YAML or a terminal.

- [x] `packages/web/` — Next.js 16 App Router, shadcn/ui, Tailwind CSS dark theme
- [x] Kanban board (`/`) — 4-column work item board (queued/running/done/failed), add-work modal, item drawer
- [x] Ant grid (`/ants`) — status dots, pause/resume/clear, assign-work button; ant detail with live SSE output
- [x] Work history (`/work`) — filterable table, status chips, click-to-drawer
- [x] Config editor (`/ants/[name]`) — form fields for all ant YAML fields; "restart required" banner
- [x] New ant form (`/ants/new`) — create ant YAML from form; sanitized name input
- [x] Settings page (`/settings`) — colony-level config editor
- [x] Hot reload — `POST /api/reload` diffs running ants vs. new config; stops/restarts changed ants
- [x] Auth gate — `COLONY_API_KEY` env var; Bearer token on all `/api/*`; `AuthGate` component in web frontend; `?key=` query param for SSE; inline HTML dashboard prompts for key on 401
- [x] Work item persistence — SQLite (`colony-work.db`); full lifecycle tracking
- [x] Config CRUD API — `GET/PUT /api/config`, `GET/POST/PUT/DELETE /api/config/ants/:name`

---

## Open Decisions

### Discord long-term

Discord remains available as an optional integration but is no longer the primary control plane. The web dashboard (Phase 2) is the target control plane. Long-term, Discord may be replaced by a simple webhook notifier (Phase 1 introduces this). No decision yet on whether to deprecate the full Discord integration. Conceptually, Discord or a simple webhook notifier would simply act as a channel to notify the human when their input is required.

### Interrupting a running session

Human commands (pause, work instructions) currently only take effect after the current session finishes. Interrupting mid-session requires an AbortSignal passed to the engine runner. Not yet planned.

### GitHub webhooks vs. polling

Issues are polled every 5 minutes. Real-time response requires exposing an HTTP webhook endpoint. Phase 2's HTTP server makes this feasible — add it then.

---

## Key invariants to preserve

- `runAntWithSupervision` loops forever unless its `AbortController` is signalled — `runColony` signals it via the hot-reload stop path; calling code must await the returned promise after signalling
- Ant crashes must never propagate to other ants — always catch in the supervisor loop
- Discord token / GitHub token must never be logged or appear in error messages
- Engine binary must exist at startup — checked in `runColony()` pre-flight
