import { registerEngine } from "./registry.js";
import type { EngineRunOptions } from "./types.js";
import { AntSessionError } from "../errors.js";
import { log } from "../log.js";

// Splits text into Discord-safe chunks (max 1900 chars).
function chunkText(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

type SpawnFn = typeof Bun.spawn;

/**
 * Creates an engine runner that spawns a CLI binary and streams its stdout
 * lines to Discord. No structured parsing — raw text output is forwarded as-is.
 * Non-zero exit code is treated as a transient error.
 */
export function createGenericCliRunner(
  binary: string,
  extraArgs: string[] = [],
  _spawn: SpawnFn = Bun.spawn
): (prompt: string, opts: EngineRunOptions) => Promise<void> {
  return async (prompt: string, opts: EngineRunOptions): Promise<void> => {
    const lmOutput = opts.config.logging?.lm_output ?? "discord";

    const proc = _spawn([binary, ...extraArgs, prompt], {
      cwd: opts.cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          if (lmOutput === "console" || lmOutput === "both") {
            log(opts.config.name, line);
          }
          if (lmOutput === "discord" || lmOutput === "both") {
            for (const chunk of chunkText(line)) {
              await opts.channel.send(opts.channelId, chunk).catch(() => {});
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Flush any remaining partial line.
    if (buffer.trim()) {
      if (lmOutput === "console" || lmOutput === "both") {
        log(opts.config.name, buffer);
      }
      if (lmOutput === "discord" || lmOutput === "both") {
        for (const chunk of chunkText(buffer)) {
          await opts.channel.send(opts.channelId, chunk).catch(() => {});
        }
      }
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new AntSessionError(
        `${binary} CLI exited with code ${exitCode}`,
        "transient"
      );
    }
  };
}

// Register named CLI engines.
registerEngine("codex", createGenericCliRunner("codex"));
registerEngine("gemini-cli", createGenericCliRunner("gemini", ["--yolo"]));
registerEngine("opencode", createGenericCliRunner("opencode"));

// "cli" engine: binary and extra args come from the ant's config.cli block at runtime.
registerEngine("cli", async (prompt, opts) => {
  const binary = opts.config.cli?.binary;
  if (!binary) {
    throw new AntSessionError(
      `engine "cli" requires a cli.binary in the ant config`,
      "permanent"
    );
  }
  const extraArgs = opts.config.cli?.args ?? [];
  return createGenericCliRunner(binary, extraArgs)(prompt, opts);
});
