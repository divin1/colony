# Changelog

All notable changes to this project will be documented in this file.

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
