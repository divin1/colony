# Colony

Colony is a framework for deploying autonomous LLM-based agents. Each ant is a [Claude Code](https://claude.ai/code) process configured to do work autonomously while you focus on other things.

Ants can maintain software projects, write blog posts, process data, or do anything Claude Code can do &mdash; guided by a YAML config file and reporting back to you via Discord.

## Core Concepts

### Ant
An **ant** is a managed Claude Code process with a defined purpose. Each ant:
- Is declared in a YAML config file (name, instructions, integrations, schedule)
- Runs autonomously: on a schedule, in response to events, on human command, or from its own backlog
- Reports its activity and asks for confirmation via Discord or Slack
- Has access to only the tools and repos it needs

### Colony
A **colony** is a group of ants deployed together under a shared configuration. A colony can contain multiple specialized ants (one per project) or a single generalist ant.

### Colony Runner
The **colony runner** is the host process that spawns, monitors, and manages the ants in a colony. It reads the colony config, starts each ant as a Claude Code subprocess, bridges messages between ants and external integrations, and restarts ants that fail.

## How It Works

```
Human (Discord / Slack)
         ↕
  Colony Runner
         ↕
  Ant (Claude Code subprocess)
         ↕
  External services (GitHub, etc.)
```

1. You define your ants in YAML config files inside a colony directory
2. You deploy the colony via Docker (or run it locally with the CLI)
3. The colony runner spawns each ant as a Claude Code subprocess with its instructions
4. Each ant enters its work loop: polling for tasks, reacting to events, or waiting for human commands
5. When an ant needs human input before a dangerous action, it posts a confirmation request to Discord with ✅/❌ reactions and pauses until you respond
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

backlog:
  source: github_issues
  filter:
    labels: [ant-ready]
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
- Ask for confirmation before destructive or irreversible actions (with ✅/❌ reactions)
- Report completed tasks, errors, and summaries

You interact with an ant by:
- Sending a message in the ant's channel (treated as a direct command)
- Reacting ✅ or ❌ to a confirmation request

### Confirmation Flow

1. Ant identifies an action that requires human approval (e.g. deleting a branch, merging a PR)
2. Ant posts a message describing the action and its consequences
3. Two reactions are added automatically: ✅ approve and ❌ deny
4. Ant suspends and waits for a reaction
5. On ✅: ant proceeds; on ❌: ant skips the action and continues
6. On timeout (configurable): action is treated as denied

## Deployment

Colony is designed to run in Docker. A typical colony layout:

```
my-colony/
  colony.yaml             # colony-level config and shared settings
  ants/
    alice.yaml            # ant config
    bob.yaml              # ant config
  docker-compose.yml      # one service per ant, or a single colony-runner service
  .env                    # secrets (DISCORD_TOKEN, GITHUB_TOKEN, etc.)
```

## CLI

The `colony` CLI manages colonies from your terminal:

```
colony init               # scaffold a new colony directory
colony validate           # validate colony and ant config files
colony start              # start the colony runner (all ants)
colony start alice        # start a single ant
colony stop               # stop the colony
colony status             # show running/stopped status of each ant
colony logs alice         # tail logs for a specific ant
colony run alice "task"   # send a one-off command to an ant
```

## Integrations

| Integration | Status   | Purpose                                          |
|-------------|----------|--------------------------------------------------|
| GitHub      | Planned  | Read issues/PRs, create PRs, receive webhooks    |
| Discord     | Planned  | Human ↔ ant messaging and confirmations          |
| Slack       | Planned  | Alternative to Discord                           |
| Jira        | Planned  | Read tickets as ant backlog                      |
| Linear      | Planned  | Read issues as ant backlog                       |

## LLM Providers

| Provider    | Status  | Notes                                |
|-------------|---------|--------------------------------------|
| Claude Code | Planned | Each ant is a Claude Code subprocess |
| Gemini      | Planned |                                      |

## Roadmap

- [ ] Colony runner: ant lifecycle management (spawn, monitor, restart)
- [ ] Claude Code subprocess integration
- [ ] Discord integration: message send/receive, confirmation reactions
- [ ] GitHub integration: issue reading, PR creation, webhook triggers
- [ ] CLI: `init`, `validate`, `start`, `stop`, `status`, `logs`, `run`
- [ ] Docker / docker-compose deployment support
- [ ] Backlog management: auto-discover tasks from GitHub Issues
- [ ] Slack integration
- [ ] Jira integration
- [ ] Linear integration
- [ ] Gemini LLM provider
