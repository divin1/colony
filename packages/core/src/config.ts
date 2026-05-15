import { z } from "zod";
import { parse } from "yaml";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Replaces ${VAR_NAME} with the corresponding environment variable.
// Throws if the variable is not set — fail fast on missing secrets.
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const val = process.env[name];
    if (val === undefined) {
      throw new Error(`Missing environment variable: ${name}`);
    }
    return val;
  });
}

const EnvString = z.string().transform((value, ctx) => {
  try {
    return interpolateEnv(value);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});

// --- colony.yaml ---

export const ColonyConfigSchema = z.object({
  name: z.string(),
  integrations: z
    .object({
      discord: z
        .object({
          token: EnvString,
          guild: EnvString,
        })
        .optional(),
      // Lightweight alternative to the full Discord bot: just a webhook URL.
      // Supports send-only notifications; cannot receive commands from Discord.
      discord_webhook: z
        .object({
          url: EnvString,
        })
        .optional(),
      github: z
        .object({
          token: EnvString,
        })
        .optional(),
    })
    .optional(),
  defaults: z
    .object({
      // Sleep between runs for ants with no triggers/schedule. Default: run immediately.
      poll_interval: z.string().optional(),
      // Git identity used for all commits made by ants in this colony.
      git: z
        .object({
          user_name: z.string().optional(),
          user_email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  // Local web dashboard. When set, an HTTP server is started on this port.
  monitoring: z
    .object({
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
});

export type ColonyConfig = z.infer<typeof ColonyConfigSchema>;

// --- ants/<name>.yaml ---

const TriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github_issue"),
    labels: z.array(z.string()).default([]),
  }),
  z.object({ type: z.literal("discord_command") }),
]);

// Supported engine names. "cli" uses a custom binary via the cli sub-config.
const EngineEnum = z.enum([
  "claude-cli",
  "codex",
  "gemini-cli",
  "opencode",
  "cli",
]);

export const AntConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  integrations: z
    .object({
      github: z
        .object({
          repos: z.array(z.string()).default([]),
        })
        .optional(),
      discord: z
        .object({
          channel: z.string(),
        })
        .optional(),
    })
    .optional(),
  schedule: z
    .object({
      cron: z.string(),
    })
    .optional(),
  triggers: z.array(TriggerSchema).optional(),
  state: z
    .object({
      // "memory" resets on restart; "sqlite" persists across restarts.
      backend: z.enum(["memory", "sqlite"]).default("memory"),
      path: z.string().default("./colony-state.db"),
    })
    .optional(),
  // Paths to SKILL.md files (relative to the colony directory) injected into
  // the system prompt at the start of each session.
  skills: z.array(z.string()).optional(),
  // How long to sleep between runs for ants with no triggers/schedule.
  // Overrides colony-level defaults.poll_interval if set.
  poll_interval: z.string().optional(),
  // Where the ant's LLM text output is routed.
  //   "discord" — posted to Discord (default)
  //   "console" — printed to terminal only
  //   "both"    — printed to terminal AND posted to Discord
  logging: z
    .object({
      lm_output: z.enum(["discord", "console", "both"]).default("discord"),
    })
    .optional(),
  // Which agent CLI engine to use for this ant. Defaults to "claude-cli".
  // Deprecated values "claude" and "gemini" are remapped automatically.
  engine: z.preprocess((val) => {
    if (val === "claude") {
      console.warn(
        '[colony] engine: "claude" is deprecated — use engine: "claude-cli" instead'
      );
      return "claude-cli";
    }
    if (val === "gemini") {
      console.warn(
        '[colony] engine: "gemini" is deprecated — use engine: "gemini-cli" instead'
      );
      return "gemini-cli";
    }
    return val;
  }, EngineEnum).default("claude-cli"),
  // Custom CLI sub-config. Only used when engine is "cli".
  cli: z
    .object({
      binary: z.string(),
      args: z.array(z.string()).default([]),
    })
    .optional(),
});

export type AntConfig = z.infer<typeof AntConfigSchema>;

// --- Aggregated result ---

export interface LoadedConfig {
  colony: ColonyConfig;
  ants: AntConfig[];
  /** Absolute path to the directory containing colony.yaml. */
  configDir: string;
}

// --- Internals ---

function readYaml(filePath: string): unknown {
  return parse(readFileSync(filePath, "utf-8"));
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

// --- Public loader ---

export function loadConfig(dir: string): LoadedConfig {
  const colonyPath = join(dir, "colony.yaml");

  let rawColony: unknown;
  try {
    rawColony = readYaml(colonyPath);
  } catch (err) {
    throw new Error(`Failed to read ${colonyPath}: ${(err as Error).message}`);
  }

  const colonyResult = ColonyConfigSchema.safeParse(rawColony);
  if (!colonyResult.success) {
    throw new Error(`Invalid colony.yaml:\n${formatZodError(colonyResult.error)}`);
  }

  const antsDir = join(dir, "ants");
  let antFiles: string[];
  try {
    antFiles = readdirSync(antsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml")
    );
  } catch {
    antFiles = [];
  }

  const ants = antFiles.map((file) => {
    const antPath = join(antsDir, file);
    let rawAnt: unknown;
    try {
      rawAnt = readYaml(antPath);
    } catch (err) {
      throw new Error(`Failed to read ${antPath}: ${(err as Error).message}`);
    }

    const antResult = AntConfigSchema.safeParse(rawAnt);
    if (!antResult.success) {
      throw new Error(`Invalid ${file}:\n${formatZodError(antResult.error)}`);
    }
    return antResult.data;
  });

  return { colony: colonyResult.data, ants, configDir: dir };
}
