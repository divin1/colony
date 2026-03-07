import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { createState } from "./state";

describe("MemoryState", () => {
  it("returns false for unseen issues", () => {
    const state = createState("memory");
    expect(state.hasSeenIssue("worker", 1)).toBe(false);
  });

  it("returns true after markIssueSeen", () => {
    const state = createState("memory");
    state.markIssueSeen("worker", 42);
    expect(state.hasSeenIssue("worker", 42)).toBe(true);
  });

  it("is scoped per ant name", () => {
    const state = createState("memory");
    state.markIssueSeen("ant-a", 1);
    expect(state.hasSeenIssue("ant-b", 1)).toBe(false);
  });

  it("is idempotent — marking twice does not throw", () => {
    const state = createState("memory");
    state.markIssueSeen("worker", 7);
    state.markIssueSeen("worker", 7);
    expect(state.hasSeenIssue("worker", 7)).toBe(true);
  });
});

describe("SQLiteState", () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "colony-state-test-"));
    dbPath = join(dir, "state.db");
  });

  it("returns false for unseen issues", () => {
    const state = createState("sqlite", dbPath);
    expect(state.hasSeenIssue("worker", 1)).toBe(false);
  });

  it("returns true after markIssueSeen", () => {
    const state = createState("sqlite", dbPath);
    state.markIssueSeen("worker", 42);
    expect(state.hasSeenIssue("worker", 42)).toBe(true);
  });

  it("persists across instances (survives restart)", () => {
    const state1 = createState("sqlite", dbPath);
    state1.markIssueSeen("worker", 99);

    // Simulate a restart by creating a fresh instance pointing at the same file.
    const state2 = createState("sqlite", dbPath);
    expect(state2.hasSeenIssue("worker", 99)).toBe(true);
  });

  it("is scoped per ant name", () => {
    const state = createState("sqlite", dbPath);
    state.markIssueSeen("ant-a", 1);
    expect(state.hasSeenIssue("ant-b", 1)).toBe(false);
  });

  it("is idempotent — marking twice does not throw", () => {
    const state = createState("sqlite", dbPath);
    state.markIssueSeen("worker", 7);
    state.markIssueSeen("worker", 7);
    expect(state.hasSeenIssue("worker", 7)).toBe(true);
  });
});
