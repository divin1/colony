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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
      (err) => { signal.removeEventListener("abort", onAbort); reject(err as Error); }
    );
  });
}

async function killProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  proc.kill();
  const killTimer = setTimeout(() => { try { proc.kill(9); } catch { /* already gone */ } }, 5000);
  await proc.exited.catch(() => {});
  clearTimeout(killTimer);
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
): (prompt: string, opts: EngineRunOptions) => Promise<{ lastOutput?: string }> {
  return async (prompt: string, opts: EngineRunOptions): Promise<{ lastOutput?: string }> => {
    const lmOutput = opts.config.logging?.lm_output ?? "discord";
    let lastOutput: string | undefined;

    let proc: ReturnType<SpawnFn>;
    try {
      proc = _spawn([binary, ...extraArgs, prompt], {
        cwd: opts.cwd ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AntSessionError(`Failed to spawn ${binary}: ${msg}`, "permanent");
    }

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let abortErr: unknown;

    try {
      while (true) {
        const readPromise = reader.read();
        const chunk = opts.signal
          ? await raceSignal(readPromise, opts.signal).catch((err) => {
              if (isAbortError(err)) { abortErr = err; return null; }
              throw err;
            })
          : await readPromise;

        if (chunk === null) break;  // aborted
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          lastOutput = line;
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

    if (abortErr) {
      await killProcess(proc);
      throw abortErr;
    }

    // Flush any remaining partial line.
    if (buffer.trim()) {
      lastOutput = buffer;
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

    return { lastOutput };
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
