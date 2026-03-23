# Configuration Reference

A colony is a directory containing two types of config files:

```
my-colony/
  colony.yaml       ← one, required
  ants/
    worker.yaml     ← one per ant, at least one required to run
    reviewer.yaml
  .env              ← secrets (never in YAML)
```

All YAML values that contain tokens or credentials must use `${ENV_VAR}` syntax. The runner substitutes these from the process environment at startup and fails immediately if any referenced variable is not set.

---

## `colony.yaml`

Top-level config shared across all ants.

```yaml
name: string                     # Required. Colony identifier used in logs.

integrations:
  discord:
    token: ${DISCORD_TOKEN}      # Required for colony run. Bot token from Discord developer portal.
    guild: string                # Required. Discord server name or numeric ID.
  github:
    token: ${GITHUB_TOKEN}       # Required only if any ant uses GitHub triggers or repos.

defaults:
  confirmation_timeout: string   # Duration: 30s | 5m | 1h. Default: "30m".
                                 # How long to wait for a Discord reaction before denying an action.
  poll_interval: string          # Duration: 30s | 5m | 1h. No default (run immediately).
                                 # Sleep between runs for ants with no triggers or schedule.
  git:
    user_name: string            # Project owner's git name. Injected into every ant's instructions.
    user_email: string           # Project owner's git email.
```

### Minimal example

```yaml
name: my-colony
integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: My Server
```

### Full example

```yaml
name: acme-platform
integrations:
  discord:
    token: ${DISCORD_TOKEN}
    guild: ACME Engineering
  github:
    token: ${GITHUB_TOKEN}
defaults:
  confirmation_timeout: 30m
  poll_interval: 10m
  git:
    user_name: Jane Smith
    user_email: jane@acme.example.com
```

---

## Colony-wide conventions

Two conventions are automatically injected into every ant's system prompt, regardless of which project management tool (if any) is configured.

### PLAN.md tracking

Every ant maintains a `PLAN.md` file at the root of its working directory. The ant is instructed to:

- Read `PLAN.md` at the start of each session to resume from the previous state.
- Create it on the first session if it does not exist.
- Update it throughout the session as tasks are completed or new ones are discovered.
- Commit `PLAN.md` changes after each update: `git add PLAN.md && git commit -m "chore: update PLAN.md"`

`PLAN.md` uses this structure:

```markdown
## Current Goal
[What the ant is working on right now]

## Active Tasks
- [ ] Task 1
- [ ] Task 2

## Completed
- [x] Previously completed task
```

This ensures progress is always recoverable across restarts without requiring an external project management integration.

### Git identity

Ants are instructed never to commit as a bot user (e.g. `claude`, `github-actions[bot]`). If `defaults.git` is set in `colony.yaml`, the ant runs `git config user.name / user.email` at the start of each session. If not set, the ant uses whatever git identity is already configured in the repository.

```yaml
# colony.yaml
defaults:
  git:
    user_name: Jane Smith          # project owner's name
    user_email: jane@example.com   # project owner's email
```

---

## `ants/<name>.yaml`

One file per ant. All `.yaml` and `.yml` files inside the `ants/` directory are loaded automatically.

### Required fields

```yaml
name: string          # Unique identifier within the colony. Used in Discord messages and logs.
description: string   # One-line summary. Included in the agent's opening prompt.
instructions: |       # The agent's primary directive. Appended to the agent's system prompt.
  ...
```

### Engine

```yaml
engine: claude   # "claude" (default) or "gemini"
```

Controls which agent engine drives this ant.

| Value | Engine | Requirement |
|---|---|---|
| `claude` | Claude Agent SDK (Claude Code) | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gen AI SDK (`@google/genai`) | `GEMINI_API_KEY` |

Both engines run in-process with full tool interception — `autonomy` and `confirmation` behave identically for both.

### Gemini options

Only used when `engine: gemini`.

```yaml
gemini:
  model: gemini-2.5-pro   # Default. Any Gemini model name.
  max_turns: 100          # Default. Maximum agentic loop iterations before stopping.
```

### Integrations

```yaml
integrations:
  discord:
    channel: string   # Required. Discord channel name where the ant posts and listens.
  github:
    repos:            # Repos the ant may access. Format: owner/repo.
      - my-org/my-repo
      - my-org/shared-libs
```

Every ant must have `integrations.discord.channel` — the colony runner uses it to route messages and confirmations.

### Schedule

```yaml
schedule:
  cron: "0 9 * * 1-5"   # Standard 5-field cron. Omit this block for event-only ants.
```

The ant wakes on each cron tick and runs one work session. It does not run continuously between ticks.

### Triggers

```yaml
triggers:
  - type: github_issue        # Wake when a new issue is opened in any of the ant's repos.
    labels: [ant-ready, bug]  # Optional. Only trigger if the issue has ALL of these labels.
                              # Omit labels to trigger on any new issue.
  - type: discord_command     # Make the ant event-only: only run when a human messages it.
```

An ant can have any number of triggers. Triggers and `schedule` can coexist — the ant runs whenever any of them fires.

Ants with no triggers and no schedule run continuously, sleeping for `poll_interval` (or immediately if not set) between sessions.

> **Human commands always work.** Regardless of trigger configuration, every ant listens to its Discord channel for human messages. The `discord_command` trigger only controls whether the ant runs *autonomously* between messages — it does not affect the ability to send work instructions or pause/resume the ant. See [Communicating with ants](#communicating-with-ants).

### Communicating with ants

Every ant listens to its Discord channel at all times. You can write there to control or direct the ant without any configuration changes.

**Slash commands** are intercepted by the colony runner and answered immediately — no LLM round-trip, no tokens consumed:

| Command | Effect |
|---|---|
| `/help` | List available commands |
| `/status` | Current state (running / paused) and queue depth |
| `/stats` or `/usage` | Uptime and session statistics |
| `/pause` or `/stop` | Pause after the current session |
| `/resume` or `/start` | Resume a paused ant |
| `/clear` | Discard all queued work items |

Unknown slash commands (`/foo`) are rejected with a hint to run `/help` instead of being forwarded to the ant.

**Work instructions** — any other message (not starting with `/`) is forwarded to the ant verbatim as a prompt for its next session. If the ant is currently paused, it auto-resumes to handle the message.

```
# In #worker-logs:
you:    Refactor the auth module to use the new token format
worker: ▶️ **worker** resuming.
worker: Starting on the auth module refactor…
```

The ant's text output (what it says as it works) and confirmation requests all appear in the same channel.

### Autonomy

Controls what Colony does when a dangerous action is detected.

```yaml
autonomy: human    # default — forward to Discord, wait for ✅/❌ reaction
autonomy: full     # auto-approve everything, Discord is never contacted
autonomy: strict   # auto-deny everything flagged, Discord is never contacted
```

| Value | Behaviour |
|---|---|
| `human` | Dangerous actions pause and post a Discord confirmation request. The ant resumes after ✅, or is blocked after ❌ or timeout. This is the default. |
| `full` | The confirmation hook is not registered at all. Every action proceeds immediately. Use for read-only ants or ants operating in safe sandboxed environments. |
| `strict` | Dangerous actions are automatically denied without any Discord message. The ant receives a block response and can react accordingly (e.g. explain why it stopped). |

All engines support full `autonomy` enforcement — tool calls are intercepted in-process for both `claude` and `gemini` ants.

### Confirmation

Controls *which* actions are considered dangerous. When an action matches, Colony applies the `autonomy` policy above. This block is orthogonal to `autonomy` — it defines the detection rules, not what happens when they fire.

```yaml
confirmation:
  always_confirm_tools:        # Tool names that are always flagged.
    - Write
    - Edit
  dangerous_patterns:          # Additional bash regex patterns that are flagged.
    - "\\bdeploy\\.sh\\b"
    - "\\bkubectl\\s+delete\\b"
```

**Built-in rules that always apply** (regardless of ant config):

| Pattern | Matched commands |
|---|---|
| `git push` | `git push origin main`, `git push --force` |
| `rm -r*` | `rm -rf /tmp/build`, `rm -fr dir/` |
| `sudo` | `sudo apt install curl` |
| pipe to shell | `curl … \| bash`, `wget … \| sh` |
| `DROP TABLE` / `TRUNCATE TABLE` | SQL destructive statements |
| `computer_use` tool | any use of the computer_use tool |

`confirmation` has no effect when `autonomy: full` (nothing is ever flagged).

### Logging

Controls which tool-call results are forwarded to Discord after each tool use.

```yaml
logging:
  tool_calls: impactful   # "off" | "impactful" (default) | "all"
```

| Value | Behaviour |
|---|---|
| `impactful` | Log everything except known read-only tools (`Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoRead`). Unknown and MCP tools are always logged. **This is the default.** |
| `off` | No PostToolUse logging. The Discord channel receives only the ant's text output and confirmation requests. |
| `all` | Log every tool call — original behaviour. Useful for debugging a misbehaving ant. |

The `impactful` default keeps the Discord channel focused on what the ant **did** (wrote files, ran commands, made commits) while silencing what it **looked at** (reading files, searching code).

### LM text output routing

Controls where the ant's LLM text (narration, reasoning, responses) is sent.

```yaml
logging:
  lm_output: discord   # "discord" (default) | "console" | "both"
```

| Value | Behaviour |
|---|---|
| `discord` | LLM text is posted to Discord as the ant produces it. **Default.** |
| `console` | LLM text is printed to the terminal only. Discord receives no narration. |
| `both` | LLM text goes to both the terminal and Discord. |

**Gemini ants only:** when `lm_output: "console"` is set, a Gemini ant can still post to Discord explicitly via the `notify_discord` tool. This lets instructions dictate exactly which milestone messages reach Discord (task picked, PR opened, blocked, etc.) while keeping all narration off the channel.

> **Claude ants — known limitation:** the Claude Agent SDK does not support injecting custom tools into the `claude_code` preset, so there is no `notify_discord` equivalent for Claude ants. With `lm_output: "console"`, a Claude ant has no way to post to Discord at all. With `lm_output: "discord"` (default), all LLM text reaches Discord. A unified solution is planned — see PLAN.md.

### State persistence

By default, state (e.g. which GitHub issues have already been processed) lives in memory and resets when the process restarts. To survive restarts use the `sqlite` backend:

```yaml
state:
  backend: sqlite               # "memory" (default) or "sqlite"
  path: ./colony-state.db       # Writable path for the SQLite file. Default: ./colony-state.db
```

With `sqlite`, the first run creates the database; subsequent runs reuse it. The file lives in the colony directory and is preserved across container restarts when the directory is volume-mounted.

### Poll interval

For ants with no triggers and no schedule, controls how long to sleep between work sessions:

```yaml
poll_interval: 5m   # Overrides colony-level defaults.poll_interval for this ant.
```

Duration format: `30s`, `5m`, `1h`. Ants with at least one trigger or a cron schedule ignore this setting.

---

## Complete ant example — Gemini-powered researcher

An ant that uses Gemini instead of Claude:

```yaml
name: researcher
description: Answers research questions posted in Discord using Gemini

engine: gemini
gemini:
  model: gemini-2.5-pro   # optional; this is the default
  max_turns: 100          # optional; maximum loop iterations

instructions: |
  You are a research assistant. When given a question, search for current information,
  synthesise the key findings, and reply with a concise, well-sourced summary.

integrations:
  discord:
    channel: research

triggers:
  - type: discord_command   # wake when someone posts a question in #research
```

Gemini ants have full autonomy enforcement — dangerous tool calls are intercepted in-process, exactly like Claude ants. Set `autonomy: human` to forward dangerous actions to Discord for approval, `autonomy: strict` to auto-deny them, or `autonomy: full` to skip all checks.

---

## Complete ant example — issue triager

```yaml
name: issue-triager
description: Triages new GitHub issues — labels them, asks for missing steps, closes duplicates

instructions: |
  You are a triage bot for the acme/platform GitHub repository.

  Work through every open issue that has the label "needs-triage":
  1. Read the issue body carefully.
  2. Apply one label based on the content: bug, enhancement, question, documentation, duplicate
     Use: gh issue edit <number> --add-label <label>
  3. If a bug report has no reproduction steps, ask for them:
     gh issue comment <number> -b "Could you add a minimal reproduction? ..."
  4. If the issue is a duplicate, find the original, link it, then close:
     gh issue close <number> --comment "Duplicate of #<original>"
  5. Remove the "needs-triage" label when done:
     gh issue edit <number> --remove-label needs-triage

  Be polite and welcoming — first-time contributors should feel encouraged, not dismissed.

integrations:
  github:
    repos:
      - acme/platform
  discord:
    channel: issue-triage

triggers:
  - type: github_issue
    labels: [needs-triage]

schedule:
  cron: "0 9 * * 1-5"    # also run at 9 am on weekdays to catch overnight issues

state:
  backend: sqlite          # remember which issues were already triaged across restarts
  path: ./triage-state.db
```

## Complete ant example — dependency updater

```yaml
name: dep-updater
description: Checks for outdated npm dependencies nightly and opens a PR with the updates

instructions: |
  You are a dependency maintenance bot for the acme/platform repository.

  Each time you run:
  1. Clone or update the repository in a temporary directory.
  2. Run `bun outdated` to find packages with newer versions.
  3. For each outdated package, upgrade it: bun add <package>@latest
  4. Run the test suite: bun test. If tests fail, revert that package and move on.
  5. If any packages were successfully updated, create a new branch
     deps/auto-update-YYYY-MM-DD and commit: "chore(deps): update N packages".
  6. Open a pull request: gh pr create --title "chore(deps): weekly dependency update"
  7. Post a summary to Discord with the list of updated packages and a link to the PR.

  Do not upgrade across major versions without explicit approval.

integrations:
  github:
    repos:
      - acme/platform
  discord:
    channel: dependency-updates

schedule:
  cron: "0 2 * * 1"    # every Monday at 2 am

autonomy: human        # forward git push and other dangerous actions to Discord for approval

confirmation:
  dangerous_patterns:
    - "\\bgit\\s+push\\b"          # redundant with global rule, shown for illustration
```

## Complete ant example — continuous worker (no triggers)

An ant with no triggers or schedule runs perpetually, sleeping between sessions:

```yaml
name: monitor
description: Watches for failed CI runs and posts a summary to Discord

instructions: |
  You are a CI monitor for the acme/platform repository.

  Check for any workflow runs that completed with status "failure" in the last hour:
    gh run list --status failure --created ">$(date -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)"

  For each failed run:
  - Post the run URL and the failing job names to your Discord channel.
  - Do not post about the same run twice.

  If there are no failures, post nothing.

integrations:
  github:
    repos:
      - acme/platform
  discord:
    channel: ci-alerts

poll_interval: 10m    # check every 10 minutes

state:
  backend: sqlite      # track which failed runs were already reported
  path: ./monitor-state.db
```

---

## Duration format

All duration strings (`confirmation_timeout`, `poll_interval`) use the format:

| Suffix | Unit |
|---|---|
| `s` | seconds |
| `m` | minutes |
| `h` | hours |

Examples: `30s`, `5m`, `1h`, `90s`. Decimals and combinations (e.g. `1h30m`) are not supported.

---

## Environment variable interpolation

Any YAML string value may contain `${VAR_NAME}` placeholders. The runner replaces them with the corresponding environment variable before validation:

```yaml
integrations:
  discord:
    token: ${DISCORD_TOKEN}   # replaced with process.env.DISCORD_TOKEN
```

If a referenced variable is not set, `colony run` and `colony validate` both exit immediately with:

```
Validation failed: Invalid colony.yaml:
  integrations.discord.token: Missing environment variable: DISCORD_TOKEN
```

This fail-fast behaviour prevents a colony from starting with a missing credential.
