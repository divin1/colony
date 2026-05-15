import type { AntConfig } from "../config.js";
import type { ConfirmationChannel } from "../hooks.js";

export interface EngineRunOptions {
  config: AntConfig;
  channel: ConfirmationChannel;
  channelId: string;
  cwd?: string;
  commonInstructions?: string;
}

export interface EngineResult {
  /** The last non-empty text block produced by the agent. Used for GitHub issue comments. */
  lastOutput?: string;
}

export type EngineRunner = (prompt: string, opts: EngineRunOptions) => Promise<EngineResult>;
