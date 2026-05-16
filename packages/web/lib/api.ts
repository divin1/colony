import type { ColonyStatus, Project, Task, TaskComment, TaskStatus, AssigneeType, SkillInfo, RawColonyConfig, RawAntConfig } from "./types";
import { AuthError, getStoredKey } from "./auth";

const BASE = "";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = getStoredKey();
  return key ? { Authorization: `Bearer ${key}`, ...extra } : extra;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: authHeaders() });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: authHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

async function del(path: string): Promise<void> {
  const res = await fetch(BASE + path, { method: "DELETE", headers: authHeaders() });
  if (res.status === 401) throw new AuthError();
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${res.statusText}`);
}

async function put(path: string, body: unknown): Promise<{ restartRequired: boolean }> {
  const res = await fetch(BASE + path, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return { restartRequired: res.headers.get("x-colony-restart-required") === "true" };
}

async function postJson<T = void>(path: string, body: unknown): Promise<T & { restartRequired: boolean }> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return { ...(await res.json() as T), restartRequired: res.headers.get("x-colony-restart-required") === "true" };
}

async function deleteReq(path: string): Promise<{ restartRequired: boolean }> {
  const res = await fetch(BASE + path, { method: "DELETE", headers: authHeaders() });
  if (res.status === 401) throw new AuthError();
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return { restartRequired: res.headers.get("x-colony-restart-required") === "true" };
}

export const api = {
  status: () => get<ColonyStatus>("/api/status"),

  antPause: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/pause`),
  antResume: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/resume`),
  antClear: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/clear`),
  antPrompt: (name: string, prompt: string) =>
    post(`/api/ants/${encodeURIComponent(name)}/prompt`, { prompt }),

  // --- Projects ---
  projectList: () => get<Project[]>("/api/projects"),
  projectCreate: (name: string, description?: string, color?: string) =>
    postJson<Project>("/api/projects", { name, description, color }),
  projectGet: (id: string) => get<Project>(`/api/projects/${encodeURIComponent(id)}`),
  projectUpdate: (id: string, updates: Partial<Pick<Project, "name" | "description" | "color">>) =>
    put(`/api/projects/${encodeURIComponent(id)}`, updates),
  projectDelete: (id: string) => deleteReq(`/api/projects/${encodeURIComponent(id)}`),

  // --- Tasks ---
  taskList: (params?: { project?: string; assigneeType?: AssigneeType; assignee?: string; status?: TaskStatus[]; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.project) q.set("project", params.project);
    if (params?.assigneeType) q.set("assigneeType", params.assigneeType);
    if (params?.assignee) q.set("assignee", params.assignee);
    if (params?.status?.length) q.set("status", params.status.join(","));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<Task[]>(`/api/tasks${qs ? "?" + qs : ""}`);
  },
  taskCreate: (body: {
    projectId: string; title: string; description?: string;
    assigneeType?: AssigneeType; assigneeName?: string;
    source?: string; status?: TaskStatus;
  }) => postJson<Task>("/api/tasks", body),
  taskGet: (id: string) => get<Task>(`/api/tasks/${encodeURIComponent(id)}`),
  taskUpdate: (id: string, body: Partial<Pick<Task, "title" | "description" | "assigneeType" | "assigneeName" | "projectId" | "status">>) =>
    put(`/api/tasks/${encodeURIComponent(id)}`, body),
  taskPatch: async (id: string, patch: { status?: TaskStatus; position?: number; assigneeType?: AssigneeType; assigneeName?: string | null }): Promise<Task> => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<Task>;
  },
  taskDelete: (id: string) => deleteReq(`/api/tasks/${encodeURIComponent(id)}`),

  // --- Comments ---
  commentList: (taskId: string) => get<TaskComment[]>(`/api/tasks/${encodeURIComponent(taskId)}/comments`),
  commentAdd: (taskId: string, author: string, body: string) =>
    postJson<TaskComment>(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { author, body }),
  commentDelete: (taskId: string, commentId: string) =>
    deleteReq(`/api/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`),

  reload: async (): Promise<{ added: string[]; removed: string[]; updated: string[] }> => {
    const res = await fetch("/api/reload", { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text);
    }
    return res.json() as Promise<{ added: string[]; removed: string[]; updated: string[] }>;
  },

  configGet: () => get<RawColonyConfig>("/api/config"),
  configUpdate: (config: RawColonyConfig) => put("/api/config", config),

  configAntsGet: () => get<RawAntConfig[]>("/api/config/ants"),
  configAntGet: (name: string) => get<RawAntConfig>(`/api/config/ants/${encodeURIComponent(name)}`),
  configAntUpdate: (name: string, config: RawAntConfig) =>
    put(`/api/config/ants/${encodeURIComponent(name)}`, config),
  configAntCreate: (config: RawAntConfig) => postJson("/api/config/ants", config),
  configAntDelete: (name: string) => deleteReq(`/api/config/ants/${encodeURIComponent(name)}`),

  // --- Skills ---
  skillList: () => get<SkillInfo[]>("/api/skills"),
  skillGet: (filename: string) => get<{ filename: string; content: string }>(`/api/skills/${encodeURIComponent(filename)}`),
  skillSave: async (filename: string, content: string): Promise<{ filename: string }> => {
    const res = await fetch(`/api/skills/${encodeURIComponent(filename)}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content }),
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ filename: string }>;
  },
  skillDelete: (filename: string) => deleteReq(`/api/skills/${encodeURIComponent(filename)}`),
};
