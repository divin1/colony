import { Command } from "@commander-js/extra-typings";
import { startMcpServer } from "@colony/mcp";

export const mcpCommand = new Command("mcp")
  .description(
    "Start the Colony MCP server for Claude Desktop / Claude Code integration. " +
    "Communicates via stdin/stdout; configure in claude_desktop_config.json or .claude/settings.json."
  )
  .option(
    "--url <url>",
    "Colony HTTP API base URL (monitoring.port must be configured in colony.yaml)",
    "http://localhost:8080"
  )
  .action(async (opts) => {
    await startMcpServer(opts.url);
  });
