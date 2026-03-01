import { describe, it, expect } from "bun:test";
import { parseTimeoutMs } from "./runner";

describe("parseTimeoutMs", () => {
  it("parses seconds", () => {
    expect(parseTimeoutMs("30s")).toBe(30_000);
    expect(parseTimeoutMs("1s")).toBe(1_000);
  });

  it("parses minutes", () => {
    expect(parseTimeoutMs("5m")).toBe(300_000);
    expect(parseTimeoutMs("30m")).toBe(1_800_000);
  });

  it("parses hours", () => {
    expect(parseTimeoutMs("1h")).toBe(3_600_000);
    expect(parseTimeoutMs("2h")).toBe(7_200_000);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseTimeoutMs("  10m  ")).toBe(600_000);
  });

  it("throws on invalid format", () => {
    expect(() => parseTimeoutMs("30")).toThrow("Invalid duration");
    expect(() => parseTimeoutMs("30d")).toThrow("Invalid duration");
    expect(() => parseTimeoutMs("")).toThrow("Invalid duration");
    expect(() => parseTimeoutMs("5 m")).toThrow("Invalid duration");
  });
});
