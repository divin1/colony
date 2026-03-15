# Changelog

All notable changes to this project will be documented in this file.

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
