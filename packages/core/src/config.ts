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
          guild: z.string(),
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
      confirmation_timeout: z.string().default("30m"),
      // Sleep between runs for ants with no triggers/schedule. Default: run immediately.
      poll_interval: z.string().optional(),
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
  confirmation: z
    .object({
      // Tool names that always require human confirmation for this ant.
      always_confirm_tools: z.array(z.string()).default([]),
      // Additional bash command regex patterns that trigger confirmation.
      dangerous_patterns: z.array(z.string()).default([]),
    })
    .optional(),
  state: z
    .object({
      // "memory" resets on restart; "sqlite" persists across restarts.
      backend: z.enum(["memory", "sqlite"]).default("memory"),
      path: z.string().default("./colony-state.db"),
    })
    .optional(),
  // How long to sleep between runs for ants with no triggers/schedule.
  // Overrides colony-level defaults.poll_interval if set.
  poll_interval: z.string().optional(),
  // Controls what Colony does when a dangerous action is detected.
  //   "human"  — forward to Discord for approval (default)
  //   "full"   — auto-approve everything, never contact Discord
  //   "strict" — auto-deny everything flagged, never contact Discord
  autonomy: z.enum(["human", "full", "strict"]).default("human"),
  // Which agent engine to use for this ant. Defaults to "claude".
  engine: z.enum(["claude", "gemini"]).default("claude"),
  // Gemini-specific options. Only used when engine is "gemini".
  gemini: z
    .object({
      model: z.string().default("gemini-2.5-pro"),
    })
    .optional(),
});

export type AntConfig = z.infer<typeof AntConfigSchema>;

// --- Aggregated result ---

export interface LoadedConfig {
  colony: ColonyConfig;
  ants: AntConfig[];
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

  return { colony: colonyResult.data, ants };
}
