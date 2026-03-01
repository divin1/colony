import { runAnt } from "./ant";
import type { ConfirmationChannel } from "./hooks";
import type { LoadedConfig, AntConfig, ColonyConfig } from "./config";

// Extended interface the runner needs beyond ConfirmationChannel.
// DiscordIntegration satisfies this structurally — core does not depend on @colony/discord.
export interface RunnerDiscord extends ConfirmationChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  resolveChannelId(nameOrId: string): Promise<string>;
}

const RESTART_DELAY_MS = 10_000;

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

// Runs a single ant in an infinite supervisor loop.
// On crash: logs to Discord and restarts after RESTART_DELAY_MS.
// Never resolves — returns Promise<never> so Promise.all waits indefinitely.
async function runAntWithSupervision(
  ant: AntConfig,
  colony: ColonyConfig,
  discord: RunnerDiscord
): Promise<never> {
  const channelName = ant.integrations?.discord?.channel;
  if (!channelName) {
    throw new Error(`Ant "${ant.name}" has no discord.channel configured`);
  }

  const channelId = await discord.resolveChannelId(channelName);
  const timeoutMs = parseTimeoutMs(
    colony.defaults?.confirmation_timeout ?? "30m"
  );

  await discord.send(channelId, `🐜 Ant **${ant.name}** is starting.`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runAnt(
        `You are ${ant.name}. ${ant.description}. Begin your work session now.`,
        {
          config: ant,
          channel: discord,
          channelId,
          confirmationTimeoutMs: timeoutMs,
        }
      );
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
  }
}

// Connects to Discord, launches all ants concurrently, and runs until the process is killed.
// Each ant has its own supervisor loop — a crash in one ant does not affect others.
export async function runColony(
  config: LoadedConfig,
  discord: RunnerDiscord
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
        runAntWithSupervision(ant, config.colony, discord)
      )
    );
  } finally {
    await discord.disconnect();
  }
}
