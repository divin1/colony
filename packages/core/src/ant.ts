import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultError,
} from "@anthropic-ai/claude-agent-sdk";
import type { AntConfig } from "./config";
import {
  createConfirmationHook,
  createLoggingHook,
  type ConfirmationChannel,
} from "./hooks";
import { runAntWithGemini } from "./gemini";
import { runAntWithCursor } from "./cursor";

export interface AntRunOptions {
  config: AntConfig;
  /** Channel used for confirmation prompts and status messages. */
  channel: ConfirmationChannel;
  /** Pre-resolved Discord channel ID for this ant. */
  channelId: string;
  confirmationTimeoutMs: number;
  /** Working directory for the agent session. Defaults to process.cwd(). */
  cwd?: string;
  /** Colony-level conventions (PLAN.md tracking, git identity) appended to the system prompt. */
  commonInstructions?: string;
}

export async function runAnt(
  prompt: string,
  opts: AntRunOptions
): Promise<void> {
  if (opts.config.engine === "gemini") {
    return runAntWithGemini(prompt, {
      config: opts.config,
      channel: opts.channel,
      channelId: opts.channelId,
      cwd: opts.cwd,
      commonInstructions: opts.commonInstructions,
    });
  } else if (opts.config.engine === "cursor") {
    return runAntWithCursor(prompt, {
      config: opts.config,
      channel: opts.channel,
      channelId: opts.channelId,
      cwd: opts.cwd,
      commonInstructions: opts.commonInstructions,
    });
  }

  const autonomy = opts.config.autonomy;
  const loggingMode = opts.config.logging?.tool_calls ?? "impactful";

  // For full autonomy, skip the PreToolUse hook entirely — zero overhead,
  // no dangerous-action checks, Discord is never contacted for approvals.
  const preToolUseHooks =
    autonomy === "full"
      ? {}
      : {
          PreToolUse: [
            {
              hooks: [
                createConfirmationHook(
                  opts.channel,
                  opts.channelId,
                  opts.confirmationTimeoutMs,
                  opts.config.confirmation ?? undefined,
                  autonomy
                ),
              ],
            },
          ],
        };

  // For "off" logging, skip PostToolUse registration entirely.
  const postToolUseHooks =
    loggingMode === "off"
      ? {}
      : {
          PostToolUse: [
            {
              hooks: [
                createLoggingHook(opts.channel, opts.channelId, loggingMode),
              ],
            },
          ],
        };

  for await (const msg of query({
    prompt,
    options: {
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: [opts.config.instructions, opts.commonInstructions]
          .filter(Boolean)
          .join("\n\n"),
      },
      cwd: opts.cwd,
      persistSession: false,
      hooks: {
        ...preToolUseHooks,
        ...postToolUseHooks,
      },
    },
  })) {
    await handleMessage(msg, opts.channel, opts.channelId);
  }
}

async function handleMessage(
  msg: SDKMessage,
  channel: ConfirmationChannel,
  channelId: string
): Promise<void> {
  if (msg.type === "assistant" && !msg.error) {
    const text = extractText(msg);
    if (text) {
      for (const chunk of chunkText(text)) {
        await channel.send(channelId, chunk).catch(() => {});
      }
    }
  } else if (msg.type === "result" && msg.subtype !== "success") {
    const errMsg = (msg as SDKResultError).errors.join("; ");
    throw new Error(`Session ended with ${msg.subtype}: ${errMsg}`);
  }
}

// --- Pure helpers (exported for testing) ---

export function extractText(msg: SDKAssistantMessage): string {
  const content = msg.message.content as Array<{
    type: string;
    text?: string;
  }>;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

// Discord messages are capped at 2000 characters.
export function chunkText(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}
