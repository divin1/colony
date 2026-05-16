import type { ColonyStatus, PersistedWorkItem, WorkItemStatus, RawColonyConfig, RawAntConfig } from "./types";
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
  workReorder: async (id: string, position: number): Promise<void> => {
    const res = await fetch(`/api/work/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ position }),
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  },

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
};
