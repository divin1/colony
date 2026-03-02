import { describe, it, expect } from "bun:test";
import { parseTimeoutMs, PromiseQueue } from "./runner";

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

describe("PromiseQueue", () => {
  it("resolves next() immediately when item is already queued", async () => {
    const q = new PromiseQueue<string>();
    q.push("hello");
    const result = await q.next();
    expect(result).toBe("hello");
  });

  it("resolves next() after push() when called before push()", async () => {
    const q = new PromiseQueue<number>();
    const promise = q.next();
    q.push(42);
    expect(await promise).toBe(42);
  });

  it("preserves FIFO order for pre-queued items", async () => {
    const q = new PromiseQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    expect(await q.next()).toBe(1);
    expect(await q.next()).toBe(2);
    expect(await q.next()).toBe(3);
  });

  it("handles concurrent waiters in order", async () => {
    const q = new PromiseQueue<string>();
    const p1 = q.next();
    const p2 = q.next();
    q.push("a");
    q.push("b");
    expect(await p1).toBe("a");
    expect(await p2).toBe("b");
  });

  it("mixes pre-queued and waiter scenarios correctly", async () => {
    const q = new PromiseQueue<string>();
    q.push("first");
    const p = q.next(); // gets "first" immediately
    const p2 = q.next(); // waits
    q.push("second");
    expect(await p).toBe("first");
    expect(await p2).toBe("second");
  });
});
