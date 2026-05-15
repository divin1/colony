export interface AntStatus {
  name: string;
  engine: string;
  state: "starting" | "running" | "paused" | "crashed" | "backoff";
  queueSize: number;
  sessionsCompleted: number;
  sessionsCrashed: number;
  startedAt: number;
  recentOutput: string[];
}

export interface ColonyStatus {
  colony: string;
  ants: AntStatus[];
}

export class ColonyClient {
  constructor(
    private readonly baseUrl: string,
    // Injectable for testing — defaults to the global fetch.
    private readonly _fetch: typeof fetch = globalThis.fetch
  ) {}

  private async request(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this._fetch(url, options);
    } catch (err) {
      throw new Error(
        `Colony runner is not reachable at ${this.baseUrl}. ` +
        `Make sure the runner is active and monitoring.port is configured. ` +
        `(${(err as Error).message})`
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`Colony API ${res.status}: ${body}`);
    }
    return res;
  }

  async getStatus(): Promise<ColonyStatus> {
    const res = await this.request("/api/status");
    return res.json() as Promise<ColonyStatus>;
  }

  async prompt(ant: string, prompt: string): Promise<void> {
    await this.request(`/api/ants/${encodeURIComponent(ant)}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  }

  async pause(ant: string): Promise<void> {
    await this.request(`/api/ants/${encodeURIComponent(ant)}/pause`, { method: "POST" });
  }

  async resume(ant: string): Promise<void> {
    await this.request(`/api/ants/${encodeURIComponent(ant)}/resume`, { method: "POST" });
  }

  async clear(ant: string): Promise<{ cleared: number }> {
    const res = await this.request(`/api/ants/${encodeURIComponent(ant)}/clear`, { method: "POST" });
    return res.json() as Promise<{ cleared: number }>;
  }
}

// --- Response formatting ---

function formatUptime(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function formatStatus(status: ColonyStatus): string {
  if (status.ants.length === 0) {
    return `Colony "${status.colony}" — no ants running.`;
  }
  const lines = [`Colony: ${status.colony} (${status.ants.length} ant${status.ants.length === 1 ? "" : "s"})`];
  for (const ant of status.ants) {
    lines.push(
      `\n${ant.name}`,
      `  state:     ${ant.state}`,
      `  engine:    ${ant.engine}`,
      `  queue:     ${ant.queueSize}`,
      `  completed: ${ant.sessionsCompleted}  failed: ${ant.sessionsCrashed}`,
      `  uptime:    ${formatUptime(ant.startedAt)}`
    );
  }
  return lines.join("\n");
}
