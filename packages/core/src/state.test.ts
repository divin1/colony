import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { createState } from "./state";

describe("MemoryState", () => {
  it("returns null before any summary is stored", () => {
    const state = createState("memory");
    expect(state.getLastSessionSummary("worker")).toBeNull();
  });

  it("returns the stored summary after setSessionSummary", () => {
    const state = createState("memory");
    state.setSessionSummary("worker", "Completed PR #42.");
    expect(state.getLastSessionSummary("worker")).toBe("Completed PR #42.");
  });

  it("overwrites the previous summary on a second call", () => {
    const state = createState("memory");
    state.setSessionSummary("worker", "First summary.");
    state.setSessionSummary("worker", "Second summary.");
    expect(state.getLastSessionSummary("worker")).toBe("Second summary.");
  });

  it("scopes summaries per ant name", () => {
    const state = createState("memory");
    state.setSessionSummary("ant-a", "Summary A.");
    expect(state.getLastSessionSummary("ant-b")).toBeNull();
  });

  it("clears the summary on clearSessionSummary", () => {
    const state = createState("memory");
    state.setSessionSummary("worker", "Some summary.");
    state.clearSessionSummary("worker");
    expect(state.getLastSessionSummary("worker")).toBeNull();
  });
});

describe("SQLiteState", () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "colony-state-test-"));
    dbPath = join(dir, "state.db");
  });

  it("returns null before any summary is stored", () => {
    const state = createState("sqlite", dbPath);
    expect(state.getLastSessionSummary("worker")).toBeNull();
  });

  it("returns the stored summary after setSessionSummary", () => {
    const state = createState("sqlite", dbPath);
    state.setSessionSummary("worker", "Completed PR #42.");
    expect(state.getLastSessionSummary("worker")).toBe("Completed PR #42.");
  });

  it("overwrites the previous summary on a second call", () => {
    const state = createState("sqlite", dbPath);
    state.setSessionSummary("worker", "First summary.");
    state.setSessionSummary("worker", "Second summary.");
    expect(state.getLastSessionSummary("worker")).toBe("Second summary.");
  });

  it("scopes summaries per ant name", () => {
    const state = createState("sqlite", dbPath);
    state.setSessionSummary("ant-a", "Summary A.");
    expect(state.getLastSessionSummary("ant-b")).toBeNull();
  });

  it("persists summaries across instances (survives restart)", () => {
    const state1 = createState("sqlite", dbPath);
    state1.setSessionSummary("worker", "Completed task, opened PR #8.");

    const state2 = createState("sqlite", dbPath);
    expect(state2.getLastSessionSummary("worker")).toBe("Completed task, opened PR #8.");
  });

  it("clears the summary on clearSessionSummary", () => {
    const state = createState("sqlite", dbPath);
    state.setSessionSummary("worker", "Some summary.");
    state.clearSessionSummary("worker");
    expect(state.getLastSessionSummary("worker")).toBeNull();
  });
});
