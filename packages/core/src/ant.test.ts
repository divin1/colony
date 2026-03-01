import { describe, it, expect } from "bun:test";
import { extractText, chunkText } from "./ant";
import type { SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

// Build a minimal SDKAssistantMessage for testing.
function makeMsg(
  content: Array<{ type: string; text?: string }>
): SDKAssistantMessage {
  return {
    type: "assistant",
    message: { content } as SDKAssistantMessage["message"],
    parent_tool_use_id: null,
    uuid: "test-uuid" as SDKAssistantMessage["uuid"],
    session_id: "test-session",
  };
}

describe("extractText", () => {
  it("extracts text from a single text block", () => {
    const msg = makeMsg([{ type: "text", text: "Hello world" }]);
    expect(extractText(msg)).toBe("Hello world");
  });

  it("joins multiple text blocks with newlines", () => {
    const msg = makeMsg([
      { type: "text", text: "First" },
      { type: "text", text: "Second" },
    ]);
    expect(extractText(msg)).toBe("First\nSecond");
  });

  it("skips non-text blocks (e.g. tool_use)", () => {
    const msg = makeMsg([
      { type: "tool_use" },
      { type: "text", text: "After tool" },
    ]);
    expect(extractText(msg)).toBe("After tool");
  });

  it("returns empty string when no text blocks", () => {
    const msg = makeMsg([{ type: "tool_use" }]);
    expect(extractText(msg)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    const msg = makeMsg([{ type: "text", text: "  trimmed  " }]);
    expect(extractText(msg)).toBe("trimmed");
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("short", 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("short");
  });

  it("splits text longer than maxLen into chunks", () => {
    const text = "a".repeat(4000);
    const chunks = chunkText(text, 1900);
    expect(chunks).toHaveLength(3); // 1900 + 1900 + 200
    expect(chunks[0]).toHaveLength(1900);
    expect(chunks[1]).toHaveLength(1900);
    expect(chunks[2]).toHaveLength(200);
    expect(chunks.join("")).toBe(text);
  });

  it("returns exactly one chunk when text equals maxLen", () => {
    const text = "x".repeat(1900);
    const chunks = chunkText(text, 1900);
    expect(chunks).toHaveLength(1);
  });

  it("handles empty string", () => {
    expect(chunkText("", 1900)).toEqual([""]);
  });
});
