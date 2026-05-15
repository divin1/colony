import type { AntConfig } from "../config.js";
import type { ConfirmationChannel } from "../hooks.js";

export interface EngineRunOptions {
  config: AntConfig;
  channel: ConfirmationChannel;
  channelId: string;
  cwd?: string;
  commonInstructions?: string;
}

export type EngineRunner = (prompt: string, opts: EngineRunOptions) => Promise<void>;
