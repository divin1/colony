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
```

---

## `ants/<name>.yaml`

One file per ant. All `.yaml` and `.yml` files inside the `ants/` directory are loaded automatically.

### Required fields

```yaml
name: string          # Unique identifier within the colony. Used in Discord messages and logs.
description: string   # One-line summary. Included in the agent's opening prompt.
instructions: |       # The agent's primary directive. Appended to Claude's system prompt.
  ...
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
  - type: discord_command     # Wake when you send a message in the ant's Discord channel.
```

An ant can have any number of triggers. Triggers and `schedule` can coexist — the ant runs whenever any of them fires.

Ants with no triggers and no schedule run continuously, sleeping for `poll_interval` (or immediately if not set) between sessions.

### Confirmation

Control which actions require human approval for this ant. These rules are additive — they extend the global defaults, not replace them.

```yaml
confirmation:
  always_confirm_tools:        # Tool names that always require approval.
    - Write
    - Edit
  dangerous_patterns:          # Additional bash regex patterns that require approval.
    - "\\bdeploy\\.sh\\b"
    - "\\bkubectl\\s+delete\\b"
```

**Global rules that always apply** (regardless of ant config):

| Pattern | Matched commands |
|---|---|
| `git push` | `git push origin main`, `git push --force` |
| `rm -r*` | `rm -rf /tmp/build`, `rm -fr dir/` |
| `sudo` | `sudo apt install curl` |
| pipe to shell | `curl … \| bash`, `wget … \| sh` |
| `DROP TABLE` / `TRUNCATE TABLE` | SQL destructive statements |
| `computer_use` tool | any use of the computer_use tool |

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

confirmation:
  always_confirm_tools: []          # no extra tool confirmations
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
