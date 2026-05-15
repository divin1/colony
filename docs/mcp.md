# Colony MCP Server

Colony exposes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server so Claude Desktop, Claude Code, or any MCP-compatible host can manage your colony directly — no terminal access required.

---

## Prerequisites

Your colony runner must be active with `monitoring.port` set in `colony.yaml`:

```yaml
monitoring:
  port: 8080
```

The MCP server communicates with Colony over HTTP (`/api/*`). If Colony is not running or `monitoring.port` is not configured, tool calls will return an error.

---

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "colony": {
      "command": "colony",
      "args": ["mcp", "--url", "http://localhost:8080"]
    }
  }
}
```

Restart Claude Desktop. You should see Colony tools available in the tool picker.

---

## Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "colony": {
      "command": "colony",
      "args": ["mcp", "--url", "http://localhost:8080"]
    }
  }
}
```

Or run once to configure globally:

```bash
colony mcp --url http://localhost:8080
```

---

## Available tools

### `colony_status`
List all ants and their current state.

```
No parameters.
```

Example output:
```
Colony: my-colony (2 ants)

worker
  state:     running
  engine:    claude-cli
  queue:     0
  completed: 12  failed: 1
  uptime:    3h

reviewer
  state:     paused
  engine:    claude-cli
  queue:     2
  completed: 8  failed: 0
  uptime:    3h
```

---

### `colony_prompt`
Push a work instruction to an ant's queue.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ant` | string | yes | Name of the ant |
| `prompt` | string | yes | Work instruction to queue |

```
"Fix the failing tests in packages/core and open a PR."
→ Work instruction queued for "worker".
```

---

### `colony_pause`
Signal an ant to pause after its current session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ant` | string | yes | Name of the ant to pause |

---

### `colony_resume`
Resume a paused ant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ant` | string | yes | Name of the ant to resume |

---

### `colony_clear`
Discard all queued (not yet started) work items for an ant.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ant` | string | yes | Name of the ant |

---

### `colony_output`
Return recent output from an ant's sessions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ant` | string | yes | Name of the ant |
| `lines` | number | no | Max lines to return (default: 50, max: 150) |

---

## Custom URL

If Colony runs on a different host or port, pass `--url`:

```json
{
  "mcpServers": {
    "colony": {
      "command": "colony",
      "args": ["mcp", "--url", "http://my-server:9000"]
    }
  }
}
```

---

## Troubleshooting

**"Colony runner is not reachable"** — The runner is not active, or `monitoring.port` is not set in `colony.yaml`. Start the runner with `colony run .` and verify the port is configured.

**"Ant not found"** — The ant name is case-sensitive and must match the `name:` field in the ant's YAML file, not the filename.

**Tools not appearing in Claude** — Restart Claude Desktop / Claude Code after editing the config file. Check that `colony` is on your `PATH` (`which colony`).
