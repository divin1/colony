import { Cron } from "croner";
import { runAnt } from "./ant";
import type { ConfirmationChannel } from "./hooks";
import type { LoadedConfig, AntConfig, ColonyConfig } from "./config";
import { createState } from "./state";

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

const RESTART_DELAY_MS = 10_000;
const GITHUB_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

  // --- Cron trigger ---
  if (hasCron) {
    new Cron(ant.schedule!.cron, () => {
      queue.push(defaultPrompt);
    });
  }

  // --- Discord command trigger ---
  if (hasDiscordTrigger) {
    discord.on<DiscordCommandPayload>("discord_command", (payload) => {
      if (payload.channelId !== channelId) return;
      queue.push(
        `You are ${ant.name}. A Discord user (${payload.author}) sent you this command: "${payload.content}"`
      );
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
    const prompt = await queue.next();
    try {
      await runAnt(prompt, {
        config: ant,
        channel: discord,
        channelId,
        confirmationTimeoutMs: timeoutMs,
      });
      await discord
        .send(channelId, `✅ **${ant.name}** completed its work session.`)
        .catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await discord
        .send(
          channelId,
          `❌ **${ant.name}** crashed: ${message}\nRestarting in ${RESTART_DELAY_MS / 1000}s…`
        )
        .catch(() => {});
      await Bun.sleep(RESTART_DELAY_MS);
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
