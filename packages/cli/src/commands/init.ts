import { Command } from "@commander-js/extra-typings";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const COLONY_YAML = `name: my-colony

integrations:
  discord:
    token: \${DISCORD_TOKEN}
    guild: my-server
  github:
    token: \${GITHUB_TOKEN}

defaults:
  confirmation_timeout: 30m
`;

const WORKER_YAML = `name: worker
description: A general-purpose autonomous worker ant

instructions: |
  You are Worker, an autonomous assistant responsible for maintaining this project.
  Review open GitHub issues labelled 'ant-ready', implement fixes, and report back.
  Always run the test suite before opening a PR. Never force-push to main.

integrations:
  github:
    repos:
      - my-org/my-repo
  discord:
    channel: worker-logs

schedule:
  cron: "0 9 * * 1-5"

triggers:
  - type: github_issue
    labels: [ant-ready]
  - type: discord_command
`;

const ENV_EXAMPLE = `# Copy this file to .env and fill in the values.
DISCORD_TOKEN=your-discord-bot-token-here
GITHUB_TOKEN=your-github-personal-access-token-here
`;

export const initCommand = new Command("init")
  .description("Scaffold a new colony directory with example config files")
  .argument("[dir]", "Directory to create the colony in", "./my-colony")
  .action((dir) => {
    const target = resolve(dir);

    if (existsSync(join(target, "colony.yaml"))) {
      console.error(`Error: ${target} already contains a colony.yaml. Aborting.`);
      process.exit(1);
    }

    mkdirSync(join(target, "ants"), { recursive: true });

    writeFileSync(join(target, "colony.yaml"), COLONY_YAML);
    writeFileSync(join(target, "ants", "worker.yaml"), WORKER_YAML);
    writeFileSync(join(target, ".env.example"), ENV_EXAMPLE);

    console.log(`Colony scaffolded at ${target}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  1. cd ${dir}`);
    console.log("  2. cp .env.example .env  # fill in your tokens");
    console.log("  3. Edit colony.yaml and ants/worker.yaml to match your setup");
    console.log("  4. colony validate .");
    console.log("  5. colony run .");
  });
