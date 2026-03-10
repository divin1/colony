import { spawn as nodeSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio, ChildProcess } from "child_process";
import type { AntConfig } from "./config";
import type { ConfirmationChannel } from "./hooks";
import { chunkText } from "./ant";

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcess;

export interface GeminiRunOptions {
  config: AntConfig;
  channel: ConfirmationChannel;
  channelId: string;
  /** Working directory for the gemini CLI process. Defaults to process.cwd(). */
  cwd?: string;
  /** Override spawn for testing. */
  _spawn?: SpawnFn;
}

// Runs a single prompt through the Gemini CLI, streaming output to the channel.
// Throws if the process exits with a non-zero code.
export async function runAntWithGemini(
  prompt: string,
  opts: GeminiRunOptions
): Promise<void> {
  const model = opts.config.gemini?.model ?? "gemini-2.5-pro";
  const systemPrompt = opts.config.instructions;
  const spawnFn: SpawnFn = opts._spawn ?? nodeSpawn;

  const args = ["--model", model, "--prompt", prompt];
  if (systemPrompt) {
    args.unshift("--system", systemPrompt);
  }

  const proc = spawnFn("gemini", args, {
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
            `gemini exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn gemini CLI: ${err.message}`));
    });
  });

  const output = stdout.trim();
  if (output) {
    for (const chunk of chunkText(output)) {
      await opts.channel.send(opts.channelId, chunk).catch(() => {});
    }
  }
}
