---
layout: home

hero:
  name: Colony
  tagline: Deploy autonomous LLM agents that work continuously, react to events, and check in with you before taking irreversible actions.
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
    details: Each ant is a fully autonomous agent session — Claude or Gemini — configured with a plain YAML file and a plain-English instruction set.
  - icon: 🔒
    title: Human-in-the-loop confirmations
    details: Dangerous actions pause and post a Discord confirmation request. React ✅ to proceed or ❌ to skip. Timeout defaults to deny.
  - icon: ⚡
    title: Event-driven or scheduled
    details: Wake ants on GitHub issues, Discord commands, or cron schedules. Ants with no triggers run continuously, sleeping between sessions.
  - icon: 🔄
    title: Resilient supervisor
    details: Each ant runs in its own supervisor loop. Crashes are classified — rate limits wait for reset, billing/auth errors pause and alert you, transient failures use exponential backoff. A crash in one ant never affects others.
  - icon: 🐳
    title: Docker-first deployment
    details: One container per colony. Mount your config directory as a volume, pass secrets via env file, and get 24/7 autonomous operation.
  - icon: 🔌
    title: Multi-engine support
    details: Run ants on Claude (Agent SDK) or Gemini (Google Gen AI SDK). Set engine per ant — mix and match in the same colony.
---
