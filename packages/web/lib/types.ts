export type AntRuntimeState = "starting" | "running" | "paused" | "crashed" | "backoff";
export type WorkItemStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type WorkItemSource = "manual" | "github_issue" | "cron" | "discord";

export interface AntStatusEntry {
  name: string;
  engine: string;
  state: AntRuntimeState;
  queueSize: number;
  sessionsCompleted: number;
  sessionsCrashed: number;
  startedAt: number;
  recentOutput: string[];
}

export interface ColonyStatus {
  colony: string;
  ants: AntStatusEntry[];
}

export interface PersistedWorkItem {
  id: string;
  antName: string;
  title: string;
  prompt: string;
  source: WorkItemSource;
  status: WorkItemStatus;
  issueContext?: { owner: string; repo: string; number: number; repoSlug: string };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastOutput?: string;
}
