---
layout: home

hero:
  name: Colony
  tagline: Deploy autonomous LLM agents that work continuously, react to events, and report back to you over Discord.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/divin1/colony

features:
  - icon: 🐜
    title: Ant-based agents
    details: Each ant is a fully autonomous agent session — any CLI-based agent (claude, gemini, codex, opencode, or your own binary) — configured with a plain YAML file and a plain-English instruction set.
  - icon: 💬
    title: Discord control panel
    details: Send work instructions, pause, resume, or query status from any ant's Discord channel. Slash commands are handled instantly — no LLM round-trip, no tokens consumed.
  - icon: ⚡
    title: Event-driven or scheduled
    details: Wake ants on Discord commands or cron schedules. Ants with no triggers run continuously, sleeping between sessions. Assign work at any time via the Kanban board.
  - icon: 🔄
    title: Resilient supervisor
    details: Each ant runs in its own supervisor loop. Crashes are classified — rate limits wait for reset, billing/auth errors pause and alert you, transient failures use exponential backoff. A crash in one ant never affects others.
  - icon: 🐳
    title: Docker-first deployment
    details: Two-service compose setup (runner + web dashboard). Mount your config directory as a volume, pass secrets via env file, and get 24/7 autonomous operation with a persistent Kanban board.
  - icon: 🔌
    title: Multi-engine support
    details: Run ants on claude, gemini, codex, opencode, or any CLI tool that takes a prompt. Set engine per ant — mix and match in the same colony.
---
