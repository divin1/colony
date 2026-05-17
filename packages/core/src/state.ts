import { Database } from "bun:sqlite";

export interface AntState {
  hasSeenIssue(antName: string, issueId: number): boolean;
  markIssueSeen(antName: string, issueId: number): void;
  /** Returns the closing summary from the most recent successful session, or null. */
  getLastSessionSummary(antName: string): string | null;
  /** Stores the closing summary for the given ant, overwriting any previous value. */
  setSessionSummary(antName: string, summary: string): void;
  /** Removes the stored summary for the given ant. */
  clearSessionSummary(antName: string): void;
}

class MemoryState implements AntState {
  private readonly seen = new Map<string, Set<number>>();
  private readonly summaries = new Map<string, string>();

  hasSeenIssue(antName: string, issueId: number): boolean {
    return this.seen.get(antName)?.has(issueId) ?? false;
  }

  markIssueSeen(antName: string, issueId: number): void {
    let set = this.seen.get(antName);
    if (!set) {
      set = new Set();
      this.seen.set(antName, set);
    }
    set.add(issueId);
  }

  getLastSessionSummary(antName: string): string | null {
    return this.summaries.get(antName) ?? null;
  }

  setSessionSummary(antName: string, summary: string): void {
    this.summaries.set(antName, summary);
  }

  clearSessionSummary(antName: string): void {
    this.summaries.delete(antName);
  }
}

class SQLiteState implements AntState {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_issues (
        ant_name TEXT NOT NULL,
        issue_id  INTEGER NOT NULL,
        PRIMARY KEY (ant_name, issue_id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        ant_name   TEXT PRIMARY KEY,
        summary    TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  hasSeenIssue(antName: string, issueId: number): boolean {
    const row = this.db
      .query<{ found: number }, [string, number]>(
        "SELECT 1 AS found FROM seen_issues WHERE ant_name = ? AND issue_id = ?"
      )
      .get(antName, issueId);
    return row !== null;
  }

  markIssueSeen(antName: string, issueId: number): void {
    this.db.run(
      "INSERT OR IGNORE INTO seen_issues (ant_name, issue_id) VALUES (?, ?)",
      [antName, issueId]
    );
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
