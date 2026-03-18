import { spawn as nodeSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio, ChildProcess } from "child_process";
import type { AntConfig } from "./config";
import { buildGeminiAutonomyInstructions, type ConfirmationChannel } from "./hooks";
import { chunkText } from "./ant";

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcess;

export interface CursorRunOptions {
  config: AntConfig;
  channel: ConfirmationChannel;
  channelId: string;
  /** Working directory for the cursor CLI process. Defaults to process.cwd(). */
  cwd?: string;
  /** Colony-level conventions (PLAN.md tracking, git identity) appended to the system prompt. */
  commonInstructions?: string;
  /** Override spawn for testing. */
  _spawn?: SpawnFn;
}

// Runs a single prompt through the Cursor CLI, streaming output to the channel.
// Throws if the process exits with a non-zero code.
export async function runAntWithCursor(
  prompt: string,
  opts: CursorRunOptions
): Promise<void> {
  const model = opts.config.cursor?.model ?? "claude-4.5";
  const autonomyInstructions = buildGeminiAutonomyInstructions(
    opts.config.autonomy
  );
  const systemPrompt = [
    opts.config.instructions,
    opts.commonInstructions,
    autonomyInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
  const spawnFn: SpawnFn = opts._spawn ?? nodeSpawn;

  const args = ["agent", "--headless", "--model", model, "--prompt", prompt];
  if (systemPrompt) {
    args.unshift("--system", systemPrompt);
  }

  const proc = spawnFn("cursor", args, {
    cwd: opts.cwd ?? process.cwd(),
    env: process.env,
  });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `cursor exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn cursor CLI: ${err.message}`));
    });
  });

  const output = stdout.trim();
  if (output) {
    for (const chunk of chunkText(output)) {
      await opts.channel.send(opts.channelId, chunk).catch(() => {});
    }
  }
}
