import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { WorkStore, workItemTitle } from "./work-store";

describe("workItemTitle", () => {
  it("returns the first line of a prompt", () => {
    expect(workItemTitle("Fix the bug\nMore details here")).toBe("Fix the bug");
  });

  it("truncates long first lines and ends with ellipsis", () => {
    const long = "a".repeat(100);
    const title = workItemTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("handles single-line prompts", () => {
    expect(workItemTitle("Short prompt")).toBe("Short prompt");
  });
});

describe("WorkStore", () => {
  let dir: string;
  let store: WorkStore;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-work-test-`);
    store = new WorkStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a work item with queued status", () => {
    const item = store.create("worker", "Do the thing", "manual");
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.antName).toBe("worker");
    expect(item.title).toBe("Do the thing");
    expect(item.status).toBe("queued");
    expect(item.source).toBe("manual");
    expect(item.createdAt).toBeGreaterThan(0);
  });

  it("get() returns a created item", () => {
    const created = store.create("worker", "Hello", "cron");
    const fetched = store.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.prompt).toBe("Hello");
  });

  it("get() returns null for unknown id", () => {
    expect(store.get("non-existent-id")).toBeNull();
  });

  it("updateStatus() changes status and timestamps", () => {
    const item = store.create("worker", "Work", "manual");
    const startedAt = Date.now();
    store.updateStatus(item.id, "running", { startedAt });
    const updated = store.get(item.id)!;
    expect(updated.status).toBe("running");
    expect(updated.startedAt).toBe(startedAt);
  });

  it("setOutput() stores the last output", () => {
    const item = store.create("worker", "Task", "github_issue");
    store.setOutput(item.id, "Completed task successfully.");
    expect(store.get(item.id)!.lastOutput).toBe("Completed task successfully.");
  });

  it("cancel() marks a queued item as cancelled", () => {
    const item = store.create("worker", "Cancel me", "manual");
    expect(store.cancel(item.id)).toBe(true);
    expect(store.get(item.id)!.status).toBe("cancelled");
  });

  it("cancel() returns false for non-queued items", () => {
    const item = store.create("worker", "Running", "manual");
    store.updateStatus(item.id, "running");
    expect(store.cancel(item.id)).toBe(false);
  });

  it("cancelAllQueued() cancels all queued items for an ant", () => {
    const a = store.create("ant-a", "Task 1", "cron");
    const b = store.create("ant-a", "Task 2", "cron");
    store.create("ant-b", "Task 3", "cron");
    store.cancelAllQueued("ant-a");
    expect(store.get(a.id)!.status).toBe("cancelled");
    expect(store.get(b.id)!.status).toBe("cancelled");
    // ant-b item should be unaffected
    expect(store.list({ antName: "ant-b" })[0].status).toBe("queued");
  });

  it("list() returns queued items in insertion (position) order", () => {
    store.create("worker", "First", "manual");
    store.create("worker", "Second", "cron");
    store.create("worker", "Third", "discord");
    const items = store.list({ status: ["queued"] });
    expect(items[0].title).toBe("First");
    expect(items[2].title).toBe("Third");
  });

  it("list() returns non-queued items in descending createdAt order", () => {
    const a = store.create("worker", "First", "manual");
    const b = store.create("worker", "Second", "cron");
    store.updateStatus(a.id, "done");
    store.updateStatus(b.id, "done");
    const items = store.list({ status: ["done"] });
    expect(items[0].title).toBe("Second");
    expect(items[1].title).toBe("First");
  });

  it("list() filters by status", () => {
    const a = store.create("worker", "A", "manual");
    store.create("worker", "B", "manual");
    store.updateStatus(a.id, "done");
    const done = store.list({ status: ["done"] });
    expect(done).toHaveLength(1);
    expect(done[0].id).toBe(a.id);
  });

  it("list() filters by antName", () => {
    store.create("ant-1", "Task 1", "manual");
    store.create("ant-2", "Task 2", "manual");
    const results = store.list({ antName: "ant-1" });
    expect(results).toHaveLength(1);
    expect(results[0].antName).toBe("ant-1");
  });

  it("reorder() moves an item to the front", () => {
    const a = store.create("worker", "First", "manual");
    const b = store.create("worker", "Second", "manual");
    const c = store.create("worker", "Third", "manual");
    expect(store.reorder(c.id, 0)).toBe(true);
    const order = store.list({ status: ["queued"] }).map((i) => i.title);
    expect(order).toEqual(["Third", "First", "Second"]);
  });

  it("reorder() moves an item to the end", () => {
    const a = store.create("worker", "First", "manual");
    store.create("worker", "Second", "manual");
    store.create("worker", "Third", "manual");
    store.reorder(a.id, 99);
    const order = store.list({ status: ["queued"] }).map((i) => i.title);
    expect(order).toEqual(["Second", "Third", "First"]);
  });

  it("reorder() moves an item to the middle", () => {
    const a = store.create("worker", "First", "manual");
    store.create("worker", "Second", "manual");
    store.create("worker", "Third", "manual");
    store.reorder(a.id, 1);
    const order = store.list({ status: ["queued"] }).map((i) => i.title);
    expect(order).toEqual(["Second", "First", "Third"]);
  });

  it("reorder() returns false for non-queued items", () => {
    const a = store.create("worker", "Task", "manual");
    store.updateStatus(a.id, "running");
    expect(store.reorder(a.id, 0)).toBe(false);
  });

  it("reorder() returns false for unknown id", () => {
    expect(store.reorder("no-such-id", 0)).toBe(false);
  });

  it("new items go to the end of the queue", () => {
    store.create("worker", "First", "manual");
    store.create("worker", "Second", "manual");
    store.create("worker", "Third", "manual");
    const order = store.list({ status: ["queued"] }).map((i) => i.title);
    expect(order).toEqual(["First", "Second", "Third"]);
  });

  it("stores and retrieves issueContext", () => {
    const ctx = { owner: "acme", repo: "app", number: 42, repoSlug: "acme/app" };
    const item = store.create("worker", "Fix issue", "github_issue", ctx);
    const fetched = store.get(item.id)!;
    expect(fetched.issueContext).toEqual(ctx);
  });
});
