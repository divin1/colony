export interface ReloadResult {
  added: string[];
  removed: string[];
  updated: string[];
}

// "idle" = waiting for work (no tasks in queue); distinct from "paused" (human-paused).
export type AntRuntimeState = "starting" | "idle" | "running" | "paused" | "crashed" | "backoff";

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

export interface AntControlHandles {
  pause(): void;
  resume(): void;
  /** Signal the ant that a new task is available — wakes it from idle state. */
  wake(): void;
  /** Moves all queued (todo) tasks back to backlog. Returns count removed. */
  clearQueue(): number;
  /** Returns the number of todo tasks assigned to this ant. */
  getQueueSize(): number;
}

const MAX_RECENT_LINES = 150;

interface AntEntry {
  status: AntStatusEntry;
  controls: AntControlHandles;
}

export class ColonyState {
  private readonly entries = new Map<string, AntEntry>();
  private readonly subscribers = new Map<string, Set<(line: string) => void>>();
  private readonly _configDir: string | null;
  private reloadCallback: (() => Promise<ReloadResult>) | null = null;

  constructor(public readonly colonyName: string, configDir?: string) {
    this._configDir = configDir ?? null;
  }

  getConfigDir(): string | null {
    return this._configDir;
  }

  setReloadCallback(fn: () => Promise<ReloadResult>): void {
    this.reloadCallback = fn;
  }

  async triggerReload(): Promise<ReloadResult> {
    if (!this.reloadCallback) throw new Error("Hot reload is not available");
    return this.reloadCallback();
  }

  unregister(name: string): void {
    this.entries.delete(name);
    this.subscribers.delete(name);
  }

  register(name: string, engine: string, controls: AntControlHandles): void {
    this.entries.set(name, {
      status: {
        name, engine, state: "starting", queueSize: 0,
        sessionsCompleted: 0, sessionsCrashed: 0,
        startedAt: Date.now(), recentOutput: [],
      },
      controls,
    });
    this.subscribers.set(name, new Set());
  }

  setState(name: string, state: AntRuntimeState): void {
    const entry = this.entries.get(name);
    if (entry) entry.status.state = state;
  }

  incrementSessions(name: string, type: "completed" | "crashed"): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (type === "completed") entry.status.sessionsCompleted++;
    else entry.status.sessionsCrashed++;
  }

  pushOutput(name: string, text: string): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.status.recentOutput.push(text);
      if (entry.status.recentOutput.length > MAX_RECENT_LINES) {
        entry.status.recentOutput.shift();
      }
    }
    const subs = this.subscribers.get(name);
    if (subs) {
      for (const cb of subs) {
        try { cb(text); } catch { /* subscriber disconnected */ }
      }
    }
  }

  getStatus(): { colony: string; ants: AntStatusEntry[] } {
    return {
      colony: this.colonyName,
      ants: [...this.entries.values()].map((e) => ({
        ...e.status,
        queueSize: e.controls.getQueueSize(),
      })),
    };
  }

  getAntStatus(name: string): AntStatusEntry | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    return { ...entry.status, queueSize: entry.controls.getQueueSize() };
  }

  listAntNames(): string[] {
    return [...this.entries.keys()];
  }

  pause(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.controls.pause();
    return true;
  }

  resume(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.controls.resume();
    return true;
  }

  /** Signal the ant that a new task is available (wakes it from idle). */
  wake(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.controls.wake();
    return true;
  }

  clearQueue(name: string): number {
    const entry = this.entries.get(name);
    if (!entry) return 0;
    return entry.controls.clearQueue();
  }

  subscribeOutput(name: string, cb: (line: string) => void): () => void {
    const subs = this.subscribers.get(name) ?? new Set();
    this.subscribers.set(name, subs);
    subs.add(cb);
    return () => subs.delete(cb);
  }
}
