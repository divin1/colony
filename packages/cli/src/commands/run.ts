import { Command } from "@commander-js/extra-typings";
import { loadConfig, runColony } from "@colony/core";
import { DiscordIntegration } from "@colony/discord";

export const runCommand = new Command("run")
  .description("Connect to Discord and launch all configured ants")
  .argument("[dir]", "Path to the colony config directory", process.cwd())
  .action(async (dir) => {
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

    // --- Wire up integration ---
    const discord = new DiscordIntegration(discordConfig);

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
      await runColony(config, discord);
    } catch (err) {
      console.error(`Fatal: ${(err as Error).message}`);
      await discord.disconnect().catch(() => {});
      process.exit(1);
    }
  });
