import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "colony_status",
    description:
      "List all configured ants and their current runtime state (running, paused, crashed, backoff), queue sizes, and session statistics. Use this to understand what Colony is doing before issuing commands.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "colony_prompt",
    description:
      "Push a work instruction to an ant's queue. The ant will pick it up at the start of its next session. If the ant is paused it will automatically resume.",
    inputSchema: {
      type: "object",
      properties: {
        ant: { type: "string", description: "Name of the ant to assign work to." },
        prompt: { type: "string", description: "The work instruction to queue." },
      },
      required: ["ant", "prompt"],
    },
  },
  {
    name: "colony_pause",
    description:
      "Signal an ant to pause after its current session finishes. The ant will not start new sessions until resumed.",
    inputSchema: {
      type: "object",
      properties: {
        ant: { type: "string", description: "Name of the ant to pause." },
      },
      required: ["ant"],
    },
  },
  {
    name: "colony_resume",
    description: "Resume a paused ant, allowing it to pick up queued work and start new sessions.",
    inputSchema: {
      type: "object",
      properties: {
        ant: { type: "string", description: "Name of the ant to resume." },
      },
      required: ["ant"],
    },
  },
  {
    name: "colony_clear",
    description:
      "Discard all queued (not-yet-started) work items for an ant. Items currently being processed are unaffected.",
    inputSchema: {
      type: "object",
      properties: {
        ant: { type: "string", description: "Name of the ant whose queue to clear." },
      },
      required: ["ant"],
    },
  },
  {
    name: "colony_output",
    description:
      "Return the recent output buffer from an ant — the last N lines of text produced during its sessions. Useful for checking what an ant is working on or has completed.",
    inputSchema: {
      type: "object",
      properties: {
        ant: { type: "string", description: "Name of the ant." },
        lines: {
          type: "number",
          description: "Maximum number of lines to return (default: 50, max: 150).",
        },
      },
      required: ["ant"],
    },
  },
];
