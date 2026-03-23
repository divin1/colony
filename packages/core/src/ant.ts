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
import {
  AntSessionError,
  classifyAssistantError,
  classifyResultError,
} from "./errors";
import type { AntState } from "./state";
import { log } from "./log";

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
  /** Ant state for confirmation overrides. */
  state?: AntState;
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
      confirmationTimeoutMs: opts.confirmationTimeoutMs,
      cwd: opts.cwd,
      commonInstructions: opts.commonInstructions,
      state: opts.state,
    });
  }

  const autonomy = opts.config.autonomy;
  const loggingMode = opts.config.logging?.tool_calls ?? "impactful";
  const lmOutput = opts.config.logging?.lm_output ?? "discord";

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
                  autonomy,
                  opts.state,
                  opts.config.name,
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
    await handleMessage(msg, opts.config.name, opts.channel, opts.channelId, lmOutput);
  }
}

async function handleMessage(
  msg: SDKMessage,
  antName: string,
  channel: ConfirmationChannel,
  channelId: string,
  lmOutput: "discord" | "console" | "both" = "discord",
): Promise<void> {
  if (msg.type === "assistant") {
    if (msg.error) {
      const category = classifyAssistantError(msg.error);
      throw new AntSessionError(`API error: ${msg.error}`, category);
    }
    const text = extractText(msg);
    if (text) {
      if (lmOutput === "console" || lmOutput === "both") {
        log(antName, text);
      }
      if (lmOutput === "discord" || lmOutput === "both") {
        for (const chunk of chunkText(text)) {
          await channel.send(channelId, chunk).catch(() => {});
        }
      }
    }
  } else if (msg.type === "rate_limit_event") {
    const { status, resetsAt } = msg.rate_limit_info;
    if (status === "rejected") {
      const retryAfterMs =
        resetsAt !== undefined ? resetsAt * 1000 - Date.now() : undefined;
      throw new AntSessionError("Rate limit reached", "rate_limit", retryAfterMs);
    }
    // 'allowed' or 'allowed_warning': informational, no action
  } else if (msg.type === "result" && msg.subtype !== "success") {
    const category = classifyResultError(msg.subtype);
    const errMsg = (msg as SDKResultError).errors.join("; ");
    throw new AntSessionError(
      `Session ended with ${msg.subtype}: ${errMsg}`,
      category
    );
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
