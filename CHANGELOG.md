# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.7.0] — 2026-05-19

### Added

- **Single-port web dashboard** — `colony run .` now serves the full Kanban web UI from the same port as the HTTP API (default `8080`). No separate Next.js server or Docker required. The binary auto-detects the web root: `COLONY_WEB_ROOT` env var → `~/.local/share/colony/web/` (XDG install) → `web/` adjacent to the binary → `packages/web/out/` (dev/monorepo).
- **Static export** — web UI builds to `packages/web/out/` via `next build` (`output: "export"`). Dynamic routes (`/ants/[name]`, `/projects/[id]`, `/skills/[filename]`) use server wrappers with `generateStaticParams` + SPA fallback in the Bun server for unknown paths.
- **Static file server in Bun** — `createDashboardHandler` accepts `webRoot?: string`; serves files with correct MIME types and falls back to `index.html` for any non-`/api/` path not matching a static file.

### Changed

- **Docker simplified to one service** — removed the separate `web` service and `Dockerfile.web`. A single `colony` container now serves both the API and the dashboard. Port 8080 is now host-exposed by default.
- **Release tarballs** — GitHub release artifacts are now `.tar.gz` archives (`colony-linux-x64.tar.gz`, etc.) containing the binary and `web/` directory, replacing bare binaries.
- **Install script** — `install.sh` now extracts a tarball, installs the binary to `~/.local/bin/colony`, and installs the web UI to `~/.local/share/colony/web/`.
- Removed inline `DASHBOARD_HTML` fallback (~300-line status page); replaced by the full React dashboard.

### Docs

- `docs/docker.md` rewritten for single-service setup; port 3000 and `COLONY_API_URL` references removed.
- `docs/getting-started.md`, `docs/index.md`, `docs/configuration.md`, `README.md` — all dashboard URLs updated from `:3000` to `:8080`.
- `docs/cli.md` — install instructions updated for tarball format; manual download table updated.

## [0.6.0] — 2026-05-17

### Added

- **Project & task management** — replaces the simple work-item queue with a full project model. Tasks belong to projects; manage several projects simultaneously from the Kanban board. Tasks can be assigned to ants or humans. Five columns: Backlog (human staging — ants ignore it), To Do, In Progress, In Review, Done. Human approval gate: ants move tasks to In Review on completion; a human moves them to Done. `colony-tasks.db` (SQLite) stores `projects`, `tasks`, `task_comments`.
- **Kanban board UI** — five-column board scoped to a selected project. Task cards show assignee chip, source icon, and comment count. Drag-to-reorder in the To Do column. Tab-strip layout on mobile (single column view below `md` breakpoint).
- **Task detail drawer** — status badge, assignee dropdown (ant or human), description, session summary, comment thread with add-comment form; Approve / Re-queue / Move to To Do quick actions. Optimistic updates: status, assignee, and new comments apply instantly and revert on error.
- **Project settings page** (`/projects/:id`) — rename, recolor (preset swatches), delete project; accessible via the gear icon in the nav project switcher.
- **Skill management UI** (`/skills`) — create, edit, and delete skill files from the dashboard. Skill picker in the ant config editor shows available skills as checkboxes; per-path warning when a configured `skills/*.md` path is not found on disk.
- **Session memory viewer** — "Memory" tab on the ant detail page shows the stored session summary and allows clearing it. `GET/DELETE /api/ants/:name/memory` endpoints.
- **Real-time push (SSE)** — `GET /api/events` emits `task`, `project`, and `ant-state` change events to all connected clients. All mutations in the dashboard and runner emit events. Web frontend subscribes via `EventSource` and invalidates TanStack Query caches on arrival. Global polling reduced from 5 s to 30 s (fallback only).
- **Mid-session interrupt** — `pause` now terminates the running agent process immediately (SIGTERM + 5 s SIGKILL escalation) rather than waiting for the current session to finish. Interrupted sessions return to `todo` status; no crash counter increment, no backoff.
- **Docker** — two-service `docker-compose.yml` (`runner` + `web`); `Dockerfile.web` using Next.js standalone output for a lean image; `docker/.env.example`; `.dockerignore`.
- `"idle"` added to `AntRuntimeState` — ant is waiting for work (distinct from `"paused"` which is human-triggered).
- `*.db` added to `.gitignore` — SQLite databases are runtime state, not source.

### Changed

- **Supervisor loop is pull-based** — ants call `TaskStore.listTodo(antName)` on each iteration; `PromiseQueue<void>` carries only wake signals. Discord commands, cron ticks, and manual prompts all create tasks rather than pushing to a per-ant queue.
- Task lifecycle updated: `todo → in_progress` on pickup; `in_progress → in_review` on success (not `done` — human approval required); back to `todo` on failure or interrupt.
- `ColonyState.AntControlHandles` slimmed: `pushPrompt`, `cancelWorkItem`, `reorderWorkItem`, `getWorkStore` removed; `wake()` and `clearQueue()` remain.
- `DashboardOptions` interface replaces the positional `apiKey?` parameter on `createDashboardHandler`.
- Nav link text hidden below `sm` breakpoint (icon-only with tooltip).

### Removed

- **GitHub Issues integration** — `github_issue` trigger type, issue polling, `POST /api/webhooks/github` webhook, `integrations.github` from colony and ant config schemas, `@colony/github` package, `GITHUB_TOKEN` env var. Ants can still interact with GitHub via CLI tools (`gh`, `git`) within their sessions.
- `WorkStore` / `colony-work.db` — replaced by `TaskStore` / `colony-tasks.db` (fresh start, no migration).
- `hasSeenIssue` / `markIssueSeen` from `AntState`; `seen_issues` SQLite table.
- `issueContext` field from tasks.

## [0.5.0] — 2026-05-16

### Added

- **Web dashboard** (`packages/web/`) — Next.js 16 App Router frontend with shadcn/ui; dark theme.
  - Kanban board (`/`) — 4-column work item board (Queued / In Progress / Done / Failed), add-work modal, item detail drawer.
  - Ant grid (`/ants`) — status dots, pause/resume/clear, assign-work button; ant detail page with live SSE output and controls.
  - New ant form (`/ants/new`) — create an ant from a form; sanitized name input; success state.
  - Config editor (`/ants/[name]` → Config tab) — form fields for all ant YAML fields; "Restart required" banner with "Reload now" button.
  - Settings page (`/settings`) — colony-level config editor.
  - Work history table (`/work`) — filterable by status, click-to-drawer.
  - Auth gate — `AuthGate` component probes `api.status()` on mount; shows API key login card on 401; stores key in `localStorage`.
- **Work item persistence** (`packages/core/src/work-store.ts`) — SQLite table (`colony-work.db`); full lifecycle: queued → running → done / failed / cancelled. REST API: `GET /api/work`, `GET /api/work/:id`, `DELETE /api/work/:id`.
- **Config CRUD API** — `GET/PUT /api/config` (colony.yaml), `GET /api/config/ants`, `GET/POST/PUT/DELETE /api/config/ants/:name`. Raw YAML readers — no env interpolation, so template values like `${DISCORD_TOKEN}` display as-is.
- **Hot reload** — `POST /api/reload` re-reads YAML, diffs running ants against new config, stops removed ants and starts added ones without restarting the runner. `X-Colony-Restart-Required: true` response header signals the UI to show a banner.
- **MCP server** (`packages/integrations/mcp/`) — `colony mcp [--url <url>] [--key <key>]` CLI command; StdioServerTransport; 6 tools: `colony_status`, `colony_prompt`, `colony_pause`, `colony_resume`, `colony_clear`, `colony_output`. Talks to Colony's HTTP API; no shared memory with the runner. `COLONY_API_KEY` env var supported as an alternative to `--key`.
- **API key auth** — `COLONY_API_KEY` env var on the runner protects all `/api/*` routes with a Bearer token. `?key=` query param accepted for SSE endpoints (EventSource cannot set headers). Inline HTML dashboard prompts for the key on 401 (stored in `sessionStorage`).
- **Discord optional** — removed `addReaction` / `waitForReaction` from `MessagingIntegration` (dead code since v0.4.0). Three-way output priority: full Discord bot → webhook → console. `colony init` scaffold defaults to Discord commented-out with `monitoring.port: 8080` enabled.
- **Abortable supervisor loop** — `runAntWithSupervision` now accepts an `AbortController` and resolves cleanly when signalled. `PromiseQueue.next(signal)` and `sleepInterruptible` are signal-aware. Used internally by hot reload to stop individual ants.
- `docs/cli.md` — `colony mcp` command reference; `COLONY_API_KEY` env var entry.
- `docs/getting-started.md` — web dashboard and MCP server sections.
- `docs/mcp.md` — authentication section (`--key` flag and `COLONY_API_KEY` env block).

### Changed

- `createDashboardHandler(state, apiKey?)` — new optional second parameter; auth check on all `/api/*`.
- `runAntWithSupervision` now returns `Promise<void>` (was `Promise<never>`).
- CORS headers applied to all dashboard responses (required for separate Next.js frontend process).
- `pushPrompt` on `AntControlHandles` accepts optional `source?: WorkItemSource` parameter.

## [0.4.0] — 2026-05-15

### Changed

- **Engine architecture reworked to CLI-spawn model**: agents now run as child processes rather than in-process SDK loops. The colony runner spawns the CLI binary, streams its stdout, and maps output to Discord. This mirrors the Multica daemon pattern and makes Colony vendor-neutral at the execution layer.
- **New engine registry**: engines are named plugins registered via `registerEngine` / `getEngine` (`packages/core/src/engines/registry.ts`). Adding a new agent CLI requires only a single `registerEngine` call.
- **`engine` config field updated**: values are now `claude-cli` (default), `codex`, `gemini-cli`, `opencode`, `cli`. Old values `claude` and `gemini` are still accepted with a deprecation warning and automatically remapped.
- **`engine: gemini-cli` is now a CLI subprocess**: the previous in-process `@google/genai` SDK agentic loop has been replaced by spawning the `gemini --yolo` binary. This simplifies the dependency tree but removes in-process tool interception for Gemini.
- **`engine: claude-cli` uses NDJSON stream**: spawns `claude --print --output-format stream-json`; parses `assistant`, `result`, and `rate_limit_event` message types for structured error classification.
- **`engine: cli` added**: custom CLI binary support — specify `cli.binary` and optionally `cli.args` in the ant config.
- **`autonomy` and `confirmation` config fields removed**: CLI-based engines do not support intercepting individual tool calls before they execute. Human-in-the-loop is now session-level (Discord commands: pause, resume, work instructions).
- **`confirmation_timeout` removed from `colony.yaml`**: no longer applicable without per-action confirmation.
- **`poll_interval` added** at colony (`defaults.poll_interval`) and ant level: configures how long trigger-less ants sleep between runs.
- **`state` config added** to ant schema: `backend: memory | sqlite` and `path` for the SQLite file.

### Removed

- `@anthropic-ai/claude-agent-sdk` dependency from `@colony/core`
- `@google/genai` dependency from `@colony/core`
- `gemini.ts` / `gemini.test.ts` (in-process Gemini SDK engine)
- `autonomy`, `confirmation`, `gemini` config fields from ant schema
- `confirmation_timeout` from colony schema
- Per-action confirmation slash commands (`/auto-approve`, `/auto-deny`, `/confirmations`, `/reset-confirmations`) — removed with the confirmation flow

### Added

- `packages/core/src/engines/` directory with `registry.ts`, `types.ts`, `index.ts`, `claude-cli.ts`, `generic-cli.ts`
- `packages/core/src/engines/claude-cli.test.ts`
- `packages/core/src/state.ts` with `MemoryState` and `SQLiteState` implementations (GitHub issue deduplication; foundation for future session memory)
- `packages/core/src/log.ts` — shared timestamped console logger

---

## [0.3.4] — 2026-03-23

### Added

- **`logging.lm_output` config field**: controls where LLM text output is routed per ant. `"discord"` (default, backward compat) posts text to Discord as before; `"console"` suppresses Discord output and prints to the terminal only; `"both"` routes to both. Enables keeping Discord clean while maintaining full verbosity locally.
- **`notify_discord` Gemini tool**: Gemini ants now have a `notify_discord(message)` function they can call to post intentional key-milestone messages to Discord. This is the only Discord output path when `lm_output: "console"` is set, giving the ant full control over what reaches Discord.
- **Fine-grained confirmation overrides**: persistent per-ant rules to auto-approve or auto-deny dangerous actions without prompting Discord.
  - React **🔁** on any confirmation prompt to save an always-allow rule for that exact command.
  - `/auto-approve <pattern>` — store a regex pattern that auto-approves matching actions.
  - `/auto-deny <pattern>` — store a regex pattern that auto-denies matching actions.
  - `/confirmations` — list all current overrides for this ant.
  - `/reset-confirmations` — clear all overrides for this ant.
  - Rules are checked before any Discord prompt is sent; matching rules short-circuit immediately.
  - Stored in the same backend as the ant state (`memory` or `sqlite`).
- **Improved confirmation message format**: the confirmation message now uses a code block for the command and shows all three reaction options inline: `✅ approve · ❌ deny · 🔁 always allow`.

### Changed

- `/help` response updated to list the four new confirmation override commands.

---

## [0.3.3] — 2026-03-23

### Added

- **Console logging for ant lifecycle events**: `colony run` now prints timestamped log lines to the terminal for all key events — ant starting, each session start, session completed, max-turns restart, rate limits, crashes, blocking errors (auth/billing/budget), and pause/resume. Previously all status output went only to Discord, making local debugging difficult.
- **Env auto-load confirmation**: a `Loaded env from <path>` line is printed when `.env` is auto-loaded from the colony directory.
- **`Makefile` for local development**: `make build` compiles the colony CLI binary for the current platform using `bun build --compile`; `make install` additionally copies it to `~/.local/bin/colony`; `make clean` removes the local build artifact. Platform and architecture are auto-detected.
- **Reaction fallback for confirmation flow**: `waitForReaction` now also resolves when the human sends a plain-text ✅ or ❌ message in the same channel, in case the Discord gateway misses the reaction event. Requires passing `channelId` in the options (done automatically by `requestConfirmation`).

---

## [0.3.2] — 2026-03-23

### Added

- **Auto-load `.env` from the colony directory**: `colony run` and `colony validate` now automatically load a `.env` file from the colony directory if one exists, so `${VAR}` references resolve without needing to pre-export variables in the shell.
- **`--env <file>` flag**: explicit override to load a `.env` file from a custom path. Example: `colony run . --env /path/to/secrets.env`.

---

## [0.3.1] — 2026-03-20

### Fixed

- **`colony update` 404 on no releases**: the update command now exits cleanly with `No releases published yet.` instead of throwing an error when the GitHub API returns 404 (repo has no releases yet).

### Changed

- **`colony init` no longer creates `.env.example`**: colony directories are local on-disk configurations, not git repositories, so the `.env.example` convention does not apply. `init` now creates `.env` directly with placeholder values. If you commit your colony config to git, add a `.gitignore` yourself to exclude `.env`.

### Docs

- README: removed stale `Cursor` engine references (removed in 0.3.0); updated `Gemini CLI engine` to `Gemini Gen AI SDK engine` throughout.

---

## [0.3.0] — 2026-03-20

### Changed

- **Gemini engine replaced**: the Gemini CLI subprocess (`spawn("gemini", ...)`) has been replaced with an in-process agentic loop using the `@google/genai` SDK. Gemini ants now have full tool-call interception — `autonomy` and `confirmation` are enforced in code, not via prompt injection. No CLI installation required; only `GEMINI_API_KEY` is needed.
- **Cursor engine removed**: `engine: cursor` is no longer supported. The Cursor CLI subprocess approach could not support in-process tool interception, making it incompatible with Colony's confirmation flow.

### Added

- **`GEMINI_API_KEY` startup validation**: missing key is caught at the start of `runAntWithGemini()` with a clear error message rather than failing deep inside the first API call.
- **Gemini bash output truncation**: command output is capped at 2000 characters (Discord's message limit) with a `[output truncated]` notice when the limit is hit.

### Fixed

- **CLI integration tests**: subprocess spawning in `validate.test.ts` and `run.test.ts` now uses `process.execPath` instead of `"bun"`, fixing test failures when `bun` is not on `$PATH`.

### Docs

- Getting started: added direct links and descriptions for obtaining `ANTHROPIC_API_KEY` (console.anthropic.com) and `GEMINI_API_KEY` (Google AI Studio free tier); clarified that a Claude.ai or Claude Code subscription does not include API access.
- Corrected stale "Gemini CLI" references across index, CLI reference, and environment variable tables.
- Fixed inconsistent GitHub repository URLs — all references now use `divin1/colony`.
- Supervisor: billing/auth recovery instructions now cover both Anthropic and Google accounts.

---

## [0.2.0] — 2026-03-19

### Added

- **Cursor CLI engine**: ants can now run as Cursor sessions via `engine: cursor`. Configurable model via the `cursor.model` field (default `claude-4.5`). Joins Claude and Gemini as a first-class engine option.
- **Typed error classification**: the supervisor now maps SDK errors to distinct categories (`rate_limit`, `billing`, `auth`, `budget`, `max_turns`, `transient`, `permanent`) via `AntSessionError` in `errors.ts`. Each category produces a specific Discord notification and restart behaviour.
- **Exponential backoff**: transient crashes and permanent errors now back off exponentially (10 s → 20 s → 40 s … capped at 5 min) rather than using a fixed 10 s delay. The counter resets after any successful session.
- **Blocking error handling**: billing, auth, and budget errors pause the ant indefinitely and post a dedicated Discord message (`💳`, `🔐`, `💰`). The ant resumes only after a human sends `/resume` — no polling, no retry loop.
- **Rate limit awareness**: `rate_limit_event` messages with `status: rejected` are caught and the supervisor waits until the `resetsAt` timestamp if provided, falling back to exponential backoff otherwise.
- **`max_turns` treated as success**: SDK `error_max_turns` results are classified as normal termination — no Discord message, no backoff penalty, immediate restart.
- **Supervisor documentation**: new `docs/supervisor.md` covering error categories, backoff behaviour, and blocking errors.

### Changed

- Crash Discord messages now vary by error type rather than always showing `❌ crashed`. See the updated [status message reference](./README.md#ant--human).

## [0.1.0] — 2026-03-15

Initial public release of Colony.

### Added

- **Core framework**: colony runner with ant lifecycle management (spawn, monitor, restart on crash)
- **Claude Agent SDK integration**: ants run as in-process Agent SDK sessions with full hook support
- **Gemini CLI engine**: optional `engine: gemini` support via subprocess
- **Autonomy levels**: `human` (Discord confirmation), `full` (auto-approve), `strict` (auto-deny)
- **Discord integration**: message send/receive, confirmation reactions with timeout, slash commands (`/help`, `/status`, `/stats`, `/pause`, `/resume`, `/clear`)
- **GitHub integration**: issue listing, comment creation, issue polling triggers
- **Confirmation flow**: dangerous action detection with configurable tool patterns and bash regex matching
- **Cron scheduling**: ants can run on cron schedules via `schedule.cron`
- **State persistence**: memory and SQLite backends for tracking seen issues across restarts
- **Config validation**: Zod schemas with environment variable interpolation and fail-fast on invalid config
- **CLI**: `colony init` (scaffold), `colony validate` (check config), `colony run` (start colony)
- **CLI distribution**: `colony version` and `colony update` commands with multi-platform binary support
- **Docker deployment**: Dockerfile, docker-compose template, and documentation
- **Documentation site**: VitePress-based docs with getting started guide, configuration reference, CLI reference, and Docker guide
- **Install script**: `curl | sh` installer for Linux, macOS, and WSL
- **Example configs**: three realistic ant examples (code reviewer, issue triager, dependency updater)
- **PostToolUse logging**: configurable verbosity (`off`, `impactful`, `all`)

### Known Limitations

- GitHub integration is minimal (list issues, post comments) — no PR creation or branch management
- Backlog management (auto-discover tasks from GitHub Issues) is not yet implemented
- Slack, Jira, and Linear integrations are planned but not yet available
- Session interruption takes effect after the current session completes, not mid-session
- Ants do not persist context across session restarts (`persistSession: false`)
- GitHub triggers use 5-minute polling; webhook support is planned
