import { describe, it, expect, mock } from "bun:test";
import { parseTimeoutMs, PromiseQueue, runColony, buildCommonInstructions } from "./runner";
import type { RunnerDiscord } from "./runner";
import type { LoadedConfig } from "./config";

// --- Helpers ---

function makeDiscord(overrides: Partial<RunnerDiscord> = {}): RunnerDiscord {
  return {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    send: mock(async () => ({ id: "msg-1" })),
    addReaction: mock(async () => {}),
    waitForReaction: mock(async () => null),
    resolveChannelId: mock(async () => "ch-1"),
    on: mock(() => {}),
    ...overrides,
  };
}

function makeConfig(ants: LoadedConfig["ants"] = []): LoadedConfig {
  return {
    colony: { name: "test-colony" },
    ants,
  };
}

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

// --- buildCommonInstructions ---

describe("buildCommonInstructions", () => {
  it("always includes PLAN.md instructions", () => {
    const result = buildCommonInstructions({ name: "test" });
    expect(result).toContain("PLAN.md");
    expect(result).toContain("Current Goal");
    expect(result).toContain("Active Tasks");
    expect(result).toContain("Completed");
  });

  it("includes git identity instructions even without explicit config", () => {
    const result = buildCommonInstructions({ name: "test" });
    expect(result.toLowerCase()).toContain("git");
    expect(result).toContain("bot");
  });

  it("injects git config commands when user_name and user_email are set", () => {
    const result = buildCommonInstructions({
      name: "test",
      defaults: { confirmation_timeout: "30m", git: { user_name: "Jane Smith", user_email: "jane@example.com" } },
    });
    expect(result).toContain('git config user.name "Jane Smith"');
    expect(result).toContain('git config user.email "jane@example.com"');
  });

  it("injects only user_name when user_email is absent", () => {
    const result = buildCommonInstructions({
      name: "test",
      defaults: { confirmation_timeout: "30m", git: { user_name: "Jane Smith" } },
    });
    expect(result).toContain('git config user.name "Jane Smith"');
    expect(result).not.toContain("user.email");
  });

  it("falls back to generic git identity instructions when no git config provided", () => {
    const result = buildCommonInstructions({ name: "test" });
    expect(result).toContain("git config user.name");
    expect(result).not.toContain('git config user.name "');
  });
});

// --- runColony (integration) ---

describe("runColony", () => {
  it("connects and disconnects Discord even with zero ants", async () => {
    const discord = makeDiscord();
    await runColony(makeConfig([]), discord);
    expect(discord.connect).toHaveBeenCalledTimes(1);
    expect(discord.disconnect).toHaveBeenCalledTimes(1);
  });

  it("resolves without calling resolveChannelId when there are no ants", async () => {
    const discord = makeDiscord();
    await runColony(makeConfig([]), discord);
    expect(discord.resolveChannelId).not.toHaveBeenCalled();
  });
});

// --- PromiseQueue ---

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
