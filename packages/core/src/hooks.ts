import type {
  HookCallback,
  HookJSONOutput,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { AntState } from "./state.js";

// --- Per-ant confirmation configuration ---

export interface AntConfirmationConfig {
  always_confirm_tools?: string[];
  dangerous_patterns?: string[];
}

// --- Dangerous tool detection ---

// Tools that always require human confirmation regardless of input.
const ALWAYS_DANGEROUS = new Set(["computer_use"]);

// Shell command patterns that indicate an irreversible or high-impact action.
const DANGEROUS_BASH_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/,
  /\brm\s+-[a-z]*r[a-z]*/,  // rm -r, rm -rf, rm -fr, etc.
  /\bsudo\b/,
  /\|\s*(ba)?sh\b/,          // curl … | bash, wget … | sh
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
];

/**
 * Core danger detection — operates on plain values so it can be reused by
 * both the Claude SDK hook (PreToolUseHookInput) and the Gemini agentic loop
 * (where tool names and inputs come from the Gemini API directly).
 *
 * Handles both "Bash" (Claude SDK tool name) and "bash" (Gemini tool name).
 */
export function isDangerousRaw(
  toolName: string,
  toolInput: unknown,
  config?: AntConfirmationConfig
): boolean {
  if (config?.always_confirm_tools?.includes(toolName)) return true;

  if (ALWAYS_DANGEROUS.has(toolName)) return true;

  if (toolName === "Bash" || toolName === "bash") {
    const raw = toolInput;
    if (typeof raw !== "object" || raw === null) return false;
    const command = (raw as Record<string, unknown>).command;
    if (typeof command !== "string") return false;

    if (DANGEROUS_BASH_PATTERNS.some((p) => p.test(command))) return true;

    if (config?.dangerous_patterns) {
      return config.dangerous_patterns.some((p) => new RegExp(p).test(command));
    }
  }

  return false;
}

export function isDangerous(
  input: PreToolUseHookInput,
  config?: AntConfirmationConfig
): boolean {
  return isDangerousRaw(input.tool_name, input.tool_input, config);
}

// --- Minimal channel interface ---
// Hooks only depend on what they actually use — not the full MessagingIntegration.
// DiscordIntegration satisfies this structurally.

export interface ConfirmationChannel {
  send(channelId: string, content: string): Promise<{ id: string }>;
  addReaction(messageId: string, emoji: string): Promise<void>;
  waitForReaction(
    messageId: string,
    options: { timeout: number; allowedEmojis: string[]; channelId?: string }
  ): Promise<string | null>;
}

// --- Shared confirmation UI ---

/**
 * Applies the autonomy policy for a dangerous action and returns whether it
 * was approved. This is shared between the Claude SDK hook and the Gemini
 * agentic loop.
 *
 *   "strict" — immediately denies without contacting Discord.
 *   "human"  — posts a Discord confirmation and waits for ✅/❌ reaction.
 */
export async function requestConfirmation(
  channel: ConfirmationChannel,
  channelId: string,
  timeoutMs: number,
  description: string,
  autonomy: "human" | "strict",
  state?: AntState,
  antName?: string,
): Promise<{ approved: boolean; reason?: string }> {
  if (autonomy === "strict") {
    return {
      approved: false,
      reason: `Auto-denied (autonomy: strict): ${description}`,
    };
  }

  // Check stored overrides before posting to Discord.
  if (state && antName) {
    for (const override of state.getConfirmationOverrides(antName)) {
      try {
        if (new RegExp(override.pattern).test(description)) {
          return {
            approved: override.decision === "approve",
            reason: `Auto-${override.decision}d by stored rule: ${override.pattern}`,
          };
        }
      } catch {
        // Ignore invalid regex patterns stored in overrides.
      }
    }
  }

  // human: forward to Discord and wait for a reaction.
  const timeoutSec = Math.round(timeoutMs / 1000);

  const sent = await channel.send(
    channelId,
    `⚙️ **Approval required**\n\`\`\`\n${description}\n\`\`\`\n✅ approve · ❌ deny · 🔁 always allow  _(timeout ${timeoutSec}s → denied)_`
  );

  await channel.addReaction(sent.id, "✅");
  await channel.addReaction(sent.id, "❌");
  await channel.addReaction(sent.id, "🔁");

  const reaction = await channel.waitForReaction(sent.id, {
    timeout: timeoutMs,
    allowedEmojis: ["✅", "❌", "🔁"],
    channelId,
  });

  if (reaction === "🔁") {
    // Store an always-allow override for this exact description, then approve.
    if (state && antName) {
      const escaped = description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      state.addConfirmationOverride(antName, escaped, "approve");
    }
    return { approved: true, reason: "Approved and saved as always-allow rule." };
  }

  if (reaction === "✅") return { approved: true };

  const reason =
    reaction === null
      ? `Timed out after ${timeoutSec}s — denied by default.`
      : "Denied by human operator.";

  return { approved: false, reason };
}

// --- Hook factories ---

/**
 * Creates a PreToolUse hook whose behaviour depends on the ant's autonomy setting:
 *
 *   "human"  — posts a Discord confirmation message and waits for ✅/❌ reaction.
 *              Timeout with no reaction is treated as denial (current default).
 *   "strict" — auto-denies any flagged action without contacting Discord.
 *
 * For autonomy "full", do not register this hook at all (see ant.ts).
 */
export function createConfirmationHook(
  channel: ConfirmationChannel,
  channelId: string,
  timeoutMs: number,
  antConfig?: AntConfirmationConfig,
  autonomy: "human" | "strict" = "human",
  state?: AntState,
  antName?: string,
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    // This hook is registered under PreToolUse, but guard defensively.
    if (input.hook_event_name !== "PreToolUse") return { decision: "approve" };

    const preInput = input as PreToolUseHookInput;
    if (!isDangerous(preInput, antConfig)) return { decision: "approve" };

    const description = formatToolDescription(preInput.tool_name, preInput.tool_input);
    const result = await requestConfirmation(channel, channelId, timeoutMs, description, autonomy, state, antName);

    if (result.approved) return { decision: "approve" };
    return { decision: "block", reason: result.reason };
  };
}

export type ToolLoggingMode = "off" | "impactful" | "all";

// Tools that only read state and have no side effects.
// Skipped in "impactful" mode to reduce Discord noise.
// Unknown tools (MCP, future SDK additions) are NOT in this set and are always logged.
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebSearch",
  "WebFetch",
  "TodoRead",
]);

/**
 * Creates a PostToolUse hook that sends a compact result summary to Discord.
 *
 * mode:
 *   "off"       — hook is a no-op; caller should skip registration entirely.
 *   "impactful" — skips known read-only tools (Read, Grep, Glob, …); logs everything else.
 *   "all"       — logs every tool call (original behaviour; useful for debugging).
 *
 * Logging failures are swallowed so they never interrupt the ant's work loop.
 */
export function createLoggingHook(
  channel: ConfirmationChannel,
  channelId: string,
  mode: ToolLoggingMode = "impactful"
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUse") return {};
    if (mode === "off") return {};

    const postInput = input as PostToolUseHookInput;

    if (mode === "impactful" && READ_ONLY_TOOLS.has(postInput.tool_name)) return {};

    const summary = formatToolSummary(
      postInput.tool_name,
      postInput.tool_input,
      postInput.tool_response
    );

    await channel.send(channelId, summary).catch(() => {
      // Don't let a Discord hiccup break the ant's work loop.
    });

    return {};
  };
}

// --- Formatting helpers ---

function formatToolDescription(toolName: string, toolInput: unknown): string {
  if (
    toolName === "Bash" &&
    typeof toolInput === "object" &&
    toolInput !== null
  ) {
    const command = (toolInput as Record<string, unknown>).command;
    if (typeof command === "string") return command;
  }
  try {
    return `${toolName}(${JSON.stringify(toolInput, null, 2)})`;
  } catch {
    return toolName;
  }
}

function formatToolSummary(
  toolName: string,
  toolInput: unknown,
  toolResponse: unknown
): string {
  let label: string;
  if (
    toolName === "Bash" &&
    typeof toolInput === "object" &&
    toolInput !== null
  ) {
    const command = (toolInput as Record<string, unknown>).command;
    label = typeof command === "string" ? `\`${command}\`` : `\`${toolName}\``;
  } else {
    label = `\`${toolName}\``;
  }

  const responseStr =
    typeof toolResponse === "string" && toolResponse.length > 300
      ? toolResponse.slice(0, 300) + "…"
      : typeof toolResponse === "string"
        ? toolResponse
        : "";

  return `🔧 ${label} completed${responseStr ? `\n${responseStr}` : ""}`;
}
