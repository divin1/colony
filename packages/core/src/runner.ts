import { Cron } from "croner";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { runAnt } from "./ant";
import type { ConfirmationChannel } from "./hooks";
import type { LoadedConfig, AntConfig, ColonyConfig } from "./config";
import { loadConfig } from "./config";
import { createState } from "./state";
import { loadSkill } from "./skill";
import { ColonyState } from "./colony-state";
import { createDashboardHandler } from "./dashboard";
import { AntSessionError } from "./errors";
import { log } from "./log";
import { TaskStore } from "./task-store.js";

// Extended interface the runner needs beyond ConfirmationChannel.
// DiscordIntegration satisfies this structurally — core does not depend on @colony/discord.
export interface RunnerDiscord extends ConfirmationChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  resolveChannelId(nameOrId: string): Promise<string>;
  on<T>(event: string, handler: (payload: T) => void): void;
}

// No-op Discord implementation used when no messaging integration is configured.
// All status output goes to the console; ants cannot receive Discord commands.
export class ConsoleDiscord implements RunnerDiscord {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async send(_channelId: string, content: string): Promise<{ id: string }> {
    console.log(content);
    return { id: `console-${Date.now()}` };
  }
  async resolveChannelId(nameOrId: string): Promise<string> { return nameOrId; }
  on<T>(_event: string, _handler: (payload: T) => void): void {}
}

const BASE_RESTART_DELAY_MS = 10_000;
const MAX_RESTART_DELAY_MS = 5 * 60 * 1000;

function backoffDelayMs(consecutiveCrashes: number): number {
  return Math.min(BASE_RESTART_DELAY_MS * 2 ** consecutiveCrashes, MAX_RESTART_DELAY_MS);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function sleepInterruptible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export function buildCommonInstructions(colony: ColonyConfig): string {
  const parts: string[] = [];

  parts.push(`\
## Project tracking (PLAN.md)

You maintain a PLAN.md file at the root of your working directory to track your work.

At the start of each session:
- If PLAN.md exists, read it to resume from where you left off.
- If PLAN.md does not exist, create it with your plan for this session.

Keep PLAN.md up to date throughout your session:
- Mark tasks complete as you finish them.
- Add newly discovered tasks or blockers.
- Commit PLAN.md after each update: git add PLAN.md && git commit -m "chore: update PLAN.md"

Structure PLAN.md as follows:
\`\`\`
## Current Goal
[What you are working on right now]

## Active Tasks
- [ ] Task 1
- [ ] Task 2

## Completed
- [x] Previously completed task
\`\`\``);

  const gitName = colony.defaults?.git?.user_name;
  const gitEmail = colony.defaults?.git?.user_email;

  if (gitName || gitEmail) {
    const configLines: string[] = [];
    if (gitName) configLines.push(`git config user.name "${gitName}"`);
    if (gitEmail) configLines.push(`git config user.email "${gitEmail}"`);
    parts.push(`\
## Git identity

When making git commits, always use the project owner's identity. Run these at the
start of any session where you will commit:

${configLines.map((l) => `    ${l}`).join("\n")}

Never commit as a bot user (e.g. "claude", "github-actions[bot]", or any automated identity).`);
  } else {
    parts.push(`\
## Git identity

When making git commits, use the git user identity already configured in the repository
(verify with \`git config user.name\` and \`git config user.email\`).
Never override it with a bot name such as "claude", "github-actions[bot]", or any automated identity.`);
  }

  return parts.join("\n\n");
}

export function parseTimeoutMs(duration: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(duration.trim());
  if (!match) throw new Error(`Invalid duration: "${duration}". Expected format: 30s, 5m, 1h`);
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };
  return value * multipliers[match[2]];
}

// A simple async queue: push items in, await them one at a time.
export class PromiseQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(item: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) { waiter(item); } else { this.queue.push(item); }
  }

  next(signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const item = this.queue.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve, reject) => {
      const wrapped = (value: T) => {
        signal?.removeEventListener("abort", abortHandler);
        resolve(value);
      };
      const abortHandler = () => {
        const idx = this.waiters.indexOf(wrapped);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal) signal.addEventListener("abort", abortHandler, { once: true });
      this.waiters.push(wrapped);
    });
  }

  get size(): number { return this.queue.length; }

  clear(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  remove(predicate: (item: T) => boolean): boolean {
    const idx = this.queue.findIndex(predicate);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  reorderBy(predicate: (item: T) => boolean, newIndex: number): boolean {
    const idx = this.queue.findIndex(predicate);
    if (idx === -1) return false;
    const [item] = this.queue.splice(idx, 1);
    this.queue.splice(Math.max(0, Math.min(newIndex, this.queue.length)), 0, item);
    return true;
  }
}

export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

interface DiscordCommandPayload {
  channelId: string;
  content: string;
  author: string;
}

// Runs a single ant in a supervisor loop using a TaskStore pull model.
// Resolves cleanly when controller.signal is aborted (hot reload / graceful stop).
async function runAntWithSupervision(
  ant: AntConfig,
  colony: ColonyConfig,
  configDir: string,
  discord: RunnerDiscord,
  colonyState: ColonyState,
  controller: AbortController,
  taskStore: TaskStore,
  defaultProjectId: string,
): Promise<void> {
  const { signal } = controller;
  const channelName = ant.integrations?.discord?.channel ?? ant.name;
  const channelId = await discord.resolveChannelId(channelName);

  const pollIntervalRaw = ant.poll_interval ?? colony.defaults?.poll_interval;
  const pollIntervalMs = pollIntervalRaw ? parseTimeoutMs(pollIntervalRaw) : 0;

  const antState = createState(ant.state?.backend ?? "memory", ant.state?.path);
  colonyState.registerAntState(ant.name, antState);

  const defaultPrompt = `You are ${ant.name}. ${ant.description}. Begin your work session now.`;

  // Wake-signal queue: pushing signals the ant to check TaskStore for new tasks.
  const wakeQueue = new PromiseQueue<void>();

  let paused = false;
  let resumeResolve: (() => void) | null = null;
  const waitForResume = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      resumeResolve = resolve;
      signal.addEventListener("abort", () => {
        resumeResolve = null;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

  let sessionController: AbortController | null = null;

  colonyState.register(ant.name, ant.engine, {
    pause: () => {
      if (!paused) {
        paused = true;
        if (sessionController) {
          sessionController.abort();
          broadcast(`⏸️ **${ant.name}** pausing…`);
        } else {
          broadcast(`⏸️ **${ant.name}** will pause before the next task.`);
        }
      }
    },
    resume: () => {
      if (paused) {
        paused = false;
        resumeResolve?.();
        resumeResolve = null;
        broadcast(`▶️ **${ant.name}** resuming.`);
        colonyState.setState(ant.name, "running");
      }
    },
    wake: () => { wakeQueue.push(); },
    clearQueue: () => taskStore.cancelAllTodo(ant.name),
    getQueueSize: () => taskStore.countTodo(ant.name),
  });

  const broadcast = (message: string): void => {
    colonyState.pushOutput(ant.name, message);
    discord.send(channelId, message).catch(() => {});
  };

  const teeChannel: ConfirmationChannel = {
    send: async (chId: string, content: string) => {
      colonyState.pushOutput(ant.name, content);
      return discord.send(chId, content);
    },
  };

  log(ant.name, "starting");
  colonyState.setState(ant.name, "starting");
  broadcast(`🐜 Ant **${ant.name}** is starting.`);

  const triggers = ant.triggers ?? [];
  const hasCron = !!ant.schedule?.cron;
  const hasDiscordTrigger = triggers.some((t) => t.type === "discord_command");
  const hasAnyTrigger = hasCron || hasDiscordTrigger;

  const startedAt = Date.now();
  let sessionsCompleted = 0;
  let sessionsCrashed = 0;
  let consecutiveCrashes = 0;

  function handleSlashCommand(text: string): boolean {
    const lower = text.trim().toLowerCase();
    switch (lower) {
      case "/help":
        discord.send(channelId, [
          `**${ant.name}** — available commands:`,
          `\`/help\` — show this message`,
          `\`/status\` — current state and queue depth`,
          `\`/stats\` (or \`/usage\`) — uptime and session statistics`,
          `\`/pause\` (or \`/stop\`) — pause before the next task`,
          `\`/resume\` (or \`/start\`) — resume a paused ant`,
          `\`/clear\` — move all queued tasks back to backlog`,
          `_Any other message is queued as a task for this ant._`,
        ].join("\n")).catch(() => {});
        return true;

      case "/status": {
        const state = paused ? "⏸️ paused" : "▶️ active";
        discord.send(channelId, `**${ant.name}** is ${state}. Tasks queued: ${taskStore.countTodo(ant.name)}.`).catch(() => {});
        return true;
      }

      case "/stats":
      case "/usage":
        discord.send(channelId, [
          `**${ant.name}** statistics:`,
          `Uptime: ${formatUptime(Date.now() - startedAt)}`,
          `Sessions completed: ${sessionsCompleted}`,
          `Sessions crashed: ${sessionsCrashed}`,
        ].join("\n")).catch(() => {});
        return true;

      case "/pause":
      case "/stop":
        colonyState.pause(ant.name);
        return true;

      case "/resume":
      case "/start":
        colonyState.resume(ant.name);
        return true;

      case "/clear": {
        const cleared = colonyState.clearQueue(ant.name);
        broadcast(`🗑️ **${ant.name}** task queue cleared (${cleared} task(s) returned to backlog).`);
        return true;
      }

      default: return false;
    }
  }

  // Discord listener — always-on regardless of trigger config.
  discord.on<DiscordCommandPayload>("discord_command", (payload) => {
    if (payload.channelId !== channelId) return;
    const text = payload.content.trim();

    if (text.startsWith("/")) {
      if (!handleSlashCommand(text)) {
        discord.send(channelId, `Unknown command: \`${text}\`. Type \`/help\` to see available commands.`).catch(() => {});
      }
      return;
    }

    const cmd = text.toLowerCase();
    if (cmd === "pause" || cmd === "stop") {
      colonyState.pause(ant.name);
    } else if (cmd === "resume" || cmd === "start") {
      colonyState.resume(ant.name);
    } else {
      // Create a task for the Discord message and wake the ant.
      const discordTask = taskStore.createTask({
        projectId: defaultProjectId,
        title: `${payload.author}: ${text.slice(0, 60)}`,
        description: `You are ${ant.name}. A human operator (${payload.author}) sent you this message: "${text}"`,
        assigneeType: "ant",
        assigneeName: ant.name,
        source: "discord",
      });
      colonyState.emitEvent({ type: "task", action: "created", taskId: discordTask.id });
      wakeQueue.push();
    }
  });

  // Cron trigger.
  if (hasCron) {
    new Cron(ant.schedule!.cron, () => {
      const cronTask = taskStore.createTask({
        projectId: defaultProjectId,
        title: `${ant.name} — scheduled run`,
        description: defaultPrompt,
        assigneeType: "ant",
        assigneeName: ant.name,
        source: "cron",
      });
      colonyState.emitEvent({ type: "task", action: "created", taskId: cronTask.id });
      wakeQueue.push();
    });
  }

  // Startup: if tasks already exist in todo, wake immediately.
  if (taskStore.countTodo(ant.name) > 0) {
    wakeQueue.push();
  }

  try {
    while (!signal.aborted) {
      if (paused) {
        colonyState.setState(ant.name, "paused");
        await waitForResume();
      }

      const tasks = taskStore.listTodo(ant.name);

      if (tasks.length === 0) {
        if (!hasAnyTrigger) {
          // Autonomous ant: sleep, then create a new default task.
          if (pollIntervalMs > 0) {
            await sleepInterruptible(pollIntervalMs, signal);
          }
          const autoTask = taskStore.createTask({
            projectId: defaultProjectId,
            title: `${ant.name} — autonomous session`,
            description: defaultPrompt,
            assigneeType: "ant",
            assigneeName: ant.name,
            source: "cron",
          });
          colonyState.emitEvent({ type: "task", action: "created", taskId: autoTask.id });
          continue;
        } else {
          // Event-driven ant: wait for a wake signal.
          colonyState.setState(ant.name, "idle");
          await wakeQueue.next(signal);
          continue;
        }
      }

      const task = tasks[0];
      log(ant.name, `starting task: ${task.title}`);
      colonyState.setState(ant.name, "running");
      colonyState.setCurrentTask(ant.name, task.id);
      colonyState.setLastError(ant.name, null);
      taskStore.setStatus(task.id, "in_progress", { startedAt: Date.now() });
      taskStore.addComment(task.id, ant.name, "🐜 Started session.");
      colonyState.emitEvent({ type: "task", action: "updated", taskId: task.id });

      sessionController = new AbortController();
      try {
        const skillTexts: string[] = [];
        for (const relPath of ant.skills ?? []) {
          try { skillTexts.push(loadSkill(join(configDir, relPath))); }
          catch (err) { log(ant.name, `skill load warning: ${(err as Error).message}`); }
        }
        const commonInstructions = [buildCommonInstructions(colony), ...skillTexts]
          .filter(Boolean).join("\n\n");

        const previousSummary = antState.getLastSessionSummary(ant.name);
        const prompt = previousSummary
          ? `## Context from your previous session\n\n${previousSummary}\n\n---\n\n${task.description}`
          : task.description;

        const result = await runAnt(prompt, {
          config: ant, channel: teeChannel, channelId, commonInstructions,
          signal: sessionController.signal,
        });

        sessionsCompleted++;
        consecutiveCrashes = 0;
        colonyState.incrementSessions(ant.name, "completed");
        log(ant.name, "session completed");

        colonyState.setCurrentTask(ant.name, null);
        taskStore.setStatus(task.id, "in_review", { completedAt: Date.now() });
        if (result.lastOutput) {
          taskStore.setOutput(task.id, result.lastOutput);
          taskStore.addComment(task.id, ant.name, result.lastOutput);
          antState.setSessionSummary(ant.name, result.lastOutput);
        }
        colonyState.emitEvent({ type: "task", action: "updated", taskId: task.id });
        broadcast(`✅ **${ant.name}** completed: ${task.title}`);
      } catch (err) {
        if (isAbortError(err)) {
          if (signal.aborted) throw err;
          // Session interrupted by pause — push task back to todo and re-wake after resume.
          colonyState.setCurrentTask(ant.name, null);
          taskStore.setStatus(task.id, "todo");
          taskStore.addComment(task.id, ant.name, "⏸️ Session paused. Task returned to queue.");
          colonyState.emitEvent({ type: "task", action: "updated", taskId: task.id });
          wakeQueue.push();
          continue;
        }

        sessionsCrashed++;
        colonyState.incrementSessions(ant.name, "crashed");
        colonyState.setCurrentTask(ant.name, null);
        const errMsg = err instanceof Error ? err.message : String(err);
        colonyState.setLastError(ant.name, errMsg);

        // All failures: task back to todo; retry after backoff.
        taskStore.setStatus(task.id, "todo");
        taskStore.addComment(task.id, ant.name, `❌ Session failed: ${errMsg}. Task returned to queue.`);
        colonyState.emitEvent({ type: "task", action: "updated", taskId: task.id });

        if (err instanceof AntSessionError) {
          switch (err.category) {
            case "max_turns":
              consecutiveCrashes = 0;
              log(ant.name, "max turns reached — restarting");
              wakeQueue.push();
              break;

            case "rate_limit": {
              consecutiveCrashes++;
              const waitMs = err.retryAfterMs ?? backoffDelayMs(consecutiveCrashes);
              const waitSec = Math.round(waitMs / 1000);
              log(ant.name, `rate limited — resuming in ${waitSec}s`);
              colonyState.setState(ant.name, "backoff");
              broadcast(`⏳ **${ant.name}** is rate limited. Resuming in ${waitSec}s…`);
              await sleepInterruptible(waitMs, signal);
              wakeQueue.push();
              break;
            }

            case "billing":
              consecutiveCrashes = 0;
              log(ant.name, "billing error — pausing until resumed");
              colonyState.setState(ant.name, "paused");
              broadcast(`💳 **${ant.name}** has a billing error — check your Anthropic account. Pausing until resumed.`);
              paused = true;
              await waitForResume();
              wakeQueue.push();
              break;

            case "auth":
              consecutiveCrashes = 0;
              log(ant.name, "authentication failed — pausing until resumed");
              colonyState.setState(ant.name, "paused");
              broadcast(`🔐 **${ant.name}** failed to authenticate — check credentials. Pausing until resumed.`);
              paused = true;
              await waitForResume();
              wakeQueue.push();
              break;

            case "budget":
              consecutiveCrashes = 0;
              log(ant.name, "USD budget cap exceeded — pausing until resumed");
              colonyState.setState(ant.name, "paused");
              broadcast(`💰 **${ant.name}** exceeded its USD budget cap. Pausing until resumed.`);
              paused = true;
              await waitForResume();
              wakeQueue.push();
              break;

            case "permanent": {
              consecutiveCrashes++;
              const delay = backoffDelayMs(consecutiveCrashes);
              log(ant.name, `permanent error: ${errMsg} — restarting in ${delay / 1000}s`);
              colonyState.setState(ant.name, "backoff");
              broadcast(`🚫 **${ant.name}** encountered a permanent error: ${errMsg}\nRestarting in ${delay / 1000}s…`);
              await sleepInterruptible(delay, signal);
              wakeQueue.push();
              break;
            }

            default: {
              consecutiveCrashes++;
              const delay = backoffDelayMs(consecutiveCrashes);
              log(ant.name, `crashed: ${errMsg} — restarting in ${delay / 1000}s`);
              colonyState.setState(ant.name, "crashed");
              broadcast(`❌ **${ant.name}** crashed: ${errMsg}\nRestarting in ${delay / 1000}s…`);
              await sleepInterruptible(delay, signal);
              wakeQueue.push();
            }
          }
        } else {
          consecutiveCrashes++;
          const delay = backoffDelayMs(consecutiveCrashes);
          log(ant.name, `crashed: ${errMsg} — restarting in ${delay / 1000}s`);
          colonyState.setState(ant.name, "crashed");
          broadcast(`❌ **${ant.name}** crashed: ${errMsg}\nRestarting in ${delay / 1000}s…`);
          await sleepInterruptible(delay, signal);
          wakeQueue.push();
        }
      } finally {
        sessionController = null;
      }
    }
  } catch (err) {
    if (!isAbortError(err)) {
      log(ant.name, `supervisor exited unexpectedly: ${(err as Error).message}`);
    }
  }

  log(ant.name, "stopping");
  colonyState.unregister(ant.name);
}

const ENGINE_BINARIES: Record<string, string> = {
  "claude-cli": "claude", "gemini-cli": "gemini", "codex": "codex", "opencode": "opencode",
};

function checkDiscordChannels(colony: LoadedConfig["colony"], ants: LoadedConfig["ants"]): void {
  if (!colony.integrations?.discord) return;
  const noChannel = ants.filter((ant) => !ant.integrations?.discord?.channel);
  if (noChannel.length > 0) {
    const names = noChannel.map((a) => `"${a.name}"`).join(", ");
    throw new Error(
      `Colony startup failed — the following ant(s) have no integrations.discord.channel configured: ${names}\n` +
      `Every ant needs a Discord channel when the Discord integration is active.`
    );
  }
}

function checkBinaries(ants: LoadedConfig["ants"]): void {
  const missing: string[] = [];
  for (const ant of ants) {
    const binaryName = ant.engine === "cli" ? ant.cli?.binary : ENGINE_BINARIES[ant.engine];
    if (binaryName && !Bun.which(binaryName)) {
      missing.push(`  • ant "${ant.name}" (engine: ${ant.engine}) requires "${binaryName}"`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Colony startup failed — required CLI binaries not found on PATH:\n${missing.join("\n")}\n\nInstall the missing tools and try again.`
    );
  }
}

function resolveWebRoot(): string | undefined {
  if (process.env.COLONY_WEB_ROOT) return process.env.COLONY_WEB_ROOT;
  // XDG data dir: ~/.local/share/colony/web/ (standard Linux install location)
  const xdg = join(homedir(), ".local", "share", "colony", "web");
  if (existsSync(join(xdg, "index.html"))) return xdg;
  // Adjacent to the binary (custom or Windows install: binary dir + /web/)
  const binWeb = join(dirname(process.execPath), "web");
  if (existsSync(join(binWeb, "index.html"))) return binWeb;
  // Dev mode: packages/web/out/ relative to cwd (monorepo root)
  const devWeb = join(process.cwd(), "packages", "web", "out");
  if (existsSync(join(devWeb, "index.html"))) return devWeb;
  return undefined;
}

export async function runColony(
  config: LoadedConfig,
  discord: RunnerDiscord,
): Promise<void> {
  checkDiscordChannels(config.colony, config.ants);
  checkBinaries(config.ants);

  await discord.connect();
  console.log(`Colony "${config.colony.name}" online — ${config.ants.length} ant(s) starting.`);

  if (config.ants.length === 0) {
    console.warn("No ants configured — nothing to run.");
    await discord.disconnect();
    return;
  }

  // TaskStore is always created — it's the primary work model.
  const taskStore = new TaskStore(config.configDir);
  const defaultProject = taskStore.getOrCreateDefaultProject();
  const colonyState = new ColonyState(config.colony.name, config.configDir);

  type AntHandle = { controller: AbortController; promise: Promise<void> };
  const runningAnts = new Map<string, AntHandle>();
  let currentConfig = config;

  function startAnt(ant: AntConfig): void {
    const controller = new AbortController();
    const promise = runAntWithSupervision(
      ant, currentConfig.colony, currentConfig.configDir,
      discord, colonyState, controller, taskStore, defaultProject.id,
    ).catch((err: Error) => log(ant.name, `supervisor exited: ${err.message}`));
    runningAnts.set(ant.name, { controller, promise });
  }

  async function stopAnt(name: string): Promise<void> {
    const handle = runningAnts.get(name);
    if (!handle) return;
    handle.controller.abort();
    await handle.promise;
    runningAnts.delete(name);
  }

  colonyState.setReloadCallback(async () => {
    const newConfig = loadConfig(currentConfig.configDir);
    checkDiscordChannels(newConfig.colony, newConfig.ants);

    const oldByName = new Map(currentConfig.ants.map((a) => [a.name, a]));
    const newByName = new Map(newConfig.ants.map((a) => [a.name, a]));

    const added: string[] = [];
    const removed: string[] = [];
    const updated: string[] = [];

    for (const [name, oldAnt] of oldByName) {
      const newAnt = newByName.get(name);
      if (!newAnt) { removed.push(name); await stopAnt(name); }
      else if (JSON.stringify(oldAnt) !== JSON.stringify(newAnt)) { updated.push(name); await stopAnt(name); }
    }

    currentConfig = newConfig;
    for (const [name, newAnt] of newByName) {
      if (!oldByName.has(name)) { added.push(name); startAnt(newAnt); }
      else if (updated.includes(name)) { startAnt(newAnt); }
    }

    const summary = [
      added.length > 0 ? `${added.length} added` : "",
      removed.length > 0 ? `${removed.length} removed` : "",
      updated.length > 0 ? `${updated.length} updated` : "",
    ].filter(Boolean).join(", ");
    console.log(`Colony reloaded — ${summary || "no changes"}`);
    return { added, removed, updated };
  });

  let dashboardServer: ReturnType<typeof Bun.serve> | undefined;
  const monitorPort = config.colony.monitoring?.port;
  if (monitorPort) {
    const webRoot = resolveWebRoot();
    dashboardServer = Bun.serve({
      port: monitorPort,
      fetch: createDashboardHandler(colonyState, {
        apiKey: process.env.COLONY_API_KEY,
        taskStore,
        webRoot,
      }),
    });
    const webNote = webRoot ? "" : " (API only — web UI not found; build packages/web or set COLONY_WEB_ROOT)";
    console.log(`Dashboard: http://localhost:${monitorPort}${webNote}`);
  }

  for (const ant of config.ants) startAnt(ant);

  try {
    await new Promise<never>(() => {});
  } finally {
    dashboardServer?.stop(true);
    await discord.disconnect();
  }
}
