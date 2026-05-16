import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import { join } from "path";
import type { IssueContext } from "./work-store.js";

export type { IssueContext };

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type AssigneeType = "ant" | "human";
export type TaskSource = "manual" | "github_issue" | "cron" | "discord";

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string | null;
  createdAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeType: AssigneeType;
  assigneeName: string | null;
  position: number;
  source: TaskSource;
  issueContext: IssueContext | null;
  lastOutput: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: number;
}

interface RawProject {
  id: string; name: string; description: string; color: string | null; created_at: number;
}
interface RawTask {
  id: string; project_id: string; title: string; description: string; status: string;
  assignee_type: string; assignee_name: string | null; position: number; source: string;
  issue_context: string | null; last_output: string | null;
  created_at: number; updated_at: number; started_at: number | null; completed_at: number | null;
}
interface RawComment {
  id: string; task_id: string; author: string; body: string; created_at: number;
}

function parseProject(r: RawProject): Project {
  return { id: r.id, name: r.name, description: r.description, color: r.color, createdAt: r.created_at };
}

function parseTask(r: RawTask): Task {
  return {
    id: r.id, projectId: r.project_id, title: r.title, description: r.description,
    status: r.status as TaskStatus, assigneeType: r.assignee_type as AssigneeType,
    assigneeName: r.assignee_name, position: r.position, source: r.source as TaskSource,
    issueContext: r.issue_context ? (JSON.parse(r.issue_context) as IssueContext) : null,
    lastOutput: r.last_output, createdAt: r.created_at, updatedAt: r.updated_at,
    startedAt: r.started_at, completedAt: r.completed_at,
  };
}

function parseComment(r: RawComment): TaskComment {
  return { id: r.id, taskId: r.task_id, author: r.author, body: r.body, createdAt: r.created_at };
}

export function taskTitle(text: string): string {
  const first = text.split("\n")[0].trim();
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
}

export interface TaskListFilter {
  projectId?: string;
  assigneeType?: AssigneeType;
  assigneeName?: string;
  status?: TaskStatus[];
  limit?: number;
  offset?: number;
}

export class TaskStore {
  private readonly db: Database;
  private defaultProjectId: string | null = null;

  constructor(configDir: string) {
    this.db = new Database(join(configDir, "colony-tasks.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color       TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL REFERENCES projects(id),
        title          TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'backlog',
        assignee_type  TEXT NOT NULL DEFAULT 'human',
        assignee_name  TEXT,
        position       INTEGER NOT NULL DEFAULT 0,
        source         TEXT NOT NULL DEFAULT 'manual',
        issue_context  TEXT,
        last_output    TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        started_at     INTEGER,
        completed_at   INTEGER
      );

      CREATE TABLE IF NOT EXISTS task_comments (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES tasks(id),
        author     TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // --- Projects ---

  createProject(name: string, description = "", color?: string): Project {
    const id = randomUUID();
    const now = Date.now();
    this.db.run(
      "INSERT INTO projects (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, name, description, color ?? null, now]
    );
    return { id, name, description, color: color ?? null, createdAt: now };
  }

  getProject(id: string): Project | null {
    const r = this.db.query<RawProject, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
    return r ? parseProject(r) : null;
  }

  listProjects(): Project[] {
    return this.db
      .query<RawProject, []>("SELECT * FROM projects ORDER BY created_at ASC")
      .all()
      .map(parseProject);
  }

  updateProject(id: string, updates: Partial<Pick<Project, "name" | "description" | "color">>): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
    if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
    if ("color" in updates) { sets.push("color = ?"); params.push(updates.color ?? null); }
    if (sets.length === 0) return false;
    params.push(id);
    const result = this.db.run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params);
    return result.changes > 0;
  }

  deleteProject(id: string): boolean {
    // Cascade: delete comments first, then tasks, then project
    this.db.transaction(() => {
      this.db.run("DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)", [id]);
      this.db.run("DELETE FROM tasks WHERE project_id = ?", [id]);
      this.db.run("DELETE FROM projects WHERE id = ?", [id]);
    })();
    return true;
  }

  // Returns (or creates) the special "Default" project for automated tasks.
  getOrCreateDefaultProject(): Project {
    if (this.defaultProjectId) {
      const p = this.getProject(this.defaultProjectId);
      if (p) return p;
    }
    const existing = this.db
      .query<RawProject, [string]>("SELECT * FROM projects WHERE name = ? ORDER BY created_at ASC LIMIT 1")
      .get("Default");
    if (existing) {
      this.defaultProjectId = existing.id;
      return parseProject(existing);
    }
    const p = this.createProject("Default", "Automatically created tasks (Discord, cron, manual prompts)");
    this.defaultProjectId = p.id;
    return p;
  }

  // --- Tasks ---

  createTask(opts: {
    projectId: string;
    title: string;
    description: string;
    assigneeType: AssigneeType;
    assigneeName?: string;
    source?: TaskSource;
    issueContext?: IssueContext;
    status?: TaskStatus;
  }): Task {
    const id = randomUUID();
    const now = Date.now();
    const status = opts.status ?? "todo";
    const assigneeName = opts.assigneeName ?? null;
    const source = opts.source ?? "manual";
    const issueContextJson = opts.issueContext ? JSON.stringify(opts.issueContext) : null;

    // Position: end of this ant/status group
    const pos = (this.db
      .query<{ m: number | null }, [string, string, string | null]>(
        "SELECT MAX(position) as m FROM tasks WHERE project_id = ? AND status = ? AND assignee_name IS ?"
      )
      .get(opts.projectId, status, assigneeName)?.m ?? -1) + 1;

    this.db.run(
      `INSERT INTO tasks (id, project_id, title, description, status, assignee_type, assignee_name,
         position, source, issue_context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, opts.projectId, opts.title, opts.description, status, opts.assigneeType,
       assigneeName, pos, source, issueContextJson, now, now]
    );

    return {
      id, projectId: opts.projectId, title: opts.title, description: opts.description,
      status, assigneeType: opts.assigneeType, assigneeName, position: pos, source,
      issueContext: opts.issueContext ?? null, lastOutput: null,
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
    };
  }

  getTask(id: string): Task | null {
    const r = this.db.query<RawTask, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
    return r ? parseTask(r) : null;
  }

  listTasks(filter: TaskListFilter = {}): Task[] {
    const { projectId, assigneeType, assigneeName, status, limit = 100, offset = 0 } = filter;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (projectId) { conditions.push("project_id = ?"); params.push(projectId); }
    if (assigneeType) { conditions.push("assignee_type = ?"); params.push(assigneeType); }
    if (assigneeName !== undefined) { conditions.push("assignee_name = ?"); params.push(assigneeName); }
    if (status?.length) {
      conditions.push(`status IN (${status.map(() => "?").join(",")})`);
      params.push(...status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    return this.db
      .query<RawTask, unknown[]>(
        `SELECT * FROM tasks ${where} ORDER BY position ASC, created_at ASC LIMIT ? OFFSET ?`
      )
      .all(...params)
      .map(parseTask);
  }

  updateTask(id: string, updates: {
    title?: string; description?: string;
    assigneeType?: AssigneeType; assigneeName?: string | null; projectId?: string;
  }): boolean {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [Date.now()];
    if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
    if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
    if (updates.assigneeType !== undefined) { sets.push("assignee_type = ?"); params.push(updates.assigneeType); }
    if ("assigneeName" in updates) { sets.push("assignee_name = ?"); params.push(updates.assigneeName ?? null); }
    if (updates.projectId !== undefined) { sets.push("project_id = ?"); params.push(updates.projectId); }
    params.push(id);
    const result = this.db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
    return result.changes > 0;
  }

  setStatus(
    id: string,
    status: TaskStatus,
    timestamps?: { startedAt?: number; completedAt?: number }
  ): boolean {
    const now = Date.now();
    const sets = ["status = ?", "updated_at = ?"];
    const params: unknown[] = [status, now];
    if (timestamps?.startedAt !== undefined) { sets.push("started_at = ?"); params.push(timestamps.startedAt); }
    if (timestamps?.completedAt !== undefined) { sets.push("completed_at = ?"); params.push(timestamps.completedAt); }
    params.push(id);
    const result = this.db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
    return result.changes > 0;
  }

  setOutput(id: string, output: string): boolean {
    const result = this.db.run(
      "UPDATE tasks SET last_output = ?, updated_at = ? WHERE id = ?",
      [output, Date.now(), id]
    );
    return result.changes > 0;
  }

  reorder(id: string, newIndex: number): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const ids = this.db
      .query<{ id: string }, [string, string, string | null]>(
        `SELECT id FROM tasks WHERE project_id = ? AND status = ? AND assignee_name IS ?
         ORDER BY position ASC`
      )
      .all(task.projectId, task.status, task.assigneeName)
      .map((r) => r.id);

    const oldIdx = ids.indexOf(id);
    if (oldIdx === -1) return false;
    ids.splice(oldIdx, 1);
    ids.splice(Math.max(0, Math.min(newIndex, ids.length)), 0, id);

    const stmt = this.db.prepare("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?");
    const now = Date.now();
    this.db.transaction(() => {
      ids.forEach((tid, pos) => stmt.run(pos, now, tid));
    })();
    return true;
  }

  deleteTask(id: string): boolean {
    this.db.transaction(() => {
      this.db.run("DELETE FROM task_comments WHERE task_id = ?", [id]);
      this.db.run("DELETE FROM tasks WHERE id = ?", [id]);
    })();
    return true;
  }

  // --- Runner helpers ---

  // Returns todo tasks assigned to a specific ant, ordered by position.
  listTodo(antName: string): Task[] {
    return this.db
      .query<RawTask, [string]>(
        "SELECT * FROM tasks WHERE assignee_type = 'ant' AND assignee_name = ? AND status = 'todo' ORDER BY position ASC, created_at ASC"
      )
      .all(antName)
      .map(parseTask);
  }

  countTodo(antName: string): number {
    return (this.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) as n FROM tasks WHERE assignee_type = 'ant' AND assignee_name = ? AND status = 'todo'"
      )
      .get(antName)?.n ?? 0);
  }

  // Moves all todo tasks for an ant back to backlog (queue clear). Returns count.
  cancelAllTodo(antName: string): number {
    const now = Date.now();
    const result = this.db.run(
      "UPDATE tasks SET status = 'backlog', updated_at = ? WHERE assignee_type = 'ant' AND assignee_name = ? AND status = 'todo'",
      [now, antName]
    );
    return result.changes;
  }

  // --- Comments ---

  listComments(taskId: string): TaskComment[] {
    return this.db
      .query<RawComment, [string]>("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId)
      .map(parseComment);
  }

  addComment(taskId: string, author: string, body: string): TaskComment {
    const id = randomUUID();
    const now = Date.now();
    this.db.run(
      "INSERT INTO task_comments (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, taskId, author, body, now]
    );
    this.db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [now, taskId]);
    return { id, taskId, author, body, createdAt: now };
  }

  deleteComment(id: string): boolean {
    const result = this.db.run("DELETE FROM task_comments WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
