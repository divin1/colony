import { Command } from "@commander-js/extra-typings";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const COLONY_YAML = `name: my-colony

# monitoring.port exposes the REST API and web dashboard.
monitoring:
  port: 8080

# All integrations are optional.
#
# Full Discord bot — lets humans send commands to ants from Discord channels.
# integrations:
#   discord:
#     token: \${DISCORD_TOKEN}
#     guild: my-server
#
# Webhook-only — send-only notifications, no bot setup required.
# integrations:
#   discord_webhook:
#     url: \${DISCORD_WEBHOOK_URL}
#
# GitHub — enables issue polling and comment-back.
# integrations:
#   github:
#     token: \${GITHUB_TOKEN}

defaults:
  poll_interval: 5m
`;

const WORKER_YAML = `name: worker
description: A general-purpose autonomous worker ant

instructions: |
  You are Worker, an autonomous assistant responsible for maintaining this project.
  Review open GitHub issues labelled 'ant-ready', implement fixes, and report back.
  Always run the test suite before opening a PR. Never force-push to main.

# engine: claude-cli  # default; also supports: gemini-cli, codex, opencode, cli

# Uncomment to link to a GitHub repo and a Discord channel:
# integrations:
#   github:
#     repos:
#       - my-org/my-repo
#   discord:
#     channel: worker-logs

# Uncomment to run on a schedule:
# schedule:
#   cron: "0 9 * * 1-5"

# Uncomment to trigger on GitHub issues:
# triggers:
#   - type: github_issue
#     labels: [ant-ready]
`;

const ENV = `# Fill in any tokens you need.
# DISCORD_TOKEN=your-discord-bot-token-here
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
# GITHUB_TOKEN=your-github-personal-access-token-here
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
    writeFileSync(join(target, ".env"), ENV);

    console.log(`Colony scaffolded at ${target}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  1. cd ${dir}`);
    console.log("  2. Edit colony.yaml to add any integrations you need");
    console.log("  3. Edit ants/worker.yaml to describe your ant's role");
    console.log("  4. colony validate .");
    console.log("  5. colony run .");
    console.log("");
    console.log("Dashboard will be available at http://localhost:8080 once running.");
  });
