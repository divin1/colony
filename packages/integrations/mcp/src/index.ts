import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools.js";
import { ColonyClient, formatStatus } from "./handlers.js";

export { TOOLS } from "./tools.js";
export { ColonyClient, formatStatus } from "./handlers.js";

export async function startMcpServer(apiUrl: string): Promise<void> {
  const client = new ColonyClient(apiUrl);

  const server = new Server(
    { name: "colony", version: "0.4.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "colony_status": {
          const status = await client.getStatus();
          return { content: [{ type: "text" as const, text: formatStatus(status) }] };
        }

        case "colony_prompt": {
          const ant = String(args.ant);
          const prompt = String(args.prompt);
          await client.prompt(ant, prompt);
          return {
            content: [{ type: "text" as const, text: `Work instruction queued for "${ant}".` }],
          };
        }

        case "colony_pause": {
          const ant = String(args.ant);
          await client.pause(ant);
          return {
            content: [{ type: "text" as const, text: `"${ant}" will pause after its current session.` }],
          };
        }

        case "colony_resume": {
          const ant = String(args.ant);
          await client.resume(ant);
          return {
            content: [{ type: "text" as const, text: `"${ant}" resumed.` }],
          };
        }

        case "colony_clear": {
          const ant = String(args.ant);
          const { cleared } = await client.clear(ant);
          return {
            content: [{ type: "text" as const, text: `Cleared ${cleared} queued item(s) for "${ant}".` }],
          };
        }

        case "colony_output": {
          const ant = String(args.ant);
          const maxLines = Math.min(typeof args.lines === "number" ? args.lines : 50, 150);
          const status = await client.getStatus();
          const antStatus = status.ants.find((a) => a.name === ant);
          if (!antStatus) {
            const available = status.ants.map((a) => `"${a.name}"`).join(", ") || "none";
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Ant "${ant}" not found. Available: ${available}` }],
            };
          }
          const output = antStatus.recentOutput.slice(-maxLines);
          const text = output.length > 0 ? output.join("\n") : `(no output from "${ant}" yet)`;
          return { content: [{ type: "text" as const, text }] };
        }

        default:
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
