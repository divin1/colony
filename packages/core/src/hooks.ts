import type {
  HookCallback,
  HookJSONOutput,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

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

export function isDangerous(input: PreToolUseHookInput): boolean {
  if (ALWAYS_DANGEROUS.has(input.tool_name)) return true;

  if (input.tool_name === "Bash") {
    const raw = input.tool_input;
    if (typeof raw !== "object" || raw === null) return false;
    const command = (raw as Record<string, unknown>).command;
    if (typeof command !== "string") return false;
    return DANGEROUS_BASH_PATTERNS.some((p) => p.test(command));
  }

  return false;
}

// --- Minimal channel interface ---
// Hooks only depend on what they actually use — not the full MessagingIntegration.
// DiscordIntegration satisfies this structurally.

export interface ConfirmationChannel {
  send(channelId: string, content: string): Promise<{ id: string }>;
  addReaction(messageId: string, emoji: string): Promise<void>;
  waitForReaction(
    messageId: string,
    options: { timeout: number; allowedEmojis: string[] }
  ): Promise<string | null>;
}

// --- Hook factories ---

/**
 * Creates a PreToolUse hook that pauses dangerous actions and waits for a
 * Discord ✅/❌ reaction before allowing the ant to proceed.
 * Timeout with no reaction is treated as denial.
 */
export function createConfirmationHook(
  channel: ConfirmationChannel,
  channelId: string,
  timeoutMs: number
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    // This hook is registered under PreToolUse, but guard defensively.
    if (input.hook_event_name !== "PreToolUse") return { decision: "approve" };

    const preInput = input as PreToolUseHookInput;
    if (!isDangerous(preInput)) return { decision: "approve" };

    const description = formatToolDescription(preInput.tool_name, preInput.tool_input);
    const timeoutSec = Math.round(timeoutMs / 1000);

    const sent = await channel.send(
      channelId,
      `⚙️ **[Confirmation required]**\n\`\`\`\n${description}\n\`\`\`\nReact ✅ to proceed or ❌ to skip (timeout: ${timeoutSec}s).`
    );

    await channel.addReaction(sent.id, "✅");
    await channel.addReaction(sent.id, "❌");

    const reaction = await channel.waitForReaction(sent.id, {
      timeout: timeoutMs,
      allowedEmojis: ["✅", "❌"],
    });

    if (reaction === "✅") return { decision: "approve" };

    const reason =
      reaction === null
        ? `Timed out after ${timeoutSec}s — denied by default.`
        : "Denied by human operator.";

    return { decision: "block", reason };
  };
}

/**
 * Creates a PostToolUse hook that sends a compact result summary to Discord.
 * Logging failures are swallowed so they never interrupt the ant's work loop.
 */
export function createLoggingHook(
  channel: ConfirmationChannel,
  channelId: string
): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUse") return {};

    const postInput = input as PostToolUseHookInput;
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
