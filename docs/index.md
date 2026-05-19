---
layout: home

head:
  - - meta
    - name: description
      content: Colony is an open-source framework for deploying autonomous LLM agents. Run Claude, Gemini, or any CLI agent as a supervised process. Manage work with a Kanban board. Stay in control.
  - - meta
    - property: og:title
      content: Colony — Autonomous AI Agent Framework
  - - meta
    - property: og:description
      content: Deploy autonomous AI agents powered by Claude, Gemini, or any CLI tool. Kanban task management, resilient supervisor, web dashboard, optional Discord — open source and self-hosted.
  - - meta
    - name: keywords
      content: autonomous AI agents, LLM agents, Claude agent, Gemini agent, AI automation, agent framework, self-hosted AI, open source AI agents

hero:
  name: Colony
  text: Autonomous AI agents that work.
  tagline: Run Claude, Gemini, or any CLI agent as a supervised process on your own infrastructure. Assign tasks from a Kanban board, review completed sessions, and stay in control.
  actions:
    - theme: brand
      text: Get started →
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/divin1/colony

features:
  - icon: 🛠️
    title: Engine-agnostic
    details: claude-cli, gemini-cli, codex, opencode, or any binary that takes a prompt. Set engine per ant — mix and match in the same colony.
    link: /configuration#engine
    linkText: Configure engines
  - icon: 📋
    title: Kanban task model
    details: Backlog → To Do → In Progress → In Review → Done. Ants pick up tasks and move them to In Review. You approve before marking Done.
    link: /getting-started#web-dashboard
    linkText: Open dashboard
  - icon: 🔄
    title: Resilient supervisor
    details: Typed error categories — rate limits, billing errors, auth failures, transient crashes — each with a specific recovery strategy. A crash in one ant never affects others.
    link: /supervisor
    linkText: Supervisor behavior
  - icon: ⚡
    title: Instant interrupt
    details: Pause takes effect immediately via SIGTERM + SIGKILL escalation. No waiting for long sessions to finish before your command is acknowledged.
  - icon: 🌐
    title: Web dashboard
    details: Live output stream, Kanban board, skill manager, session memory viewer, and a config editor — no YAML editing required after the initial setup.
  - icon: 💬
    title: Discord (optional)
    details: Send work instructions, pause, resume, or query status from any ant's Discord channel. Or skip it entirely — Colony works fine with just the web dashboard.
  - icon: 🔌
    title: MCP server
    details: Control Colony from Claude Desktop or Claude Code via the built-in MCP server. Check status, queue tasks, stream output — all from your AI assistant.
    link: /mcp
    linkText: MCP reference
  - icon: 🐳
    title: Docker-first
    details: Single-service compose — one container serves the API and web dashboard. Mount your colony directory as a volume; databases persist across restarts automatically.
    link: /docker
    linkText: Docker guide
---

<div class="home-content">

## What is Colony?

Colony deploys LLM agents — powered by the Claude CLI, Gemini CLI, or any agent binary — as persistent supervised processes that run on your infrastructure. Each agent ("ant") is configured with a plain YAML file and a plain-English instruction set.

Ants pick up tasks from a **Kanban board**, work through them autonomously, and move completed tasks to **In Review** for your approval before they're marked Done. You control the work queue; Colony handles the process lifecycle, error recovery, and observability.

There is no in-process SDK, no confirmation flow, no per-action approval prompt. The model of control is at the **session level**: you assign work, review results, and pause or redirect at any time.

---

## Quick start

```bash
colony init ./my-colony   # scaffold a colony directory
```

**`colony.yaml`** — colony-level config:

```yaml
name: my-colony

monitoring:
  port: 8080   # enables web dashboard at http://localhost:8080

defaults:
  git:
    user_name: "Your Name"
    user_email: "you@example.com"
```

**`ants/worker.yaml`** — one file per ant:

```yaml
name: worker
description: Software engineer — implements tasks from the Kanban board

engine: claude-cli   # or gemini-cli, codex, opencode, cli

instructions: |
  You are Worker, a software engineer.
  Each session you receive a task description.
  Implement it, run the tests, and open a pull request.
  Never force-push to main. Never merge your own PRs.

integrations:
  discord:          # optional
    channel: worker-logs

triggers:
  - type: discord_command   # only run when a human sends a task via Discord
                            # omit for continuous / cron-based operation
```

**`.env`** — secrets stay out of YAML:

```env
ANTHROPIC_API_KEY=sk-ant-...   # for claude-cli ants
COLONY_API_KEY=your-secret     # protects the dashboard API
```

**Run:**

```bash
colony run .
# open http://localhost:8080
```

Add tasks to the **Kanban board** in the dashboard. Ants pick them up automatically, work through them, and move them to **In Review**. You move them to **Done** when you're happy with the result.

---

## Key concepts

| Concept | Description |
|---|---|
| **Ant** | A supervised CLI subprocess with a YAML config and a task queue |
| **Colony** | A group of ants running together under shared config |
| **Task** | A unit of work with a lifecycle: Backlog → To Do → In Progress → In Review → Done |
| **Project** | A named container for tasks — manage multiple projects simultaneously |
| **Skill** | A markdown file injected into the ant's prompt at session start |
| **Session memory** | The ant's closing output is stored and prepended to its next session (SQLite) |

---

## Explore the docs

<div class="doc-links">

- **[Getting started](/getting-started)** — install, scaffold, configure, and run your first colony
- **[Configuration reference](/configuration)** — every `colony.yaml` and `ants/*.yaml` option with examples
- **[CLI reference](/cli)** — `init`, `validate`, `run`, `mcp`, `version`, `update`
- **[Docker deployment](/docker)** — single-service compose, persistent state, multi-colony setups
- **[Supervisor behavior](/supervisor)** — error categories, backoff, and blocking-error recovery
- **[MCP server](/mcp)** — control Colony from Claude Desktop or Claude Code

</div>

</div>
