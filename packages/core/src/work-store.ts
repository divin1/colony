import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import { join } from "path";

export type WorkItemStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type WorkItemSource = "manual" | "github_issue" | "cron" | "discord";
export type IssueContext = { owner: string; repo: string; number: number; repoSlug: string };

export interface PersistedWorkItem {
  id: string;
  antName: string;
  title: string;
  prompt: string;
  source: WorkItemSource;
  status: WorkItemStatus;
  issueContext?: IssueContext;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastOutput?: string;
}

interface RawRow {
  id: string;
  ant_name: string;
  title: string;
  prompt: string;
  source: string;
  status: string;
  issue_context: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  last_output: string | null;
}

function parseRow(row: RawRow): PersistedWorkItem {
  return {
    id: row.id,
    antName: row.ant_name,
    title: row.title,
    prompt: row.prompt,
    source: row.source as WorkItemSource,
    status: row.status as WorkItemStatus,
    issueContext: row.issue_context ? (JSON.parse(row.issue_context) as PersistedWorkItem["issueContext"]) : undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastOutput: row.last_output ?? undefined,
  };
}

export function workItemTitle(prompt: string): string {
  const firstLine = prompt.split("\n")[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

export interface WorkListFilter {
  status?: WorkItemStatus[];
  antName?: string;
  limit?: number;
  offset?: number;
}

export class WorkStore {
  private readonly db: Database;

  constructor(configDir: string) {
    this.db = new Database(join(configDir, "colony-work.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id           TEXT PRIMARY KEY,
        ant_name     TEXT NOT NULL,
        title        TEXT NOT NULL,
        prompt       TEXT NOT NULL,
        source       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'queued',
        issue_context TEXT,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        completed_at INTEGER,
        last_output  TEXT
      )
    `);
  }

  create(
    antName: string,
    prompt: string,
    source: WorkItemSource,
    issueContext?: PersistedWorkItem["issueContext"]
  ): PersistedWorkItem {
    const id = randomUUID();
    const createdAt = Date.now();
    const title = workItemTitle(prompt);
    const issueContextJson = issueContext ? JSON.stringify(issueContext) : null;

    this.db.run(
      `INSERT INTO work_items (id, ant_name, title, prompt, source, status, issue_context, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      [id, antName, title, prompt, source, issueContextJson, createdAt]
    );

    return { id, antName, title, prompt, source, status: "queued", issueContext, createdAt };
  }

  updateStatus(
    id: string,
    status: WorkItemStatus,
    timestamps?: { startedAt?: number; completedAt?: number }
  ): void {
    if (timestamps?.startedAt !== undefined && timestamps?.completedAt !== undefined) {
      this.db.run(
        "UPDATE work_items SET status = ?, started_at = ?, completed_at = ? WHERE id = ?",
        [status, timestamps.startedAt, timestamps.completedAt, id]
      );
    } else if (timestamps?.startedAt !== undefined) {
      this.db.run("UPDATE work_items SET status = ?, started_at = ? WHERE id = ?", [
        status,
        timestamps.startedAt,
        id,
      ]);
    } else if (timestamps?.completedAt !== undefined) {
      this.db.run("UPDATE work_items SET status = ?, completed_at = ? WHERE id = ?", [
        status,
        timestamps.completedAt,
        id,
      ]);
    } else {
      this.db.run("UPDATE work_items SET status = ? WHERE id = ?", [status, id]);
    }
  }

  setOutput(id: string, output: string): void {
    this.db.run("UPDATE work_items SET last_output = ? WHERE id = ?", [output, id]);
  }

  get(id: string): PersistedWorkItem | null {
    const row = this.db
      .query<RawRow, [string]>("SELECT * FROM work_items WHERE id = ?")
      .get(id);
    return row ? parseRow(row) : null;
  }

  list(filter: WorkListFilter = {}): PersistedWorkItem[] {
    const { status, antName, limit = 100, offset = 0 } = filter;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (status && status.length > 0) {
      conditions.push(`status IN (${status.map(() => "?").join(",")})`);
      params.push(...status);
    }
    if (antName) {
      conditions.push("ant_name = ?");
      params.push(antName);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    const rows = this.db
      .query<RawRow, (string | number)[]>(
        `SELECT * FROM work_items ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params);

    return rows.map(parseRow);
  }

  // Cancels a queued item. Returns false if not found or not in queued status.
  cancel(id: string): boolean {
    const item = this.get(id);
    if (!item || item.status !== "queued") return false;
    this.updateStatus(id, "cancelled");
    return true;
  }

  // Marks all queued items for an ant as cancelled (used on queue clear).
  cancelAllQueued(antName: string): void {
    this.db.run(
      "UPDATE work_items SET status = 'cancelled' WHERE ant_name = ? AND status = 'queued'",
      [antName]
    );
  }
}
