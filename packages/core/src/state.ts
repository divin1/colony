import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";

const MAX_SESSIONS = 10;

export interface SessionRecord {
  id: string;
  antName: string;
  taskTitle: string | null;
  status: "completed" | "crashed" | "paused";
  summary: string | null;
  output: string[];
  startedAt: number;
  endedAt: number;
}

export interface AntState {
  /** Returns the closing summary from the most recent successful session, or null. */
  getLastSessionSummary(antName: string): string | null;
  /** Stores the closing summary for the given ant, overwriting any previous value. */
  setSessionSummary(antName: string, summary: string): void;
  /** Removes the stored summary for the given ant. */
  clearSessionSummary(antName: string): void;
  /** Saves a completed/crashed session to history (keeps last MAX_SESSIONS). */
  saveSession(record: Omit<SessionRecord, "id">): void;
  /** Returns session list for an ant, newest first. Output is not included. */
  listSessions(antName: string): Omit<SessionRecord, "output">[];
  /** Returns a single session with full output, or null if not found. */
  getSession(id: string): SessionRecord | null;
}

class MemoryState implements AntState {
  private readonly summaries = new Map<string, string>();
  private readonly sessions = new Map<string, Omit<SessionRecord, "output">[]>();
  private readonly outputs = new Map<string, string[]>();

  getLastSessionSummary(antName: string): string | null {
    return this.summaries.get(antName) ?? null;
  }

  setSessionSummary(antName: string, summary: string): void {
    this.summaries.set(antName, summary);
  }

  clearSessionSummary(antName: string): void {
    this.summaries.delete(antName);
  }

  saveSession(record: Omit<SessionRecord, "id">): void {
    const id = randomUUID();
    const { output, ...meta } = record;
    this.outputs.set(id, output);
    const list = this.sessions.get(record.antName) ?? [];
    list.unshift({ ...meta, id });
    if (list.length > MAX_SESSIONS) {
      const removed = list.splice(MAX_SESSIONS);
      for (const r of removed) this.outputs.delete(r.id);
    }
    this.sessions.set(record.antName, list);
  }

  listSessions(antName: string): Omit<SessionRecord, "output">[] {
    return this.sessions.get(antName) ?? [];
  }

  getSession(id: string): SessionRecord | null {
    for (const list of this.sessions.values()) {
      const meta = list.find((r) => r.id === id);
      if (meta) return { ...meta, output: this.outputs.get(id) ?? [] };
    }
    return null;
  }
}

class SQLiteState implements AntState {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        ant_name   TEXT PRIMARY KEY,
        summary    TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_history (
        id         TEXT PRIMARY KEY,
        ant_name   TEXT NOT NULL,
        task_title TEXT,
        status     TEXT NOT NULL,
        summary    TEXT,
        output     TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_history_ant
        ON session_history(ant_name, ended_at DESC);
    `);
  }

  getLastSessionSummary(antName: string): string | null {
    const row = this.db
      .query<{ summary: string }, [string]>(
        "SELECT summary FROM session_summaries WHERE ant_name = ?"
      )
      .get(antName);
    return row?.summary ?? null;
  }

  setSessionSummary(antName: string, summary: string): void {
    this.db.run(
      `INSERT INTO session_summaries (ant_name, summary, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(ant_name) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
      [antName, summary, Date.now()]
    );
  }

  clearSessionSummary(antName: string): void {
    this.db.run("DELETE FROM session_summaries WHERE ant_name = ?", [antName]);
  }

  saveSession(record: Omit<SessionRecord, "id">): void {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO session_history (id, ant_name, task_title, status, summary, output, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, record.antName, record.taskTitle ?? null, record.status,
       record.summary ?? null, JSON.stringify(record.output),
       record.startedAt, record.endedAt]
    );
    // Keep only the most recent MAX_SESSIONS per ant.
    this.db.run(
      `DELETE FROM session_history WHERE ant_name = ? AND id NOT IN (
         SELECT id FROM session_history WHERE ant_name = ?
         ORDER BY ended_at DESC LIMIT ?
       )`,
      [record.antName, record.antName, MAX_SESSIONS]
    );
  }

  listSessions(antName: string): Omit<SessionRecord, "output">[] {
    return this.db
      .query<{ id: string; ant_name: string; task_title: string | null; status: string; summary: string | null; started_at: number; ended_at: number }, [string]>(
        `SELECT id, ant_name, task_title, status, summary, started_at, ended_at
         FROM session_history WHERE ant_name = ? ORDER BY ended_at DESC`
      )
      .all(antName)
      .map((r) => ({
        id: r.id, antName: r.ant_name, taskTitle: r.task_title,
        status: r.status as SessionRecord["status"], summary: r.summary,
        startedAt: r.started_at, endedAt: r.ended_at,
      }));
  }

  getSession(id: string): SessionRecord | null {
    const r = this.db
      .query<{ id: string; ant_name: string; task_title: string | null; status: string; summary: string | null; output: string; started_at: number; ended_at: number }, [string]>(
        "SELECT * FROM session_history WHERE id = ?"
      )
      .get(id);
    if (!r) return null;
    let output: string[] = [];
    try { output = JSON.parse(r.output) as string[]; } catch { /* ignore */ }
    return {
      id: r.id, antName: r.ant_name, taskTitle: r.task_title,
      status: r.status as SessionRecord["status"], summary: r.summary,
      output, startedAt: r.started_at, endedAt: r.ended_at,
    };
  }
}

export function createState(
  backend: "memory" | "sqlite",
  path?: string
): AntState {
  if (backend === "sqlite") {
    return new SQLiteState(path ?? "./colony-state.db");
  }
  return new MemoryState();
}
