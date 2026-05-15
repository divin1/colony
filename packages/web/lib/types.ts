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

// Raw config types — values are as written in YAML (env var templates unresolved).
// Used by the config editor; never passed to the runner directly.

export type AntEngine = "claude-cli" | "codex" | "gemini-cli" | "opencode" | "cli";

export interface RawAntConfig {
  name: string;
  description: string;
  instructions: string;
  engine?: AntEngine;
  cli?: { binary: string; args?: string[] };
  poll_interval?: string;
  state?: { backend?: "memory" | "sqlite"; path?: string };
  logging?: { lm_output?: "discord" | "console" | "both" };
  skills?: string[];
  schedule?: { cron: string };
  triggers?: Array<
    | { type: "github_issue"; labels?: string[] }
    | { type: "discord_command" }
  >;
  integrations?: {
    github?: { repos?: string[] };
    discord?: { channel?: string };
  };
}

export interface RawColonyConfig {
  name: string;
  integrations?: {
    discord?: { token: string; guild: string };
    discord_webhook?: { url: string };
    github?: { token: string };
  };
  defaults?: {
    poll_interval?: string;
    git?: { user_name?: string; user_email?: string };
  };
  monitoring?: { port: number };
}
