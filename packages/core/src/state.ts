import { Database } from "bun:sqlite";

export type ConfirmationDecision = "approve" | "deny";

export interface ConfirmationOverride {
  pattern: string;
  decision: ConfirmationDecision;
}

export interface AntState {
  hasSeenIssue(antName: string, issueId: number): boolean;
  markIssueSeen(antName: string, issueId: number): void;
  getConfirmationOverrides(antName: string): ConfirmationOverride[];
  addConfirmationOverride(antName: string, pattern: string, decision: ConfirmationDecision): void;
  removeConfirmationOverride(antName: string, pattern: string): void;
  clearConfirmationOverrides(antName: string): void;
}

class MemoryState implements AntState {
  private readonly seen = new Map<string, Set<number>>();
  private readonly overrides = new Map<string, ConfirmationOverride[]>();

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

  getConfirmationOverrides(antName: string): ConfirmationOverride[] {
    return this.overrides.get(antName) ?? [];
  }

  addConfirmationOverride(antName: string, pattern: string, decision: ConfirmationDecision): void {
    const list = this.overrides.get(antName) ?? [];
    const idx = list.findIndex((o) => o.pattern === pattern);
    if (idx !== -1) {
      list[idx] = { pattern, decision };
    } else {
      list.push({ pattern, decision });
    }
    this.overrides.set(antName, list);
  }

  removeConfirmationOverride(antName: string, pattern: string): void {
    const list = this.overrides.get(antName) ?? [];
    this.overrides.set(antName, list.filter((o) => o.pattern !== pattern));
  }

  clearConfirmationOverrides(antName: string): void {
    this.overrides.delete(antName);
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
      CREATE TABLE IF NOT EXISTS confirmation_overrides (
        ant_name TEXT NOT NULL,
        pattern  TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approve','deny')),
        PRIMARY KEY (ant_name, pattern)
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

  getConfirmationOverrides(antName: string): ConfirmationOverride[] {
    return this.db
      .query<ConfirmationOverride, [string]>(
        "SELECT pattern, decision FROM confirmation_overrides WHERE ant_name = ?"
      )
      .all(antName);
  }

  addConfirmationOverride(antName: string, pattern: string, decision: ConfirmationDecision): void {
    this.db.run(
      "INSERT OR REPLACE INTO confirmation_overrides (ant_name, pattern, decision) VALUES (?, ?, ?)",
      [antName, pattern, decision]
    );
  }

  removeConfirmationOverride(antName: string, pattern: string): void {
    this.db.run(
      "DELETE FROM confirmation_overrides WHERE ant_name = ? AND pattern = ?",
      [antName, pattern]
    );
  }

  clearConfirmationOverrides(antName: string): void {
    this.db.run("DELETE FROM confirmation_overrides WHERE ant_name = ?", [antName]);
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
