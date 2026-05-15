import type { ColonyStatus, PersistedWorkItem, WorkItemStatus } from "./types";

const BASE = "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

async function del(path: string): Promise<void> {
  const res = await fetch(BASE + path, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${res.statusText}`);
}

export const api = {
  status: () => get<ColonyStatus>("/api/status"),

  antPause: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/pause`),
  antResume: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/resume`),
  antClear: (name: string) => post(`/api/ants/${encodeURIComponent(name)}/clear`),
  antPrompt: (name: string, prompt: string) =>
    post(`/api/ants/${encodeURIComponent(name)}/prompt`, { prompt }),

  workList: (params?: { status?: WorkItemStatus[]; ant?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status?.length) q.set("status", params.status.join(","));
    if (params?.ant) q.set("ant", params.ant);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<PersistedWorkItem[]>(`/api/work${qs ? "?" + qs : ""}`);
  },

  workGet: (id: string) => get<PersistedWorkItem>(`/api/work/${id}`),
  workCancel: (id: string) => del(`/api/work/${id}`),
};
