import { Database } from "bun:sqlite";

export interface AntState {
  hasSeenIssue(antName: string, issueId: number): boolean;
  markIssueSeen(antName: string, issueId: number): void;
}

class MemoryState implements AntState {
  private readonly seen = new Map<string, Set<number>>();

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
