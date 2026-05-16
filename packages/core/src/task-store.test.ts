import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { TaskStore, taskTitle } from "./task-store";

describe("taskTitle", () => {
  it("returns the first line of a string", () => {
    expect(taskTitle("Fix the bug\nMore detail")).toBe("Fix the bug");
  });
  it("truncates long first lines", () => {
    const t = taskTitle("a".repeat(100));
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("TaskStore — projects", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-task-test-`);
    store = new TaskStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates and retrieves a project", () => {
    const p = store.createProject("My Project", "desc", "#ff0000");
    expect(p.name).toBe("My Project");
    expect(p.description).toBe("desc");
    expect(p.color).toBe("#ff0000");
    expect(store.getProject(p.id)).toMatchObject({ name: "My Project" });
  });

  it("listProjects returns all projects in creation order", () => {
    store.createProject("A");
    store.createProject("B");
    const names = store.listProjects().map((p) => p.name);
    expect(names).toEqual(["A", "B"]);
  });

  it("updateProject changes fields", () => {
    const p = store.createProject("Old");
    store.updateProject(p.id, { name: "New", color: "#abc" });
    expect(store.getProject(p.id)!.name).toBe("New");
    expect(store.getProject(p.id)!.color).toBe("#abc");
  });

  it("deleteProject removes the project and its tasks/comments", () => {
    const p = store.createProject("P");
    const t = store.createTask({ projectId: p.id, title: "T", description: "", assigneeType: "human" });
    store.addComment(t.id, "Human", "hi");
    store.deleteProject(p.id);
    expect(store.getProject(p.id)).toBeNull();
    expect(store.getTask(t.id)).toBeNull();
    expect(store.listComments(t.id)).toHaveLength(0);
  });

  it("getOrCreateDefaultProject creates and caches a Default project", () => {
    const d1 = store.getOrCreateDefaultProject();
    const d2 = store.getOrCreateDefaultProject();
    expect(d1.id).toBe(d2.id);
    expect(d1.name).toBe("Default");
    expect(store.listProjects()).toHaveLength(1);
  });
});

describe("TaskStore — tasks", () => {
  let dir: string;
  let store: TaskStore;
  let projectId: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-task-test-`);
    store = new TaskStore(dir);
    projectId = store.createProject("P").id;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function createTask(title: string, assigneeName?: string) {
    return store.createTask({
      projectId,
      title,
      description: `Desc for ${title}`,
      assigneeType: assigneeName ? "ant" : "human",
      assigneeName,
    });
  }

  it("creates a task with default todo status", () => {
    const t = createTask("Fix bug", "worker");
    expect(t.status).toBe("todo");
    expect(t.assigneeType).toBe("ant");
    expect(t.assigneeName).toBe("worker");
  });

  it("creates a human task with backlog status when no status given", () => {
    const t = store.createTask({
      projectId, title: "Human task", description: "", assigneeType: "human",
    });
    expect(t.status).toBe("todo"); // TaskStore default is "todo"
  });

  it("get() returns null for unknown id", () => {
    expect(store.getTask("no-such")).toBeNull();
  });

  it("setStatus transitions task status", () => {
    const t = createTask("T", "worker");
    store.setStatus(t.id, "in_progress", { startedAt: Date.now() });
    expect(store.getTask(t.id)!.status).toBe("in_progress");
    expect(store.getTask(t.id)!.startedAt).toBeGreaterThan(0);
  });

  it("setOutput stores last output", () => {
    const t = createTask("T", "worker");
    store.setOutput(t.id, "Done!");
    expect(store.getTask(t.id)!.lastOutput).toBe("Done!");
  });

  it("updateTask changes fields", () => {
    const t = createTask("Old title", "worker");
    store.updateTask(t.id, { title: "New title", description: "updated" });
    const updated = store.getTask(t.id)!;
    expect(updated.title).toBe("New title");
    expect(updated.description).toBe("updated");
  });

  it("deleteTask removes task and its comments", () => {
    const t = createTask("T");
    store.addComment(t.id, "Human", "hi");
    store.deleteTask(t.id);
    expect(store.getTask(t.id)).toBeNull();
    expect(store.listComments(t.id)).toHaveLength(0);
  });

  it("new tasks go to the end of their assignee group", () => {
    createTask("First", "worker");
    createTask("Second", "worker");
    createTask("Third", "worker");
    const order = store.listTodo("worker").map((t) => t.title);
    expect(order).toEqual(["First", "Second", "Third"]);
  });

  it("listTodo only returns todo tasks for the given ant", () => {
    createTask("A", "worker");
    createTask("B", "reviewer");
    createTask("C", "worker");
    const workerTasks = store.listTodo("worker").map((t) => t.title);
    expect(workerTasks).toEqual(["A", "C"]);
  });

  it("countTodo returns correct count", () => {
    createTask("A", "worker");
    createTask("B", "worker");
    expect(store.countTodo("worker")).toBe(2);
    expect(store.countTodo("reviewer")).toBe(0);
  });

  it("cancelAllTodo moves todo tasks to backlog and returns count", () => {
    createTask("A", "worker");
    createTask("B", "worker");
    const count = store.cancelAllTodo("worker");
    expect(count).toBe(2);
    expect(store.countTodo("worker")).toBe(0);
    const tasks = store.listTasks({ assigneeName: "worker" });
    expect(tasks.every((t) => t.status === "backlog")).toBe(true);
  });

  it("reorder moves a task to the front", () => {
    createTask("A", "worker");
    createTask("B", "worker");
    const c = createTask("C", "worker");
    store.reorder(c.id, 0);
    const order = store.listTodo("worker").map((t) => t.title);
    expect(order).toEqual(["C", "A", "B"]);
  });

  it("reorder moves a task to the end", () => {
    const a = createTask("A", "worker");
    createTask("B", "worker");
    createTask("C", "worker");
    store.reorder(a.id, 99);
    const order = store.listTodo("worker").map((t) => t.title);
    expect(order).toEqual(["B", "C", "A"]);
  });

  it("reorder returns false for unknown task", () => {
    expect(store.reorder("bad-id", 0)).toBe(false);
  });

  it("listTasks filters by project and status", () => {
    const p2 = store.createProject("P2");
    createTask("In P", "worker");
    store.createTask({ projectId: p2.id, title: "In P2", description: "", assigneeType: "ant", assigneeName: "worker" });
    expect(store.listTasks({ projectId }).map((t) => t.title)).toEqual(["In P"]);
  });
});

describe("TaskStore — comments", () => {
  let dir: string;
  let store: TaskStore;
  let taskId: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-task-test-`);
    store = new TaskStore(dir);
    const p = store.createProject("P");
    taskId = store.createTask({ projectId: p.id, title: "T", description: "", assigneeType: "human" }).id;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds and lists comments in chronological order", () => {
    store.addComment(taskId, "Human", "first");
    store.addComment(taskId, "worker", "second");
    const comments = store.listComments(taskId);
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toBe("first");
    expect(comments[1].author).toBe("worker");
  });

  it("deleteComment removes the comment", () => {
    const c = store.addComment(taskId, "Human", "bye");
    expect(store.deleteComment(c.id)).toBe(true);
    expect(store.listComments(taskId)).toHaveLength(0);
  });

  it("deleteComment returns false for unknown id", () => {
    expect(store.deleteComment("bad-id")).toBe(false);
  });
});
