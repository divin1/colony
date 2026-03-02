# Colony Setup Guide

This guide walks you through setting up prerequisites, configuring your first ant, and running it — locally or with Docker.

---

## Prerequisites

| Thing you need | Where to get it |
|---|---|
| [Bun](https://bun.sh) ≥ 1.0 | `curl -fsSL https://bun.sh/install \| bash` |
| An Anthropic API key | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| A Discord server you own or admin | Any server where you can create channels and invite bots |
| A GitHub Personal Access Token | Only needed if using GitHub triggers or issue reading |

---

## 1. Anthropic API Key

Colony runs Claude via the Agent SDK. The SDK reads `ANTHROPIC_API_KEY` from the environment automatically — you don't declare it in `colony.yaml`.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Add it to your `.env` file so it persists (see step 4).

---

## 2. Discord Bot Setup

This is the most involved step. Discord requires bots to be registered as applications with specific permissions before they can connect.

### 2a. Create the application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g. `colony`) → **Create**

### 2b. Create the bot

1. In the left sidebar: **Bot**
2. Click **Add Bot** → **Yes, do it!**
3. Under **Token**: click **Reset Token**, confirm, and copy the token — you'll need it later as `DISCORD_TOKEN`

### 2c. Enable privileged intents

Still on the **Bot** page, scroll down to **Privileged Gateway Intents** and enable all three:

- ✅ **Presence Intent**
- ✅ **Server Members Intent**
- ✅ **Message Content Intent** ← **critical** — without this, message content arrives empty and Discord command triggers won't work

Click **Save Changes**.

### 2d. Invite the bot to your server

1. In the left sidebar: **OAuth2** → **URL Generator**
2. Under **Scopes**, select: `bot`
3. Under **Bot Permissions**, select:
   - `Read Messages / View Channels`
   - `Send Messages`
   - `Add Reactions`
   - `Read Message History`
4. Copy the generated URL, open it in your browser, and invite the bot to your server

### 2e. Create a channel for your ant

In your Discord server, create a text channel for your ant to post updates into (e.g. `#worker-logs`). The bot needs access to it — if your server uses category permissions, make sure the bot role can see and write to the channel.

---

## 3. GitHub Personal Access Token (optional)

Only needed if your ant reads GitHub issues or your colony config includes a `github:` integration.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Select scopes: `repo` (for private repos) or `public_repo` (for public only)
3. Copy the token — you'll need it as `GITHUB_TOKEN`

---

## 4. Create your colony

### Scaffold a new colony directory

```bash
bun packages/cli/src/index.ts init ~/my-colony
cd ~/my-colony
cp .env.example .env
```

### Fill in your `.env`

```bash
# ~/my-colony/.env
ANTHROPIC_API_KEY=sk-ant-...
DISCORD_TOKEN=your-bot-token-here
GITHUB_TOKEN=ghp_...          # only if using GitHub integration
```

### Configure `colony.yaml`

Edit `colony.yaml` to match your Discord server name:

```yaml
name: my-colony

integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: My Server Name      # exact name of your Discord server
  github:                      # remove this block if not using GitHub
    token: ${GITHUB_TOKEN}

defaults:
  confirmation_timeout: 30m
```

The `guild` value must match the server name exactly as it appears in Discord (case-sensitive).

### Configure your ant

Edit `ants/worker.yaml`. The key fields:

```yaml
name: worker
description: A short description shown in Discord status messages

instructions: |
  This is the system prompt injected into every Claude session.
  Be specific about what the ant should do, what tools it may use,
  and any constraints (e.g. "never push to main directly").

integrations:
  discord:
    channel: worker-logs       # the channel you created in step 2e

schedule:
  cron: "0 9 * * 1-5"         # run at 9am weekdays; remove for event-only ants

triggers:
  - type: discord_command      # wake up when someone sends a message in the channel
```

Remove the `schedule:` block if you only want the ant to respond to commands. Remove `triggers:` if you only want scheduled runs. If neither is set, the ant runs once immediately then restarts in a loop.

### Validate your config

```bash
ANTHROPIC_API_KEY=x DISCORD_TOKEN=x bun packages/cli/src/index.ts validate .
```

You should see:

```
✓ Colony "my-colony" — config is valid.
  1 ant(s) configured:
  • worker → #worker-logs: A general-purpose autonomous worker ant
```

---

## 5. Run locally

```bash
cd ~/my-colony
# Load env and start the colony runner
set -a && source .env && set +a
bun /path/to/colony/packages/cli/src/index.ts run .
```

Or if you've cloned colony into `~/colony`:

```bash
cd ~/my-colony
set -a && source .env && set +a
bun ~/colony/packages/cli/src/index.ts run .
```

### What you'll see

In your terminal:
```
Colony "my-colony" online — 1 ant(s) starting.
```

In your `#worker-logs` Discord channel:
```
🐜 Ant worker is starting.
🔧 `ls` completed
...
✅ worker completed its work session.
```

Every tool use (file reads, bash commands, etc.) is posted to the channel. This is intentional for the MVP — you can see exactly what the ant is doing in real time.

### Sending a command

If your ant has a `discord_command` trigger, send a message in its channel:

```
review the open issues and summarize what needs doing
```

The ant will wake up, run a Claude session with that message as its prompt, and post results back.

### Confirmation requests

When the ant is about to do something dangerous (push to git, `rm -rf`, run `sudo`), it pauses and posts:

```
⚙️ [Confirmation required]
git push origin main
React ✅ to proceed or ❌ to skip (timeout: 1800s).
```

React ✅ to approve or ❌ to deny. No reaction within the timeout is treated as deny.

---

## 6. Run as a colony with Docker

For 24/7 deployment, use the provided Dockerfile.

### Build the image

From the root of the colony repository:

```bash
docker build -f docker/Dockerfile -t colony .
```

### Run a colony

Mount your colony config directory and pass the `.env` file:

```bash
docker run \
  --env-file ~/my-colony/.env \
  -v ~/my-colony:/colony \
  -w /colony \
  --restart unless-stopped \
  colony run .
```

### Or use docker-compose

Copy `docker/docker-compose.yml` into your colony directory and adjust the path:

```bash
cp /path/to/colony/docker/docker-compose.yml ~/my-colony/
cd ~/my-colony
docker compose up -d
docker compose logs -f
```

The service restarts automatically if the process exits, and mounts your colony directory so you can edit config files without rebuilding the image.

---

## Troubleshooting

**Bot is online but messages arrive with empty content**
→ You haven't enabled the **Message Content** privileged intent in the Discord Developer Portal (step 2c). Discord strips message content from bots that haven't requested it.

**`Guild not found: My Server Name`**
→ The `guild` value in `colony.yaml` must match your server name exactly (case-sensitive). Check Server Settings → Overview for the exact name.

**`Channel not found in guild: worker-logs`**
→ The channel name in `ants/worker.yaml` must match the Discord channel exactly. Also check the bot has permission to see and send messages in that channel.

**`Missing environment variable: DISCORD_TOKEN`**
→ Your `.env` file isn't being loaded, or the variable name doesn't match. The config expects the exact names referenced in `colony.yaml` (e.g. `${DISCORD_TOKEN}`).

**Ant crashes immediately with an SDK error**
→ Check that `ANTHROPIC_API_KEY` is set and valid. The Agent SDK will throw on an invalid or missing key.

**Ant runs but does nothing useful**
→ The `instructions` field is the ant's entire system prompt. Be specific: tell it what repo to work on, what tasks to look for, and what tools to use. Vague instructions produce vague behaviour.

---

## Next steps once you're running

- Add more ants: copy `ants/worker.yaml`, give it a different name and Discord channel
- Tune `confirmation_timeout` in `colony.yaml` if 30 minutes is too long or too short
- Look at `config/examples/ants/` for more complete ant configs (dep updater, code reviewer, issue triager)
- Add a `github_issue` trigger so the ant wakes up automatically when labelled issues appear
