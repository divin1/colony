import { describe, it, expect, mock } from "bun:test";
import { ColonyState } from "./colony-state";

function makeControls(overrides: Partial<Parameters<ColonyState["register"]>[2]> = {}) {
  const queue: string[] = [];
  return {
    pause: mock(() => {}),
    resume: mock(() => {}),
    pushPrompt: mock((p: string) => { queue.push(p); }),
    clearQueue: mock(() => { const n = queue.length; queue.length = 0; return n; }),
    getQueueSize: mock(() => queue.length),
    removeWorkItem: mock((_id: string) => false),
    _queue: queue,
    ...overrides,
  };
}

describe("ColonyState", () => {
  it("tracks the colony name", () => {
    const s = new ColonyState("my-colony");
    expect(s.colonyName).toBe("my-colony");
    expect(s.getStatus().colony).toBe("my-colony");
  });

  it("registers an ant and returns it in getStatus", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());
    const { ants } = s.getStatus();
    expect(ants).toHaveLength(1);
    expect(ants[0].name).toBe("worker");
    expect(ants[0].engine).toBe("claude-cli");
    expect(ants[0].state).toBe("starting");
  });

  it("setState updates the ant's state", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());
    s.setState("worker", "running");
    expect(s.getAntStatus("worker")?.state).toBe("running");
  });

  it("incrementSessions tracks completed and crashed independently", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());
    s.incrementSessions("worker", "completed");
    s.incrementSessions("worker", "completed");
    s.incrementSessions("worker", "crashed");
    const status = s.getAntStatus("worker")!;
    expect(status.sessionsCompleted).toBe(2);
    expect(status.sessionsCrashed).toBe(1);
  });

  it("pushOutput appends to recentOutput and notifies subscribers", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());

    const received: string[] = [];
    s.subscribeOutput("worker", (t) => received.push(t));

    s.pushOutput("worker", "hello");
    s.pushOutput("worker", "world");

    expect(s.getAntStatus("worker")?.recentOutput).toEqual(["hello", "world"]);
    expect(received).toEqual(["hello", "world"]);
  });

  it("subscribeOutput unsubscribe stops notifications", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());

    const received: string[] = [];
    const unsub = s.subscribeOutput("worker", (t) => received.push(t));

    s.pushOutput("worker", "before");
    unsub();
    s.pushOutput("worker", "after");

    expect(received).toEqual(["before"]);
  });

  it("recentOutput is capped at 150 lines", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());
    for (let i = 0; i < 200; i++) s.pushOutput("worker", `line ${i}`);
    expect(s.getAntStatus("worker")?.recentOutput.length).toBe(150);
    expect(s.getAntStatus("worker")?.recentOutput[0]).toBe("line 50");
  });

  it("pause() calls the control handle's pause()", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    s.register("worker", "claude-cli", controls);
    const ok = s.pause("worker");
    expect(ok).toBe(true);
    expect(controls.pause).toHaveBeenCalledTimes(1);
  });

  it("resume() calls the control handle's resume()", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    s.register("worker", "claude-cli", controls);
    const ok = s.resume("worker");
    expect(ok).toBe(true);
    expect(controls.resume).toHaveBeenCalledTimes(1);
  });

  it("pushPrompt() calls the control handle's pushPrompt() with default source", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    s.register("worker", "claude-cli", controls);
    const ok = s.pushPrompt("worker", "do the thing");
    expect(ok).toBe(true);
    expect(controls.pushPrompt).toHaveBeenCalledWith("do the thing", "manual");
  });

  it("pushPrompt() passes explicit source through to the control handle", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    s.register("worker", "claude-cli", controls);
    s.pushPrompt("worker", "from discord", "discord");
    expect(controls.pushPrompt).toHaveBeenCalledWith("from discord", "discord");
  });

  it("clearQueue() calls the control handle and returns count", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    // Manually push items to the internal queue
    controls._queue.push("a", "b", "c");
    s.register("worker", "claude-cli", controls);
    const cleared = s.clearQueue("worker");
    expect(cleared).toBe(3);
    expect(controls._queue.length).toBe(0);
  });

  it("returns false / 0 for unknown ant names", () => {
    const s = new ColonyState("c");
    expect(s.pause("unknown")).toBe(false);
    expect(s.resume("unknown")).toBe(false);
    expect(s.pushPrompt("unknown", "p")).toBe(false);
    expect(s.clearQueue("unknown")).toBe(0);
    expect(s.getAntStatus("unknown")).toBeUndefined();
  });

  it("getStatus queueSize reflects live queue size via control handle", () => {
    const s = new ColonyState("c");
    const controls = makeControls();
    s.register("worker", "claude-cli", controls);
    controls._queue.push("x", "y");
    expect(s.getStatus().ants[0].queueSize).toBe(2);
  });

  it("unregister() removes the ant from status and subscribers", () => {
    const s = new ColonyState("c");
    s.register("worker", "claude-cli", makeControls());
    expect(s.getStatus().ants).toHaveLength(1);
    const received: string[] = [];
    s.subscribeOutput("worker", (line) => received.push(line));
    s.unregister("worker");
    expect(s.getStatus().ants).toHaveLength(0);
    expect(s.getAntStatus("worker")).toBeUndefined();
    // Pushing output after unregister should not notify the old subscriber.
    s.pushOutput("worker", "ghost");
    expect(received).toHaveLength(0);
  });

  it("triggerReload() throws when no callback is set", async () => {
    const s = new ColonyState("c");
    await expect(s.triggerReload()).rejects.toThrow("not available");
  });

  it("triggerReload() calls the registered callback and returns its result", async () => {
    const s = new ColonyState("c");
    const result = { added: ["new-ant"], removed: [], updated: [] };
    s.setReloadCallback(async () => result);
    expect(await s.triggerReload()).toEqual(result);
  });
});
