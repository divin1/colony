import { describe, it, expect } from "bun:test";
import { chunkText } from "./ant";

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
