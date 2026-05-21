import { registerEngine } from "./registry.js";
import type { EngineRunOptions } from "./types.js";
import {
  AntSessionError,
  classifyAssistantError,
  classifyResultError,
  type AssistantErrorString,
  type ResultErrorSubtype,
} from "../errors.js";
import { log } from "../log.js";

// --- Text extraction ---

export function extractText(
  message: Record<string, unknown>
): string {
  const content = message.content as Array<{ type: string; text?: string }> | undefined;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

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

// --- NDJSON message handler ---
// Returns the extracted assistant text (if any) so the caller can track lastOutput.

async function handleMessage(
  msg: unknown,
  opts: EngineRunOptions,
  lmOutput: "discord" | "console" | "both"
): Promise<string | undefined> {
  if (typeof msg !== "object" || msg === null) return undefined;
  const m = msg as Record<string, unknown>;

  if (m.type === "assistant") {
    if (m.error) {
      const category = classifyAssistantError(m.error as AssistantErrorString);
      throw new AntSessionError(`API error: ${m.error}`, category);
    }
    const text = extractText(m.message as Record<string, unknown>);
    if (text) {
      if (lmOutput === "console" || lmOutput === "both") {
        log(opts.config.name, text);
      }
      if (lmOutput === "discord" || lmOutput === "both") {
        for (const chunk of chunkText(text)) {
          await opts.channel.send(opts.channelId, chunk).catch(() => {});
        }
      }
      return text;
    }
  } else if (m.type === "rate_limit_event") {
    const info = m.rate_limit_info as Record<string, unknown> | undefined;
    if (info?.status === "rejected") {
      const resetsAt = typeof info.resetsAt === "number" ? info.resetsAt : undefined;
      const retryAfterMs =
        resetsAt !== undefined ? resetsAt * 1000 - Date.now() : undefined;
      throw new AntSessionError("Rate limit reached", "rate_limit", retryAfterMs);
    }
    // 'allowed' or 'allowed_warning': informational, no action
  } else if (m.type === "result" && m.subtype !== "success") {
    const category = classifyResultError(m.subtype as ResultErrorSubtype);
    const errors = Array.isArray(m.errors)
      ? (m.errors as string[]).join("; ")
      : String(m.subtype);
    throw new AntSessionError(
      `Session ended with ${m.subtype}: ${errors}`,
      category
    );
  }
  return undefined;
}

// --- Abort helpers ---

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Races a promise against an AbortSignal. If the signal fires first, rejects
// with a DOMException("Aborted", "AbortError"). Cleans up the listener either way.
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
  proc.kill();  // SIGTERM — gives Claude CLI a chance to flush and exit
  const killTimer = setTimeout(() => { try { proc.kill(9); } catch { /* already gone */ } }, 5000);
  await proc.exited.catch(() => {});
  clearTimeout(killTimer);
}

// --- Engine implementation ---

type SpawnFn = typeof Bun.spawn;

export async function runClaudeCli(
  prompt: string,
  opts: EngineRunOptions,
  _spawn: SpawnFn = Bun.spawn
): Promise<{ lastOutput?: string }> {
  const lmOutput = opts.config.logging?.lm_output ?? "discord";
  let lastOutput: string | undefined;

  const combined = [opts.config.instructions, opts.commonInstructions]
    .filter(Boolean)
    .join("\n\n");

  const args = ["claude", "--print", prompt, "--output-format", "stream-json"];
  if (opts.config.claude?.model) {
    args.push("--model", opts.config.claude.model);
  }
  if (opts.config.claude?.reasoning_effort) {
    args.push("--reasoning-effort", opts.config.claude.reasoning_effort);
  }
  if (combined) {
    args.push("--append-system-prompt", combined);
  }

  let proc: ReturnType<SpawnFn>;
  try {
    proc = _spawn(args, {
      cwd: opts.cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AntSessionError(`Failed to spawn claude: ${msg}`, "permanent");
  }

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hasResult = false;
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
        try {
          const msg = JSON.parse(line);
          const text = await handleMessage(msg, opts, lmOutput);
          if (text) lastOutput = text;
          if ((msg as Record<string, unknown>).type === "result") hasResult = true;
        } catch (err) {
          // Re-throw AntSessionError (thrown from handleMessage), skip unparseable lines.
          if (err instanceof AntSessionError) throw err;
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

  // Process any remaining buffer content.
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      const text = await handleMessage(msg, opts, lmOutput);
      if (text) lastOutput = text;
      if ((msg as Record<string, unknown>).type === "result") hasResult = true;
    } catch (err) {
      if (err instanceof AntSessionError) throw err;
    }
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0 && !hasResult) {
    throw new AntSessionError(
      `claude CLI exited with code ${exitCode}`,
      "transient"
    );
  }

  return { lastOutput };
}

registerEngine("claude-cli", runClaudeCli);
