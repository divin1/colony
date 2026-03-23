import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "@colony/core";
import { join } from "node:path";
import { loadEnvFile, tryLoadEnvFile } from "../load-env";

export const validateCommand = new Command("validate")
  .description("Validate colony.yaml and all ant configs without starting anything")
  .argument("[dir]", "Path to the colony config directory", process.cwd())
  .option("--env <file>", "Path to a .env file to load before validating")
  .action((dir, opts) => {
    if (opts.env) {
      loadEnvFile(opts.env);
    } else {
      tryLoadEnvFile(join(dir, ".env"));
    }
    let config;
    try {
      config = loadConfig(dir);
    } catch (err) {
      console.error(`Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }

    console.log(`✓ Colony "${config.colony.name}" — config is valid.`);
    console.log(`  ${config.ants.length} ant(s) configured:`);
    for (const ant of config.ants) {
      const channel = ant.integrations?.discord?.channel
        ? ` → #${ant.integrations.discord.channel}`
        : "";
      console.log(`  • ${ant.name}${channel}: ${ant.description}`);
    }
  });
