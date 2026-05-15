import { describe, it, expect, mock } from "bun:test";
import { extractText, runClaudeCli } from "./claude-cli";
import { AntSessionError } from "../errors";
import type { EngineRunOptions } from "./types";

// --- extractText ---

describe("extractText", () => {
  it("extracts text from a single text block", () => {
    const msg = { content: [{ type: "text", text: "Hello world" }] };
    expect(extractText(msg)).toBe("Hello world");
  });

  it("joins multiple text blocks with newlines", () => {
    const msg = {
      content: [
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ],
    };
    expect(extractText(msg)).toBe("First\nSecond");
  });

  it("skips non-text blocks (e.g. tool_use)", () => {
    const msg = {
      content: [
        { type: "tool_use" },
        { type: "text", text: "After tool" },
      ],
    };
    expect(extractText(msg)).toBe("After tool");
  });

  it("returns empty string when no text blocks", () => {
    const msg = { content: [{ type: "tool_use" }] };
    expect(extractText(msg)).toBe("");
  });

  it("returns empty string when content is not an array", () => {
    expect(extractText({})).toBe("");
    expect(extractText({ content: null })).toBe("");
  });

  it("trims surrounding whitespace", () => {
    const msg = { content: [{ type: "text", text: "  trimmed  " }] };
    expect(extractText(msg)).toBe("trimmed");
  });
});

// --- runClaudeCli NDJSON dispatch ---

function makeChannel() {
  return {
    send: mock(async () => ({ id: "msg-1" })),
  };
}

function makeOpts(channelOverride = makeChannel()): EngineRunOptions {
  return {
    config: {
      name: "test-ant",
      description: "test",
      instructions: "do stuff",
      engine: "claude-cli",
    } as EngineRunOptions["config"],
    channel: channelOverride,
    channelId: "ch-1",
  };
}

/** Builds a fake Bun.spawn that emits the given NDJSON lines then exits 0. */
function makeSpawn(lines: unknown[], exitCode = 0): typeof Bun.spawn {
  return mock((_args: string[], _opts: unknown) => {
    const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const bytes = new TextEncoder().encode(ndjson);

    let released = false;
    const reader = {
      read: mock(async () => {
        if (released) return { done: true, value: undefined };
        released = true;
        return { done: false, value: bytes };
      }),
      releaseLock: mock(() => {}),
    };

    return {
      stdout: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
      stderr: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), releaseLock: () => {} }) } as unknown as ReadableStream<Uint8Array>,
      exited: Promise.resolve(exitCode),
    };
  }) as unknown as typeof Bun.spawn;
}

describe("runClaudeCli — NDJSON dispatch", () => {
  it("forwards assistant text to Discord", async () => {
    const channel = makeChannel();
    const spawn = makeSpawn([
      { type: "assistant", message: { content: [{ type: "text", text: "Hello!" }] } },
      { type: "result", subtype: "success" },
    ]);

    await runClaudeCli("do stuff", makeOpts(channel), spawn);

    expect(channel.send).toHaveBeenCalledWith("ch-1", "Hello!");
  });

  it("resolves cleanly on result success", async () => {
    const spawn = makeSpawn([{ type: "result", subtype: "success" }]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).resolves.toMatchObject({});
  });

  it("throws rate_limit on rate_limit_event rejected", async () => {
    const spawn = makeSpawn([
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    ]);

    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "rate_limit",
    });
  });

  it("does not throw on rate_limit_event allowed", async () => {
    const spawn = makeSpawn([
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
      { type: "result", subtype: "success" },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).resolves.toMatchObject({});
  });

  it("throws correct category for result error_max_turns", async () => {
    const spawn = makeSpawn([
      { type: "result", subtype: "error_max_turns", errors: ["limit hit"] },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "max_turns",
    });
  });

  it("throws correct category for result error_max_budget_usd", async () => {
    const spawn = makeSpawn([
      { type: "result", subtype: "error_max_budget_usd", errors: ["cap hit"] },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "budget",
    });
  });

  it("throws correct category for result error_during_execution", async () => {
    const spawn = makeSpawn([
      { type: "result", subtype: "error_during_execution", errors: ["oops"] },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "transient",
    });
  });

  it("throws correct category for result error_max_structured_output_retries", async () => {
    const spawn = makeSpawn([
      { type: "result", subtype: "error_max_structured_output_retries", errors: [] },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "permanent",
    });
  });

  it("throws correct category on assistant message error field", async () => {
    const spawn = makeSpawn([
      { type: "assistant", error: "billing_error", message: { content: [] } },
    ]);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "billing",
    });
  });

  it("throws transient on non-zero exit with no result message", async () => {
    const spawn = makeSpawn([], 1);
    await expect(runClaudeCli("go", makeOpts(), spawn)).rejects.toMatchObject({
      category: "transient",
    });
  });

  it("does not throw on non-zero exit when result was already received", async () => {
    // A result message was processed; exit code is irrelevant.
    const spawn = makeSpawn([{ type: "result", subtype: "success" }], 1);
    await expect(runClaudeCli("go", makeOpts(), spawn)).resolves.toMatchObject({});
  });

  it("skips unparseable NDJSON lines silently", async () => {
    const channel = makeChannel();
    const ndjson = 'not-json\n{"type":"result","subtype":"success"}\n';
    const bytes = new TextEncoder().encode(ndjson);
    let released = false;
    const spawn = mock((_args: string[], _opts: unknown) => ({
      stdout: {
        getReader: () => ({
          read: mock(async () => {
            if (released) return { done: true, value: undefined };
            released = true;
            return { done: false, value: bytes };
          }),
          releaseLock: mock(() => {}),
        }),
      } as unknown as ReadableStream<Uint8Array>,
      stderr: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), releaseLock: () => {} }) } as unknown as ReadableStream<Uint8Array>,
      exited: Promise.resolve(0),
    })) as unknown as typeof Bun.spawn;

    await expect(runClaudeCli("go", makeOpts(channel), spawn)).resolves.toMatchObject({});
  });

  it("returns lastOutput from the final assistant text block", async () => {
    const spawn = makeSpawn([
      { type: "assistant", message: { content: [{ type: "text", text: "First message" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Done! Created PR #42." }] } },
      { type: "result", subtype: "success" },
    ]);
    const result = await runClaudeCli("go", makeOpts(), spawn);
    expect(result.lastOutput).toBe("Done! Created PR #42.");
  });

  it("returns lastOutput undefined when no assistant text was produced", async () => {
    const spawn = makeSpawn([{ type: "result", subtype: "success" }]);
    const result = await runClaudeCli("go", makeOpts(), spawn);
    expect(result.lastOutput).toBeUndefined();
  });

  it("is an AntSessionError instance", async () => {
    const spawn = makeSpawn([
      { type: "result", subtype: "error_during_execution", errors: ["fail"] },
    ]);
    try {
      await runClaudeCli("go", makeOpts(), spawn);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(AntSessionError);
    }
  });
});
