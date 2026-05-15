import { Cron } from "croner";
import { runAnt } from "./ant";
import type { ConfirmationChannel } from "./hooks";
import type { LoadedConfig, AntConfig, ColonyConfig } from "./config";
import { createState } from "./state";
import { ColonyState } from "./colony-state";
import { createDashboardHandler } from "./dashboard";
import { AntSessionError } from "./errors";
import { log } from "./log";

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
  async resolveChannelId(nameOrId: string): Promise<string> {
    return nameOrId;
  }
  on<T>(_event: string, _handler: (payload: T) => void): void {}
}

// Minimal GitHub interface the runner needs for issue polling.
// GitHubIntegration satisfies this structurally — core does not depend on @colony/github.
export interface RunnerGitHub {
  listIssues(
    owner: string,
    repo: string,
    opts?: { labels?: string[] }
  ): Promise<Array<{ number: number; title: string; body: string | null }>>;
}

const BASE_RESTART_DELAY_MS = 10_000;
const MAX_RESTART_DELAY_MS = 5 * 60 * 1000; // 5 min cap
const GITHUB_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function backoffDelayMs(consecutiveCrashes: number): number {
  return Math.min(
    BASE_RESTART_DELAY_MS * 2 ** consecutiveCrashes,
    MAX_RESTART_DELAY_MS
  );
}

/**
 * Builds the colony-level instructions appended to every ant's system prompt.
 * Covers two conventions that apply regardless of which project management tool
 * (if any) is in use:
 *
 *   1. PLAN.md — ants track goals and tasks in a committed markdown file.
 *   2. Git identity — ants always commit as the project owner, never as a bot.
 */
export function buildCommonInstructions(colony: ColonyConfig): string {
  const parts: string[] = [];

  // --- PLAN.md convention ---
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

  // --- Git identity convention ---
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

// Parse a human-friendly duration string (e.g. "30m", "1h", "60s") to milliseconds.
export function parseTimeoutMs(duration: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(duration.trim());
  if (!match) {
    throw new Error(
      `Invalid duration: "${duration}". Expected format: 30s, 5m, 1h`
    );
  }
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  };
  return value * multipliers[match[2]];
}

// A simple async queue: push items in, await them one at a time.
export class PromiseQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(item: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.queue.push(item);
    }
  }

  next(): Promise<T> {
    const item = this.queue.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  get size(): number {
    return this.queue.length;
  }

  // Discards all queued items and returns the count removed.
  clear(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}

// Formats a millisecond duration as a human-readable string, e.g. "2d 3h 15m" or "45s".
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

// Runs a single ant in an infinite supervisor loop.
// On crash: logs to Discord and restarts after RESTART_DELAY_MS.
// Never resolves — returns Promise<never> so Promise.all waits indefinitely.
async function runAntWithSupervision(
  ant: AntConfig,
  colony: ColonyConfig,
  discord: RunnerDiscord,
  colonyState: ColonyState,
  github?: RunnerGitHub
): Promise<never> {
  // Fall back to the ant name when no Discord channel is configured (e.g. ConsoleDiscord).
  const channelName = ant.integrations?.discord?.channel ?? ant.name;
  const channelId = await discord.resolveChannelId(channelName);

  const pollIntervalRaw = ant.poll_interval ?? colony.defaults?.poll_interval;
  const pollIntervalMs = pollIntervalRaw ? parseTimeoutMs(pollIntervalRaw) : 0;

  const antState = createState(
    ant.state?.backend ?? "memory",
    ant.state?.path
  );
  // antState used for GitHub issue deduplication (hasSeenIssue / markIssueSeen).

  const defaultPrompt = `You are ${ant.name}. ${ant.description}. Begin your work session now.`;
  const queue = new PromiseQueue<string>();

  // --- Pause / resume state ---
  let paused = false;
  let resumeResolve: (() => void) | null = null;
  const waitForResume = (): Promise<void> =>
    new Promise((resolve) => {
      resumeResolve = resolve;
    });

  // --- Register with colony state for dashboard control ---
  colonyState.register(ant.name, ant.engine, {
    pause: () => {
      if (!paused) {
        paused = true;
        broadcast(`⏸️ **${ant.name}** will pause after the current session.`);
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
    pushPrompt: (prompt: string) => {
      queue.push(prompt);
      if (paused) {
        paused = false;
        resumeResolve?.();
        resumeResolve = null;
        colonyState.setState(ant.name, "running");
      }
    },
    clearQueue: () => queue.clear(),
    getQueueSize: () => queue.size,
  });

  // Sends to both Discord and the dashboard output stream.
  const broadcast = (message: string): void => {
    colonyState.pushOutput(ant.name, message);
    discord.send(channelId, message).catch(() => {});
  };

  // Channel proxy so engine output also reaches the dashboard.
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
  const hasGithubTrigger = triggers.some((t) => t.type === "github_issue");
  const hasAnyTrigger = hasCron || hasDiscordTrigger || hasGithubTrigger;

  // --- Session statistics ---
  const startedAt = Date.now();
  let sessionsCompleted = 0;
  let sessionsCrashed = 0;
  let consecutiveCrashes = 0;

  // --- Slash command handler ---
  // Slash commands starting with "/" are intercepted here and never forwarded to the ant LLM.
  // Returns true if the command was handled, false if unrecognised.
  function handleSlashCommand(text: string): boolean {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    switch (lower) {
      case "/help":
        discord
          .send(
            channelId,
            [
              `**${ant.name}** — available commands:`,
              `\`/help\` — show this message`,
              `\`/status\` — current state (running / paused) and queue depth`,
              `\`/stats\` (or \`/usage\`) — uptime and session statistics`,
              `\`/pause\` (or \`/stop\`) — pause after the current session`,
              `\`/resume\` (or \`/start\`) — resume a paused ant`,
              `\`/clear\` — discard all queued work items`,
              `_Any other message is forwarded to the ant as a work instruction._`,
            ].join("\n")
          )
          .catch(() => {});
        return true;

      case "/status": {
        const state = paused ? "⏸️ paused" : "▶️ running";
        discord
          .send(
            channelId,
            `**${ant.name}** is ${state}. Queue: ${queue.size} item(s).`
          )
          .catch(() => {});
        return true;
      }

      case "/stats":
      case "/usage": {
        const uptime = formatUptime(Date.now() - startedAt);
        discord
          .send(
            channelId,
            [
              `**${ant.name}** statistics:`,
              `Uptime: ${uptime}`,
              `Sessions completed: ${sessionsCompleted}`,
              `Sessions crashed: ${sessionsCrashed}`,
            ].join("\n")
          )
          .catch(() => {});
        return true;
      }

      case "/pause":
      case "/stop":
        log(ant.name, "pausing after current session");
        colonyState.pause(ant.name);
        return true;

      case "/resume":
      case "/start":
        log(ant.name, "resumed");
        colonyState.resume(ant.name);
        return true;

      case "/clear": {
        const cleared = colonyState.clearQueue(ant.name);
        broadcast(`🗑️ **${ant.name}** work queue cleared (${cleared} item(s) discarded).`);
        return true;
      }

      default:
        return false;
    }
  }

  // --- Discord command listener (always-on) ---
  // Every ant listens to its channel regardless of trigger config.
  // Slash commands (starting with "/") are intercepted by the runner first.
  // Plain-text messages are classified:
  //   "pause" / "stop"    → pause after the current session  (kept for backward compat)
  //   "resume" / "start"  → resume a paused ant              (kept for backward compat)
  //   anything else       → forward as a work instruction (also auto-resumes if paused)
  discord.on<DiscordCommandPayload>("discord_command", (payload) => {
    if (payload.channelId !== channelId) return;

    const text = payload.content.trim();

    // Slash commands: handled by the runner, never forwarded to the ant LLM.
    if (text.startsWith("/")) {
      if (!handleSlashCommand(text)) {
        discord
          .send(
            channelId,
            `Unknown command: \`${text}\`. Type \`/help\` to see available commands.`
          )
          .catch(() => {});
      }
      return;
    }

    const cmd = text.toLowerCase();

    if (cmd === "pause" || cmd === "stop") {
      log(ant.name, "pausing after current session");
      colonyState.pause(ant.name);
    } else if (cmd === "resume" || cmd === "start") {
      log(ant.name, "resumed");
      colonyState.resume(ant.name);
    } else {
      // Forward as work instruction. Auto-resumes if the ant is currently paused.
      colonyState.pushPrompt(
        ant.name,
        `You are ${ant.name}. A human operator (${payload.author}) sent you this message: "${text}"`
      );
    }
  });

  // --- Cron trigger ---
  if (hasCron) {
    new Cron(ant.schedule!.cron, () => {
      queue.push(defaultPrompt);
    });
  }

  // --- GitHub issue trigger ---
  if (hasGithubTrigger && github) {
    const githubTrigger = triggers.find((t) => t.type === "github_issue");
    const labels =
      githubTrigger?.type === "github_issue" ? githubTrigger.labels : [];
    const repos = ant.integrations?.github?.repos ?? [];

    const pollGitHub = async () => {
      for (const repoSlug of repos) {
        const [owner, repo] = repoSlug.split("/");
        if (!owner || !repo) continue;
        try {
          const issues = await github.listIssues(owner, repo, {
            labels: labels.length > 0 ? labels : undefined,
          });
          for (const issue of issues) {
            if (antState.hasSeenIssue(ant.name, issue.number)) continue;
            antState.markIssueSeen(ant.name, issue.number);
            queue.push(
              `You are ${ant.name}. A new GitHub issue has been opened in ${repoSlug}:\n` +
                `Issue #${issue.number}: ${issue.title}\n${issue.body ?? ""}`
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await discord
            .send(channelId, `⚠️ **${ant.name}** GitHub poll failed: ${msg}`)
            .catch(() => {});
        }
      }
    };

    // Initial poll immediately, then on interval.
    pollGitHub().catch(() => {});
    setInterval(() => pollGitHub().catch(() => {}), GITHUB_POLL_INTERVAL_MS);
  }

  // If no triggers configured: run once immediately, then re-queue after each run.
  if (!hasAnyTrigger) {
    queue.push(defaultPrompt);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (paused) {
      colonyState.setState(ant.name, "paused");
      await waitForResume();
    }
    const prompt = await queue.next();
    log(ant.name, "session starting");
    colonyState.setState(ant.name, "running");
    try {
      await runAnt(prompt, {
        config: ant,
        channel: teeChannel,
        channelId,
        commonInstructions: buildCommonInstructions(colony),
      });
      sessionsCompleted++;
      consecutiveCrashes = 0;
      colonyState.incrementSessions(ant.name, "completed");
      log(ant.name, "session completed");
      broadcast(`✅ **${ant.name}** completed its work session.`);
    } catch (err) {
      sessionsCrashed++;
      colonyState.incrementSessions(ant.name, "crashed");
      if (err instanceof AntSessionError) {
        switch (err.category) {
          case "max_turns":
            consecutiveCrashes = 0;
            log(ant.name, "max turns reached — restarting");
            break;

          case "rate_limit": {
            consecutiveCrashes++;
            const waitMs = err.retryAfterMs ?? backoffDelayMs(consecutiveCrashes);
            const waitSec = Math.round(waitMs / 1000);
            log(ant.name, `rate limited — resuming in ${waitSec}s`);
            colonyState.setState(ant.name, "backoff");
            broadcast(`⏳ **${ant.name}** is rate limited. Resuming in ${waitSec}s…`);
            await Bun.sleep(waitMs);
            break;
          }

          case "billing":
            consecutiveCrashes = 0;
            log(ant.name, "billing error — pausing until resumed");
            colonyState.setState(ant.name, "paused");
            broadcast(`💳 **${ant.name}** has a billing error — check your Anthropic account. Pausing until resumed.`);
            paused = true;
            await waitForResume();
            break;

          case "auth":
            consecutiveCrashes = 0;
            log(ant.name, "authentication failed — pausing until resumed");
            colonyState.setState(ant.name, "paused");
            broadcast(`🔐 **${ant.name}** failed to authenticate — check credentials. Pausing until resumed.`);
            paused = true;
            await waitForResume();
            break;

          case "budget":
            consecutiveCrashes = 0;
            log(ant.name, "USD budget cap exceeded — pausing until resumed");
            colonyState.setState(ant.name, "paused");
            broadcast(`💰 **${ant.name}** exceeded its USD budget cap. Pausing until resumed.`);
            paused = true;
            await waitForResume();
            break;

          case "permanent": {
            consecutiveCrashes++;
            const delay = backoffDelayMs(consecutiveCrashes);
            log(ant.name, `permanent error: ${err.message} — restarting in ${delay / 1000}s`);
            colonyState.setState(ant.name, "backoff");
            broadcast(`🚫 **${ant.name}** encountered a permanent error: ${err.message}\nRestarting in ${delay / 1000}s…`);
            await Bun.sleep(delay);
            break;
          }

          default: {
            // 'transient'
            consecutiveCrashes++;
            const delay = backoffDelayMs(consecutiveCrashes);
            log(ant.name, `crashed: ${err.message} — restarting in ${delay / 1000}s`);
            colonyState.setState(ant.name, "crashed");
            broadcast(`❌ **${ant.name}** crashed: ${err.message}\nRestarting in ${delay / 1000}s…`);
            await Bun.sleep(delay);
          }
        }
      } else {
        // Non-AntSessionError (e.g. unexpected JS error): treat as transient.
        consecutiveCrashes++;
        const delay = backoffDelayMs(consecutiveCrashes);
        const message = err instanceof Error ? err.message : String(err);
        log(ant.name, `crashed: ${message} — restarting in ${delay / 1000}s`);
        colonyState.setState(ant.name, "crashed");
        broadcast(`❌ **${ant.name}** crashed: ${message}\nRestarting in ${delay / 1000}s…`);
        await Bun.sleep(delay);
      }
    }

    // If no triggers: sleep (if configured) then re-queue so the ant keeps running.
    if (!hasAnyTrigger) {
      if (pollIntervalMs > 0) {
        await Bun.sleep(pollIntervalMs);
      }
      queue.push(defaultPrompt);
    }
  }
}

// Maps engine names to the CLI binary they spawn.
// Used for pre-flight availability checks at startup.
const ENGINE_BINARIES: Record<string, string> = {
  "claude-cli": "claude",
  "gemini-cli": "gemini",
  "codex": "codex",
  "opencode": "opencode",
};

// Connects to Discord, launches all ants concurrently, and runs until the process is killed.
// Each ant has its own supervisor loop — a crash in one ant does not affect others.
export async function runColony(
  config: LoadedConfig,
  discord: RunnerDiscord,
  github?: RunnerGitHub
): Promise<void> {
  // When full Discord is active, every ant must have a channel configured so
  // the runner can route messages correctly.
  if (config.colony.integrations?.discord) {
    const noChannel = config.ants.filter(
      (ant) => !ant.integrations?.discord?.channel
    );
    if (noChannel.length > 0) {
      const names = noChannel.map((a) => `"${a.name}"`).join(", ");
      throw new Error(
        `Colony startup failed — the following ant(s) have no integrations.discord.channel configured: ${names}\n` +
        `Every ant needs a Discord channel when the Discord integration is active.`
      );
    }
  }

  // Pre-flight: verify all required CLI binaries are on PATH before starting anything.
  const missing: string[] = [];
  for (const ant of config.ants) {
    const binaryName =
      ant.engine === "cli" ? ant.cli?.binary : ENGINE_BINARIES[ant.engine];
    if (binaryName && !Bun.which(binaryName)) {
      missing.push(`  • ant "${ant.name}" (engine: ${ant.engine}) requires "${binaryName}"`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Colony startup failed — required CLI binaries not found on PATH:\n${missing.join("\n")}\n\nInstall the missing tools and try again.`
    );
  }

  await discord.connect();
  console.log(
    `Colony "${config.colony.name}" online — ${config.ants.length} ant(s) starting.`
  );

  if (config.ants.length === 0) {
    console.warn("No ants configured — nothing to run.");
    await discord.disconnect();
    return;
  }

  // Create shared colony state for the dashboard.
  const colonyState = new ColonyState(config.colony.name);

  // Start the optional HTTP dashboard.
  let dashboardServer: ReturnType<typeof Bun.serve> | undefined;
  const monitorPort = config.colony.monitoring?.port;
  if (monitorPort) {
    dashboardServer = Bun.serve({
      port: monitorPort,
      fetch: createDashboardHandler(colonyState),
    });
    console.log(`Dashboard: http://localhost:${monitorPort}`);
  }

  try {
    // runAntWithSupervision never resolves, so this awaits indefinitely.
    await Promise.all(
      config.ants.map((ant) =>
        runAntWithSupervision(ant, config.colony, discord, colonyState, github)
      )
    );
  } finally {
    dashboardServer?.stop(true);
    await discord.disconnect();
  }
}
