import "./engines/index.js";
import { getEngine } from "./engines/registry.js";
import type { AntConfig } from "./config.js";
import type { ConfirmationChannel } from "./hooks.js";

export interface AntRunOptions {
  config: AntConfig;
  /** Channel used for status messages and output forwarding. */
  channel: ConfirmationChannel;
  /** Pre-resolved Discord channel ID for this ant. */
  channelId: string;
  /** Working directory for the agent session. Defaults to process.cwd(). */
  cwd?: string;
  /** Colony-level conventions (PLAN.md tracking, git identity) appended to the system prompt. */
  commonInstructions?: string;
}

export async function runAnt(
  prompt: string,
  opts: AntRunOptions
): Promise<void> {
  const engine = getEngine(opts.config.engine);
  return engine(prompt, opts);
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
