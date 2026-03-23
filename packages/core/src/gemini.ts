import { GoogleGenAI } from "@google/genai";
import type { AntConfig } from "./config";
import {
  isDangerousRaw,
  requestConfirmation,
  type ConfirmationChannel,
} from "./hooks";
import { AntSessionError } from "./errors";
import { chunkText } from "./ant";
import type { AntState } from "./state";
import { log } from "./log";

const BASH_TOOL = {
  name: "bash",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

// notify_discord is NOT a separate function tool — the model uses bash to call it:
//   notify_discord "message content"
// We intercept this in the bash execution loop below and post to Discord.
// This is more reliable than a custom function tool, which Gemini-2.5-flash
// tends to output as text syntax rather than an actual function call.

export interface GeminiRunOptions {
  config: AntConfig;
  channel: ConfirmationChannel;
  channelId: string;
  confirmationTimeoutMs: number;
  /** Working directory for bash tool execution. Defaults to process.cwd(). */
  cwd?: string;
  /** Colony-level conventions (PLAN.md tracking, git identity) appended to the system prompt. */
  commonInstructions?: string;
  /** Ant state for confirmation overrides. */
  state?: AntState;
  /** Override GoogleGenAI client for testing. */
  _genAI?: GoogleGenAI;
}

// Runs a single prompt through the Gemini SDK in an in-process agentic loop,
// streaming text output to the channel and applying the ant's autonomy policy
// to tool calls.
export async function runAntWithGemini(
  prompt: string,
  opts: GeminiRunOptions
): Promise<void> {
  const model = opts.config.gemini?.model ?? "gemini-2.5-pro";
  const maxTurns = opts.config.gemini?.max_turns ?? 100;
  const autonomy = opts.config.autonomy;
  const cwd = opts.cwd ?? process.cwd();
  const lmOutput = opts.config.logging?.lm_output ?? "discord";

  const systemInstruction = [opts.config.instructions, opts.commonInstructions]
    .filter(Boolean)
    .join("\n\n");

  if (!opts._genAI && !process.env.GEMINI_API_KEY) {
    throw new Error("Missing environment variable: GEMINI_API_KEY");
  }
  const client =
    opts._genAI ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Contents array is mutated each turn: append model response + function responses.
  const contents: unknown[] = [{ role: "user", parts: [{ text: prompt }] }];

  for (let turn = 0; turn < maxTurns; turn++) {
    let stream: AsyncIterable<GeminiChunk>;

    try {
      stream = (await client.models.generateContentStream({
        model,
        config: systemInstruction ? { systemInstruction } : undefined,
        contents,
        tools: [{ functionDeclarations: [BASH_TOOL] }],
      })) as AsyncIterable<GeminiChunk>;
    } catch (err) {
      throw classifyGeminiError(err);
    }

    const functionCalls: Array<{ name: string; args: unknown }> = [];
    let textBuf = "";
    let fullText = ""; // accumulates entire turn for notify_discord pattern extraction

    try {
      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            textBuf += part.text;
            fullText += part.text;
            // Flush on newline boundaries or when buffer reaches 200 chars.
            const nlIdx = textBuf.lastIndexOf("\n");
            if (nlIdx !== -1 || textBuf.length >= 200) {
              const toSend =
                nlIdx !== -1 ? textBuf.slice(0, nlIdx + 1) : textBuf;
              if (lmOutput === "console" || lmOutput === "both") {
                log(opts.config.name, toSend.trimEnd());
              }
              if (lmOutput === "discord" || lmOutput === "both") {
                for (const c of chunkText(toSend)) {
                  await opts.channel.send(opts.channelId, c).catch(() => {});
                }
              }
              textBuf = nlIdx !== -1 ? textBuf.slice(nlIdx + 1) : "";
            }
          }
          if (part.functionCall) {
            functionCalls.push(part.functionCall);
          }
        }
      }
    } catch (err) {
      throw classifyGeminiError(err);
    }

    // Flush any remaining text.
    if (textBuf.trim()) {
      if (lmOutput === "console" || lmOutput === "both") {
        log(opts.config.name, textBuf.trimEnd());
      }
      if (lmOutput === "discord" || lmOutput === "both") {
        for (const c of chunkText(textBuf)) {
          await opts.channel.send(opts.channelId, c).catch(() => {});
        }
      }
    }

    // Extract notify_discord "..." patterns from text output and post to Discord.
    // The model writes these as text rather than bash function calls; this catches both cases.
    const NOTIFY_RE = /notify_discord\s+"((?:[^"\\]|\\.)*)"/gs;
    let nm: RegExpExecArray | null;
    while ((nm = NOTIFY_RE.exec(fullText)) !== null) {
      const msg = nm[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        // Expand $VAR and ${VAR} references using process.env.
        .replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, plain) =>
          process.env[braced ?? plain] ?? ""
        );
      if (msg.trim()) {
        await opts.channel.send(opts.channelId, msg).catch(() => {});
      }
    }

    // No function calls → session complete.
    if (functionCalls.length === 0) {
      return;
    }

    // Append the model's function call message to contents.
    contents.push({
      role: "model",
      parts: functionCalls.map((fc) => ({ functionCall: fc })),
    });

    // Execute each function call and collect responses.
    const functionResponses: unknown[] = [];

    for (const call of functionCalls) {
      const args = call.args;
      const command =
        typeof args === "object" && args !== null
          ? ((args as Record<string, unknown>).command as string | undefined) ??
            ""
          : "";

      // Intercept: notify_discord "message" — post to Discord, skip bash execution.
      const notifyMatch = command.match(/^notify_discord\s+([\s\S]+)$/);
      if (notifyMatch) {
        let message = notifyMatch[1].trim();
        // Strip outer matching quotes if present (single or double).
        if (
          message.length >= 2 &&
          ((message[0] === '"' && message[message.length - 1] === '"') ||
            (message[0] === "'" && message[message.length - 1] === "'"))
        ) {
          message = message.slice(1, -1);
        }
        // Unescape \n sequences written literally in the string.
        message = message.replace(/\\n/g, "\n");
        await opts.channel.send(opts.channelId, message).catch(() => {});
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { output: "Message posted to Discord." },
          },
        });
        continue;
      }
      const description =
        command || `${call.name}(${safeStringify(args)})`;

      // Apply autonomy policy for dangerous actions (skip for "full").
      if (
        autonomy !== "full" &&
        isDangerousRaw(call.name, args, opts.config.confirmation ?? undefined)
      ) {
        const result = await requestConfirmation(
          opts.channel,
          opts.channelId,
          opts.confirmationTimeoutMs,
          description,
          autonomy,
          opts.state,
          opts.config.name,
        );
        if (!result.approved) {
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { error: result.reason ?? "Denied by autonomy policy" },
            },
          });
          continue;
        }
      }

      // Execute the bash command.
      const proc = Bun.spawnSync(["bash", "-c", command || "true"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = proc.stdout ? Buffer.from(proc.stdout).toString() : "";
      const stderr = proc.stderr ? Buffer.from(proc.stderr).toString() : "";
      const MAX_OUTPUT = 2000;
      const rawOutput = `${stdout}${stderr ? `\nstderr: ${stderr}` : ""}`.trim();
      const output =
        rawOutput.length > MAX_OUTPUT
          ? rawOutput.slice(0, MAX_OUTPUT) + `\n[output truncated at ${MAX_OUTPUT} chars]`
          : rawOutput || "(no output)";

      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { output },
        },
      });
    }

    // Append function responses and continue the loop.
    contents.push({ role: "user", parts: functionResponses });
  }

  throw new AntSessionError("Max turns reached", "max_turns");
}

// --- Types for Gemini streaming chunks ---

interface GeminiChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: unknown };
      }>;
    };
  }>;
}

// --- Error classification ---

function classifyGeminiError(err: unknown): AntSessionError {
  if (err !== null && typeof err === "object") {
    const status =
      "status" in err ? (err as { status: unknown }).status : undefined;
    if (typeof status === "number") {
      if (status === 429) {
        const retryAfterMs = extractRetryAfterMs(err);
        return new AntSessionError(
          "Rate limited by Gemini API",
          "rate_limit",
          retryAfterMs
        );
      }
      if (status === 401 || status === 403) {
        return new AntSessionError("Gemini API authentication failed", "auth");
      }
      if (status === 402) {
        return new AntSessionError("Gemini API billing error", "billing");
      }
      if (status === 400) {
        return new AntSessionError("Invalid Gemini API request", "permanent");
      }
      return new AntSessionError(
        `Gemini API error (status ${status})`,
        "transient"
      );
    }
  }
  if (err instanceof Error) {
    return new AntSessionError(err.message, "transient");
  }
  return new AntSessionError(String(err), "transient");
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const headers =
    "headers" in err ? (err as { headers: unknown }).headers : undefined;
  if (headers !== null && typeof headers === "object") {
    const retryAfter =
      "retry-after" in headers
        ? (headers as Record<string, unknown>)["retry-after"]
        : undefined;
    if (typeof retryAfter === "string") {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs)) return secs * 1000;
    }
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
