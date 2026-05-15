import { Command } from "@commander-js/extra-typings";
import { loadConfig, runColony, ConsoleDiscord, type RunnerDiscord } from "@colony/core";
import { DiscordIntegration } from "@colony/discord";
import { GitHubIntegration } from "@colony/github";
import { join } from "node:path";
import { loadEnvFile, tryLoadEnvFile } from "../load-env";

// Send-only Discord implementation that posts to an incoming webhook URL.
// No bot setup required — just a webhook URL from Discord server settings.
// Cannot receive commands; ants cannot be paused/resumed via Discord.
class WebhookDiscord implements RunnerDiscord {
  constructor(private readonly url: string) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async send(_channelId: string, content: string): Promise<{ id: string }> {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } catch {
      // Best-effort — don't crash the colony if the webhook POST fails.
    }
    return { id: `webhook-${Date.now()}` };
  }
  async resolveChannelId(nameOrId: string): Promise<string> {
    return nameOrId;
  }
  on<T>(_event: string, _handler: (payload: T) => void): void {
    // Webhook is send-only; incoming Discord commands are not supported.
  }
}

export const runCommand = new Command("run")
  .description("Launch all configured ants. Discord is optional.")
  .argument("[dir]", "Path to the colony config directory", process.cwd())
  .option("--env <file>", "Path to a .env file to load before starting")
  .action(async (dir, opts) => {
    if (opts.env) {
      loadEnvFile(opts.env);
    } else {
      tryLoadEnvFile(join(dir, ".env"));
    }

    // --- Load and validate config ---
    let config;
    try {
      config = loadConfig(dir);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }

    if (config.ants.length === 0) {
      console.error(
        `Error: No ant configs found in ${dir}/ants/. Add at least one ants/*.yaml file.`
      );
      process.exit(1);
    }

    // --- Wire up the messaging integration ---
    // Priority: full Discord bot > webhook-only > console (no messaging config).
    const discordConfig = config.colony.integrations?.discord;
    const webhookConfig = config.colony.integrations?.discord_webhook;

    let discord: RunnerDiscord;
    if (discordConfig) {
      discord = new DiscordIntegration(discordConfig);
    } else if (webhookConfig) {
      discord = new WebhookDiscord(webhookConfig.url);
      console.log("Discord webhook configured — status messages will be posted to the webhook.");
      console.log("Note: ants cannot receive commands via Discord in webhook-only mode.");
    } else {
      discord = new ConsoleDiscord();
      console.log("No Discord integration configured — all output goes to the console.");
    }

    // --- Wire up GitHub ---
    const githubConfig = config.colony.integrations?.github;
    const github = githubConfig ? new GitHubIntegration(githubConfig) : undefined;

    // Graceful shutdown on Ctrl+C or SIGTERM.
    const shutdown = (signal: string) => {
      console.log(`\nReceived ${signal} — disconnecting…`);
      discord.disconnect().finally(() => process.exit(0));
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    // --- Run ---
    console.log(
      `Starting colony "${config.colony.name}" with ${config.ants.length} ant(s)…`
    );

    try {
      await runColony(config, discord, github);
    } catch (err) {
      console.error(`Fatal: ${(err as Error).message}`);
      await discord.disconnect().catch(() => {});
      process.exit(1);
    }
  });
