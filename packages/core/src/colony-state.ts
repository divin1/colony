import type { WorkStore, WorkItemSource } from "./work-store.js";

export type AntRuntimeState = "starting" | "running" | "paused" | "crashed" | "backoff";

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
  pushPrompt(prompt: string, source?: WorkItemSource): void;
  clearQueue(): number;
  getQueueSize(): number;
  removeWorkItem(id: string): boolean;
}

const MAX_RECENT_LINES = 150;

interface AntEntry {
  status: AntStatusEntry;
  controls: AntControlHandles;
}

export class ColonyState {
  private readonly entries = new Map<string, AntEntry>();
  private readonly subscribers = new Map<string, Set<(line: string) => void>>();
  private readonly workStore: WorkStore | null;

  constructor(public readonly colonyName: string, workStore?: WorkStore) {
    this.workStore = workStore ?? null;
  }

  register(name: string, engine: string, controls: AntControlHandles): void {
    this.entries.set(name, {
      status: {
        name,
        engine,
        state: "starting",
        queueSize: 0,
        sessionsCompleted: 0,
        sessionsCrashed: 0,
        startedAt: Date.now(),
        recentOutput: [],
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

  pushPrompt(name: string, prompt: string, source: WorkItemSource = "manual"): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.controls.pushPrompt(prompt, source);
    return true;
  }

  clearQueue(name: string): number {
    const entry = this.entries.get(name);
    if (!entry) return 0;
    return entry.controls.clearQueue();
  }

  cancelWorkItem(id: string): "cancelled" | "running" | "not_found" {
    if (!this.workStore) return "not_found";
    const item = this.workStore.get(id);
    if (!item) return "not_found";
    if (item.status === "running") return "running";
    if (item.status !== "queued") return "not_found";

    const antEntry = this.entries.get(item.antName);
    if (antEntry) antEntry.controls.removeWorkItem(id);
    this.workStore.cancel(id);
    return "cancelled";
  }

  getWorkStore(): WorkStore | null {
    return this.workStore;
  }

  // Subscribe to live output lines for a named ant.
  // Returns an unsubscribe function.
  subscribeOutput(name: string, cb: (line: string) => void): () => void {
    const subs = this.subscribers.get(name) ?? new Set();
    this.subscribers.set(name, subs);
    subs.add(cb);
    return () => subs.delete(cb);
  }
}
