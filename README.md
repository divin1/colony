# Colony

Colony is a framework for deploying autonomous LLM-based agents. Each ant is an agent session — powered by [Claude](https://github.com/anthropics/claude-agent-sdk) or [Gemini](https://github.com/google-gemini/gemini-cli) — configured to do work autonomously while you focus on other things.

Ants can maintain software projects, write blog posts, process data, or do anything an LLM agent can do &mdash; guided by a YAML config file and reporting back to you via Discord.

## Core Concepts

### Ant
An **ant** is an agent session (Claude or Gemini) running in-process with a defined purpose. Each ant:
- Is declared in a YAML config file (name, instructions, integrations, schedule)
- Runs autonomously: on a schedule, in response to events, on human command, or from its own backlog
- Reports its activity to Discord; optionally asks for human approval before dangerous actions
- Has access to only the tools and repos it needs

### Colony
A **colony** is a group of ants deployed together under a shared configuration. A colony can contain multiple specialized ants (one per project) or a single generalist ant.

### Colony Runner
The **colony runner** is the host process that manages the Agent SDK sessions for all ants in a colony. It reads the colony config, starts each ant as an in-process Agent SDK session, bridges messages between ants and external integrations, and restarts ants that fail.

## How It Works

```
Human (Discord)
       ↕
Colony Runner
       ↕
Ant (Claude or Gemini agent session, running in-process)
       ↕
External services (GitHub, etc.)
```

1. You define your ants in YAML config files inside a colony directory
2. You deploy the colony via Docker (or run it locally with the CLI)
3. The colony runner starts each ant as an Agent SDK session with its instructions
4. Each ant enters its work loop: polling for tasks, reacting to events, or waiting for human commands
5. When a dangerous action is detected, Colony applies the ant's autonomy policy: ask Discord (`human`), auto-approve (`full`), or auto-deny (`strict`)
6. Ants report progress, results, and errors to their designated Discord channel

## Ant Configuration

Each ant is declared in a single YAML file:

```yaml
name: alice
description: Maintains the my-app repository — reviews issues, implements fixes, opens PRs

instructions: |
  You are Alice, a software engineer responsible for the my-app repository.
  Review open GitHub issues labelled 'ant-ready', implement fixes, and open PRs.
  Always run the test suite before opening a PR. Never force-push to main.

engine: claude       # "claude" (default) or "gemini"
autonomy: human      # "human" (default) | "full" | "strict"
                     # human:  dangerous actions forwarded to Discord for approval
                     # full:   fully autonomous, no confirmation prompts
                     # strict: dangerous actions auto-denied, no Discord contact

integrations:
  github:
    repos:
      - my-org/my-app
  discord:
    channel: alice-logs      # channel where alice posts updates and asks for confirmation

schedule:
  cron: "0 9 * * 1-5"        # start working at 9 am on weekdays

triggers:
  - type: github_issue        # also wake up when a matching issue is opened
    labels: [ant-ready]
  - type: discord_command     # also respond to messages in alice's Discord channel
```

### Colony-Level Config

Shared settings (tokens, default integrations, global defaults) live in a top-level `colony.yaml`:

```yaml
name: my-colony

integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: my-server
  github:
    token: ${GITHUB_TOKEN}

defaults:
  confirmation_timeout: 30m   # treat no Discord reaction within 30 min as deny
```

## Human ↔ Ant Communication

Each ant has a dedicated Discord channel. The ant uses it to:
- Post status updates as it works
- Report completed tasks, errors, and summaries
- Request human approval before dangerous actions (when `autonomy: human`)

You interact with an ant by:
- Sending a message in the ant's channel (treated as a direct command)
- Reacting ✅ or ❌ to a confirmation request

### Autonomy and Confirmation

Each ant's `autonomy` setting controls what happens when a dangerous action is detected (`git push`, `rm -rf`, `sudo`, pipe-to-shell, SQL drops, etc.):

| `autonomy` | Behaviour |
|---|---|
| `human` | Pauses and posts a Discord message with ✅/❌ reactions. Timeout = deny. |
| `full` | Auto-approves everything. No Discord prompts. |
| `strict` | Auto-denies everything flagged. No Discord prompts. |

Additional rules — specific tools or bash patterns that should always be flagged — are configured separately in the `confirmation` block.

## Documentation

- [Getting started](./docs/getting-started.md) — install, scaffold, configure, and run your first colony
- [Configuration reference](./docs/configuration.md) — all `colony.yaml` and `ants/*.yaml` options with examples
- [CLI reference](./docs/cli.md) — `colony init`, `validate`, `run`
- [Docker deployment](./docs/docker.md) — docker compose and docker run, persistent state, multi-colony setups

## Deployment

Colony is designed to run in Docker. A typical colony layout:

```
my-colony/
  colony.yaml             # colony-level config and shared settings
  ants/
    alice.yaml            # ant config
    bob.yaml              # ant config
  .env                    # secrets (DISCORD_TOKEN, GITHUB_TOKEN, etc.)
```

To build and run with Docker:

```bash
docker build -f docker/Dockerfile -t colony .
docker run --env-file .env -v $(pwd):/colony -w /colony colony run .
```

Or with docker-compose from inside the `docker/` directory:

```bash
docker compose up
```

## CLI

The `colony` CLI manages colonies from your terminal:

```
colony init [dir]         # scaffold a new colony directory (default: ./my-colony)
colony validate [dir]     # validate colony and ant config files
colony run [dir]          # start the colony runner (all ants)
```

See [docs/cli.md](./docs/cli.md) for installation instructions and full command reference.

## Integrations

| Integration | Status              | Purpose                                          |
|-------------|---------------------|--------------------------------------------------|
| Discord     | ✅ Available        | Human ↔ ant messaging and confirmations          |
| GitHub      | 🔄 Partial          | Read issues, post comments; issue triggers       |
| Slack       | Planned             | Alternative to Discord                           |
| Jira        | Planned             | Read tickets as ant backlog                      |
| Linear      | Planned             | Read issues as ant backlog                       |

## Roadmap

- [x] Colony runner: ant lifecycle management (spawn, monitor, restart)
- [x] Claude Agent SDK session integration
- [x] Gemini CLI engine support (`engine: gemini`)
- [x] Autonomy levels: `human`, `full`, `strict`
- [x] Discord integration: message send/receive, confirmation reactions, command triggers
- [x] GitHub integration: issue reading, comment creation, issue polling triggers
- [x] Cron scheduling for ants
- [x] CLI: `init`, `validate`, `run`
- [x] Docker / docker-compose deployment support
- [ ] Backlog management: auto-discover tasks from GitHub Issues
- [ ] GitHub webhook triggers (replace polling)
- [ ] Slack integration
- [ ] Jira integration
- [ ] Linear integration
