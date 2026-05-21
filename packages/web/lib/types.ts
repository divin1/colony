export type AntRuntimeState = "starting" | "idle" | "running" | "paused" | "crashed" | "backoff";

export interface SkillInfo {
  filename: string;
  name: string;
  description: string;
}
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type AssigneeType = "ant" | "human";
export type TaskSource = "manual" | "cron" | "discord";

export interface AntStatusEntry {
  name: string;
  engine: string;
  state: AntRuntimeState;
  queueSize: number;
  sessionsCompleted: number;
  sessionsCrashed: number;
  startedAt: number;
  recentOutput: string[];
  currentTaskId: string | null;
  lastError: string | null;
}

export interface ColonyStatus {
  colony: string;
  ants: AntStatusEntry[];
}

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

// Raw config types — values as written in YAML (env var templates unresolved).
export type AntEngine = "claude-cli" | "codex" | "gemini-cli" | "opencode" | "cli";

export interface RawAntConfig {
  name: string;
  description: string;
  instructions: string;
  engine?: AntEngine;
  cli?: { binary: string; args?: string[] };
  claude?: { model?: string; reasoning_effort?: "low" | "medium" | "high" };
  poll_interval?: string;
  state?: { backend?: "memory" | "sqlite"; path?: string };
  logging?: { lm_output?: "discord" | "console" | "both" };
  skills?: string[];
  schedule?: { cron: string };
  triggers?: Array<{ type: "discord_command" }>;
  integrations?: {
    discord?: { channel?: string };
  };
}

export interface RawColonyConfig {
  name: string;
  integrations?: {
    discord?: { token: string; guild: string };
    discord_webhook?: { url: string };
  };
  defaults?: {
    poll_interval?: string;
    git?: { user_name?: string; user_email?: string };
  };
  monitoring?: { port: number };
}
