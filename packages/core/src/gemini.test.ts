import { describe, it, expect, mock } from "bun:test";
import { runAntWithGemini } from "./gemini";
import type { ConfirmationChannel } from "./hooks";
import type { AntConfig } from "./config";
import type { GoogleGenAI } from "@google/genai";

// --- Helpers ---

function makeAntConfig(overrides: Partial<AntConfig> = {}): AntConfig {
  return {
    name: "test-ant",
    description: "A test ant",
    instructions: "Do test work.",
    autonomy: "full",
    engine: "gemini",
    ...overrides,
  };
}

function makeChannel(): ConfirmationChannel & {
  messages: string[];
  reactions: string[];
  nextReaction: string | null;
} {
  const messages: string[] = [];
  const reactions: string[] = [];
  let nextReaction: string | null = "✅";
  return {
    messages,
    reactions,
    get nextReaction() {
      return nextReaction;
    },
    set nextReaction(v: string | null) {
      nextReaction = v;
    },
    send: async (_channelId: string, message: string) => {
      messages.push(message);
      return { id: "msg-id" };
    },
    addReaction: async (_messageId: string, emoji: string) => {
      reactions.push(emoji);
    },
    waitForReaction: async () => nextReaction,
  };
}

// Builds a fake GoogleGenAI client. Each entry in `responses` is what one
// call to generateContentStream will yield.
type FakeChunk =
  | { text: string }
  | { functionCalls: Array<{ name: string; args: Record<string, unknown> }> }
  | { error: Error };

function makeFakeGenAI(
  responses: FakeChunk[][],
  capturedContents: unknown[][] = []
): GoogleGenAI {
  let callIdx = 0;
  return {
    models: {
      generateContentStream: async (opts: { contents: unknown[] }) => {
        capturedContents.push([...(opts.contents as unknown[])]);
        const chunks = responses[callIdx++] ?? [];

        return (async function* () {
          for (const chunk of chunks) {
            if ("error" in chunk) {
              throw chunk.error;
            }
            if ("text" in chunk) {
              yield { candidates: [{ content: { parts: [{ text: chunk.text }] } }] };
            }
            if ("functionCalls" in chunk) {
              yield {
                candidates: [
                  {
                    content: {
                      parts: chunk.functionCalls.map((fc) => ({
                        functionCall: fc,
                      })),
                    },
                  },
                ],
              };
            }
          }
        })();
      },
    },
  } as unknown as GoogleGenAI;
}

// --- Tests ---

describe("runAntWithGemini", () => {
  it("streams text chunks to Discord as they arrive", async () => {
    const channel = makeChannel();
    const genAI = makeFakeGenAI([
      [{ text: "hello\n" }, { text: "world\n" }],
    ]);

    await runAntWithGemini("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    expect(channel.messages.join("")).toContain("hello");
    expect(channel.messages.join("")).toContain("world");
  });

  it("completes with no tool calls", async () => {
    const channel = makeChannel();
    const genAI = makeFakeGenAI([[{ text: "done!" }]]);

    await runAntWithGemini("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    expect(channel.messages.join("")).toContain("done!");
  });

  it("executes approved tool calls (autonomy: full)", async () => {
    const capturedContents: unknown[][] = [];
    const channel = makeChannel();
    const genAI = makeFakeGenAI(
      [
        [{ functionCalls: [{ name: "bash", args: { command: "echo hi" } }] }],
        [{ text: "all done" }],
      ],
      capturedContents
    );

    await runAntWithGemini("do some work", {
      config: makeAntConfig({ autonomy: "full" }),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    // Second call to generateContentStream should include a functionResponse
    expect(capturedContents).toHaveLength(2);
    const secondCallContents = capturedContents[1] as Array<{
      role: string;
      parts: Array<{ functionResponse?: { name: string } }>;
    }>;
    const hasResponse = secondCallContents.some((c) =>
      c.parts?.some((p) => p.functionResponse?.name === "bash")
    );
    expect(hasResponse).toBe(true);
  });

  it("blocks dangerous tool call under autonomy: strict", async () => {
    const channel = makeChannel();
    const capturedContents: unknown[][] = [];
    const genAI = makeFakeGenAI(
      [
        [
          {
            functionCalls: [
              { name: "bash", args: { command: "git push origin main" } },
            ],
          },
        ],
        [{ text: "blocked" }],
      ],
      capturedContents
    );

    await runAntWithGemini("do some work", {
      config: makeAntConfig({ autonomy: "strict" }),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    // Discord should NOT have received a confirmation message
    expect(channel.messages.every((m) => !m.includes("Approval required"))).toBe(true);

    // The function response should indicate an error/denial
    const secondCallContents = capturedContents[1] as Array<{
      role: string;
      parts: Array<{ functionResponse?: { name: string; response: { error?: string } } }>;
    }>;
    const errorResponse = secondCallContents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse?.response?.error);
    expect(errorResponse).toBeDefined();
  });

  it("requests Discord confirmation under autonomy: human, proceeds on ✅", async () => {
    const channel = makeChannel();
    channel.nextReaction = "✅";
    const capturedContents: unknown[][] = [];
    const genAI = makeFakeGenAI(
      [
        [
          {
            functionCalls: [
              { name: "bash", args: { command: "git push origin main" } },
            ],
          },
        ],
        [{ text: "pushed" }],
      ],
      capturedContents
    );

    await runAntWithGemini("do some work", {
      config: makeAntConfig({ autonomy: "human" }),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    // Confirmation message should have been sent
    expect(channel.messages.some((m) => m.includes("Approval required"))).toBe(true);

    // The function response should contain output (not an error), because ✅ was received
    const secondCallContents = capturedContents[1] as Array<{
      role: string;
      parts: Array<{ functionResponse?: { response: { output?: string; error?: string } } }>;
    }>;
    const outputResponse = secondCallContents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse?.response?.output !== undefined);
    expect(outputResponse).toBeDefined();
  });

  it("requests Discord confirmation under autonomy: human, blocks on ❌", async () => {
    const channel = makeChannel();
    channel.nextReaction = "❌";
    const capturedContents: unknown[][] = [];
    const genAI = makeFakeGenAI(
      [
        [
          {
            functionCalls: [
              { name: "bash", args: { command: "git push origin main" } },
            ],
          },
        ],
        [{ text: "blocked" }],
      ],
      capturedContents
    );

    await runAntWithGemini("do some work", {
      config: makeAntConfig({ autonomy: "human" }),
      channel,
      channelId: "ch-1",
      confirmationTimeoutMs: 30_000,
      _genAI: genAI,
    });

    // The function response should indicate an error (denied)
    const secondCallContents = capturedContents[1] as Array<{
      role: string;
      parts: Array<{ functionResponse?: { response: { error?: string } } }>;
    }>;
    const errorResponse = secondCallContents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.functionResponse?.response?.error);
    expect(errorResponse).toBeDefined();
  });

  it("throws AntSessionError(rate_limit) on 429", async () => {
    const channel = makeChannel();
    const rateLimitErr = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    const genAI = makeFakeGenAI([[{ error: rateLimitErr }]]);

    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        confirmationTimeoutMs: 30_000,
        _genAI: genAI,
      })
    ).rejects.toMatchObject({ category: "rate_limit" });
  });

  it("throws AntSessionError(auth) on 401", async () => {
    const channel = makeChannel();
    const authErr = Object.assign(new Error("Unauthorized"), { status: 401 });
    const genAI = makeFakeGenAI([[{ error: authErr }]]);

    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        confirmationTimeoutMs: 30_000,
        _genAI: genAI,
      })
    ).rejects.toMatchObject({ category: "auth" });
  });

  it("throws AntSessionError(transient) on 500", async () => {
    const channel = makeChannel();
    const serverErr = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    const genAI = makeFakeGenAI([[{ error: serverErr }]]);

    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        confirmationTimeoutMs: 30_000,
        _genAI: genAI,
      })
    ).rejects.toMatchObject({ category: "transient" });
  });

  it("throws AntSessionError(max_turns) when loop hits max_turns limit", async () => {
    const channel = makeChannel();
    // Always return a function call → loop never exits normally
    const alwaysFunctionCall: FakeChunk[][] = Array.from({ length: 10 }, () => [
      { functionCalls: [{ name: "bash", args: { command: "echo loop" } }] },
    ]);
    const genAI = makeFakeGenAI(alwaysFunctionCall);

    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig({ autonomy: "full", gemini: { model: "gemini-2.5-pro", max_turns: 3 } }),
        channel,
        channelId: "ch-1",
        confirmationTimeoutMs: 30_000,
        _genAI: genAI,
      })
    ).rejects.toMatchObject({ category: "max_turns" });
  });
});
