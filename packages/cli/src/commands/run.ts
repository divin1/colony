import { Command } from "@commander-js/extra-typings";
import { loadConfig, runColony } from "@colony/core";
import { DiscordIntegration } from "@colony/discord";
import { GitHubIntegration } from "@colony/github";
import { join } from "node:path";
import { loadEnvFile, tryLoadEnvFile } from "../load-env";

export const runCommand = new Command("run")
  .description("Connect to Discord and launch all configured ants")
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

    const discordConfig = config.colony.integrations?.discord;
    if (!discordConfig) {
      console.error(
        "Error: integrations.discord must be configured in colony.yaml to run."
      );
      process.exit(1);
    }

    if (config.ants.length === 0) {
      console.error(
        `Error: No ant configs found in ${dir}/ants/. Add at least one ants/*.yaml file.`
      );
      process.exit(1);
    }

    // --- Wire up integrations ---
    const discord = new DiscordIntegration(discordConfig);

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
