# CLI Reference

The `colony` CLI is the primary tool for scaffolding, validating, and running colonies.

## Installation

### One-line install (macOS and Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
```

This downloads the correct pre-built binary for your OS and architecture to `~/.local/bin/colony`. No dependencies required — not even Bun.

**Options:**

```bash
# Install a specific version
COLONY_VERSION=v0.3.0 curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh

# Install to a custom directory
COLONY_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
```

After install, add `~/.local/bin` to your PATH if it isn't already:

```bash
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc   # or ~/.zshrc
source ~/.bashrc
```

### Manual download

Download a pre-built binary directly from [GitHub Releases](https://github.com/divin1/colony/releases/latest):

| Platform | Binary |
|---|---|
| Linux x64 | `colony-linux-x64` |
| Linux arm64 | `colony-linux-arm64` |
| macOS Apple Silicon | `colony-darwin-arm64` |
| macOS Intel | `colony-darwin-x64` |
| Windows x64 | `colony-windows-x64.exe` |

```bash
# Example: Linux x64
curl -fsSL https://github.com/divin1/colony/releases/latest/download/colony-linux-x64 \
  -o /usr/local/bin/colony
chmod +x /usr/local/bin/colony
```

SHA256 checksums are provided in `checksums.txt` on each release.

### Verify

```bash
colony --version
colony --help
```

---

## Commands

### `colony init [dir]`

Scaffolds a new colony directory with starter config files.

```bash
colony init              # creates ./my-colony
colony init ./acme-bots  # creates ./acme-bots
```

**What it creates:**

```
<dir>/
  colony.yaml        # top-level colony config with placeholder values
  ants/
    worker.yaml      # example ant config
  .env.example       # environment variable placeholders
```

**After running `init`:**

```bash
cd <dir>
cp .env.example .env   # then fill in DISCORD_TOKEN, ANTHROPIC_API_KEY or GEMINI_API_KEY, and optionally GITHUB_TOKEN
```

Edit `colony.yaml` to set your Discord guild name, then edit or replace `ants/worker.yaml` with your actual ant configuration.

---

### `colony validate [dir]`

Parses and validates all config files without starting anything. Resolves `${ENV_VAR}` references — missing variables are reported as errors.

```bash
colony validate .          # validates the current directory
colony validate ./my-colony
```

**Successful output:**

```
✓ Colony "my-colony" — config is valid.
  2 ant(s) configured:
  • worker → #worker-logs: Processes GitHub issues labelled ant-ready
  • reviewer → #pr-reviews: Reviews open pull requests
```

**Error output:**

```
Validation failed: Invalid colony.yaml:
  integrations.discord.guild: Required
```

Exit code is `0` on success, `1` on any error.

**Use this in CI** to catch config mistakes before they reach production:

```yaml
# .github/workflows/colony-validate.yml
- run: bunx colony validate .
```

---

### `colony run [dir]`

Connects to Discord and launches all configured ants. Runs until you press Ctrl+C or send SIGTERM.

```bash
colony run .           # run the colony in the current directory
colony run ./my-colony
```

**What happens on startup:**

1. Config is loaded and validated (same checks as `colony validate`). Exits with an error if config is invalid — it never starts with bad config.
2. Discord connects. If the token is wrong or the bot can't reach the guild, startup fails with a clear error.
3. For each ant: the runner resolves the ant's Discord channel ID, posts a startup message, and enters the ant's work loop.
4. Each ant runs in its own concurrent supervisor loop — a crash in one ant does not affect others.

**Graceful shutdown** (Ctrl+C or SIGTERM):

```
^C
Received SIGINT — disconnecting…
```

The runner disconnects from Discord before exiting. In-progress ant sessions are not interrupted cleanly (the SDK session is dropped), so prefer sending SIGTERM when the ant is idle.

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Shutdown via SIGINT/SIGTERM |
| `1` | Fatal error (bad config, Discord connection failed) |

---

## Environment variables

All three commands read environment variables for secret resolution. Set them in your shell or in a `.env` file (loaded automatically by Bun when present).

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For Claude ants (default) | Authenticates Claude Agent SDK calls |
| `GEMINI_API_KEY` | For Gemini ants | Authenticates Google Gen AI SDK calls |
| `DISCORD_TOKEN` | Yes (for `run`) | Discord bot token |
| `GITHUB_TOKEN` | When using GitHub | GitHub personal access token or app token |

Variables referenced in YAML as `${VAR_NAME}` must be set before running `validate` or `run`.

---

## Tips

**Run validate before every deploy.** It catches missing env vars, typos in channel names, and schema errors before they surface at runtime.

**Use `colony init` as a starting point only.** The generated `worker.yaml` is intentionally generic — replace it entirely with your actual ant configuration rather than editing around the example.

**Multiple colonies.** Each colony is an independent directory. You can run multiple colonies by starting separate `colony run` processes pointing at different directories, each with its own `.env`.
