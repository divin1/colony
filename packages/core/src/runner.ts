import { Cron } from "croner";
import { runAnt } from "./ant";
import type { ConfirmationChannel } from "./hooks";
import type { LoadedConfig, AntConfig, ColonyConfig } from "./config";
import { createState } from "./state";
import { AntSessionError } from "./errors";

// Extended interface the runner needs beyond ConfirmationChannel.
// DiscordIntegration satisfies this structurally — core does not depend on @colony/discord.
export interface RunnerDiscord extends ConfirmationChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  resolveChannelId(nameOrId: string): Promise<string>;
  on<T>(event: string, handler: (payload: T) => void): void;
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
  github?: RunnerGitHub
): Promise<never> {
  const channelName = ant.integrations?.discord?.channel;
  if (!channelName) {
    throw new Error(`Ant "${ant.name}" has no discord.channel configured`);
  }

  const channelId = await discord.resolveChannelId(channelName);
  const timeoutMs = parseTimeoutMs(
    colony.defaults?.confirmation_timeout ?? "30m"
  );

  if (ant.engine === "gemini" && ant.autonomy !== "full") {
    console.warn(
      `[colony] Warning: ant "${ant.name}" uses engine "gemini". ` +
        `Autonomy level "${ant.autonomy}" will be injected as prompt instructions only — ` +
        `individual tool calls cannot be intercepted.`
    );
  }

  const pollIntervalRaw = ant.poll_interval ?? colony.defaults?.poll_interval;
  const pollIntervalMs = pollIntervalRaw ? parseTimeoutMs(pollIntervalRaw) : 0;

  const antState = createState(
    ant.state?.backend ?? "memory",
    ant.state?.path
  );

  await discord.send(channelId, `🐜 Ant **${ant.name}** is starting.`);

  const defaultPrompt = `You are ${ant.name}. ${ant.description}. Begin your work session now.`;
  const queue = new PromiseQueue<string>();

  const triggers = ant.triggers ?? [];
  const hasCron = !!ant.schedule?.cron;
  const hasDiscordTrigger = triggers.some((t) => t.type === "discord_command");
  const hasGithubTrigger = triggers.some((t) => t.type === "github_issue");
  const hasAnyTrigger = hasCron || hasDiscordTrigger || hasGithubTrigger;

  // --- Pause / resume state ---
  let paused = false;
  let resumeResolve: (() => void) | null = null;
  const waitForResume = (): Promise<void> =>
    new Promise((resolve) => {
      resumeResolve = resolve;
    });

  // --- Session statistics ---
  const startedAt = Date.now();
  let sessionsCompleted = 0;
  let sessionsCrashed = 0;
  let consecutiveCrashes = 0;

  // --- Slash command handler ---
  // Slash commands starting with "/" are intercepted here and never forwarded to the ant LLM.
  // Returns true if the command was handled, false if unrecognised.
  function handleSlashCommand(text: string): boolean {
    const lower = text.toLowerCase().trim();
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
        if (!paused) {
          paused = true;
          discord
            .send(
              channelId,
              `⏸️ **${ant.name}** will pause after the current session.`
            )
            .catch(() => {});
        }
        return true;

      case "/resume":
      case "/start":
        if (paused) {
          paused = false;
          resumeResolve?.();
          resumeResolve = null;
          discord
            .send(channelId, `▶️ **${ant.name}** resuming.`)
            .catch(() => {});
        }
        return true;

      case "/clear": {
        const cleared = queue.clear();
        discord
          .send(
            channelId,
            `🗑️ **${ant.name}** work queue cleared (${cleared} item(s) discarded).`
          )
          .catch(() => {});
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
      if (!paused) {
        paused = true;
        discord
          .send(
            channelId,
            `⏸️ **${ant.name}** will pause after the current session.`
          )
          .catch(() => {});
      }
    } else if (cmd === "resume" || cmd === "start") {
      if (paused) {
        paused = false;
        resumeResolve?.();
        resumeResolve = null;
        discord
          .send(channelId, `▶️ **${ant.name}** resuming.`)
          .catch(() => {});
      }
    } else {
      // Forward as work instruction. Auto-resumes if the ant is currently paused
      // so the message is acted on immediately rather than queued indefinitely.
      queue.push(
        `You are ${ant.name}. A human operator (${payload.author}) sent you this message: "${text}"`
      );
      if (paused) {
        paused = false;
        resumeResolve?.();
        resumeResolve = null;
      }
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
      await waitForResume();
    }
    const prompt = await queue.next();
    try {
      await runAnt(prompt, {
        config: ant,
        channel: discord,
        channelId,
        confirmationTimeoutMs: timeoutMs,
        commonInstructions: buildCommonInstructions(colony),
      });
      sessionsCompleted++;
      consecutiveCrashes = 0;
      await discord
        .send(channelId, `✅ **${ant.name}** completed its work session.`)
        .catch(() => {});
    } catch (err) {
      sessionsCrashed++;
      if (err instanceof AntSessionError) {
        switch (err.category) {
          case "max_turns":
            // Normal turn-limit completion — silent restart, no penalty.
            consecutiveCrashes = 0;
            break;

          case "rate_limit": {
            consecutiveCrashes++;
            const waitMs =
              err.retryAfterMs ?? backoffDelayMs(consecutiveCrashes);
            const waitSec = Math.round(waitMs / 1000);
            await discord
              .send(
                channelId,
                `⏳ **${ant.name}** is rate limited. Resuming in ${waitSec}s…`
              )
              .catch(() => {});
            await Bun.sleep(waitMs);
            break;
          }

          case "billing":
            consecutiveCrashes = 0;
            await discord
              .send(
                channelId,
                `💳 **${ant.name}** has a billing error — check your Anthropic account. Pausing until resumed.`
              )
              .catch(() => {});
            paused = true;
            await waitForResume();
            break;

          case "auth":
            consecutiveCrashes = 0;
            await discord
              .send(
                channelId,
                `🔐 **${ant.name}** failed to authenticate — check credentials. Pausing until resumed.`
              )
              .catch(() => {});
            paused = true;
            await waitForResume();
            break;

          case "budget":
            consecutiveCrashes = 0;
            await discord
              .send(
                channelId,
                `💰 **${ant.name}** exceeded its USD budget cap. Pausing until resumed.`
              )
              .catch(() => {});
            paused = true;
            await waitForResume();
            break;

          case "permanent": {
            consecutiveCrashes++;
            const delay = backoffDelayMs(consecutiveCrashes);
            await discord
              .send(
                channelId,
                `🚫 **${ant.name}** encountered a permanent error: ${err.message}\nRestarting in ${delay / 1000}s…`
              )
              .catch(() => {});
            await Bun.sleep(delay);
            break;
          }

          default: {
            // 'transient'
            consecutiveCrashes++;
            const delay = backoffDelayMs(consecutiveCrashes);
            await discord
              .send(
                channelId,
                `❌ **${ant.name}** crashed: ${err.message}\nRestarting in ${delay / 1000}s…`
              )
              .catch(() => {});
            await Bun.sleep(delay);
          }
        }
      } else {
        // Non-AntSessionError (e.g. unexpected JS error): treat as transient.
        consecutiveCrashes++;
        const delay = backoffDelayMs(consecutiveCrashes);
        const message = err instanceof Error ? err.message : String(err);
        await discord
          .send(
            channelId,
            `❌ **${ant.name}** crashed: ${message}\nRestarting in ${delay / 1000}s…`
          )
          .catch(() => {});
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

// Connects to Discord, launches all ants concurrently, and runs until the process is killed.
// Each ant has its own supervisor loop — a crash in one ant does not affect others.
export async function runColony(
  config: LoadedConfig,
  discord: RunnerDiscord,
  github?: RunnerGitHub
): Promise<void> {
  await discord.connect();
  console.log(
    `Colony "${config.colony.name}" online — ${config.ants.length} ant(s) starting.`
  );

  if (config.ants.length === 0) {
    console.warn("No ants configured — nothing to run.");
    await discord.disconnect();
    return;
  }

  try {
    // runAntWithSupervision never resolves, so this awaits indefinitely.
    await Promise.all(
      config.ants.map((ant) =>
        runAntWithSupervision(ant, config.colony, discord, github)
      )
    );
  } finally {
    await discord.disconnect();
  }
}
