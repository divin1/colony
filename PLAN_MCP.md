# Colony — MCP Server Integration

_Complete as of 2026-05-15._

---

## What was built

`packages/integrations/mcp/` — new workspace package (`@colony/mcp`). A standalone MCP server that talks to Colony's existing HTTP API (`monitoring.port` must be configured). Claude Desktop or Claude Code spawns it as a subprocess via `colony mcp`.

### Architecture

**HTTP client (Option A from the original plan).** The MCP server is a separate process that calls `/api/*` — the same endpoints the web dashboard uses. No shared memory, no coupling to `ColonyState`. Works with local and Docker deployments alike.

```
Claude Desktop / Claude Code
        ↓ stdin/stdout (MCP protocol)
   colony mcp --url http://localhost:8080
        ↓ HTTP
   Colony runner  (monitoring.port: 8080)
```

### Files

| File | Purpose |
|---|---|
| `src/tools.ts` | Six `Tool` definitions with JSON Schema `inputSchema` |
| `src/handlers.ts` | `ColonyClient` class (injectable `fetch` for testing); `formatStatus()` |
| `src/index.ts` | `startMcpServer(apiUrl)` — creates `Server`, registers handlers, connects `StdioServerTransport` |
| `src/index.test.ts` | 15 tests: tool structure, each client method's URL/method/body, error propagation, formatting |

### Tools

| Tool | Parameters | Action |
|---|---|---|
| `colony_status` | — | GET /api/status → formatted multi-line summary |
| `colony_prompt` | `ant`, `prompt` | POST /api/ants/:name/prompt |
| `colony_pause` | `ant` | POST /api/ants/:name/pause |
| `colony_resume` | `ant` | POST /api/ants/:name/resume |
| `colony_clear` | `ant` | POST /api/ants/:name/clear |
| `colony_output` | `ant`, `lines?` | GET /api/status → recentOutput slice |

### CLI command

```bash
colony mcp [--url <url>] [--key <key>]   # default URL: http://localhost:8080
                                          # --key also read from COLONY_API_KEY env var
```

### Configuration (Claude Desktop)

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

Full setup docs: `docs/mcp.md`

---

## What was not built (out of scope)

- **In-process option (Option B)** — HTTP client is sufficient; in-process would couple the MCP server to `ColonyState` lifecycle and complicate Docker deployments.
- **Work item tools** (`colony_work_list`, `colony_work_cancel`) — MCP access to work history. Could be added; the API endpoints exist (`GET /api/work`, `DELETE /api/work/:id`).
- **Config tools** (`colony_config_get`, `colony_ant_update`) — MCP access to the config CRUD API. Could be useful for LLM-driven colony management. Straightforward to add on top of the existing `/api/config/*` endpoints.

---

## Future extension points

Any new HTTP API endpoint is trivially wrappable as an MCP tool — add a tool definition to `tools.ts`, a client method to `handlers.ts`, and a case to the switch in `index.ts`.

---

_See also: [PLAN.md](./PLAN.md) for the core roadmap, [PLAN_KANBAN.md](./PLAN_KANBAN.md) for the dashboard, [docs/mcp.md](./docs/mcp.md) for setup instructions._
