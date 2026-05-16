import { z } from "zod";
import { parse, stringify } from "yaml";
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
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
          // Secret used to verify X-Hub-Signature-256 on incoming GitHub webhooks.
          // Set this to the same value you configure in GitHub's webhook settings.
          webhook_secret: EnvString.optional(),
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

// --- Raw colony config schema (no env interpolation) ---
// Used when writing colony.yaml from the API — tokens stay as template strings.

export const RawColonyConfigSchema = z.object({
  name: z.string(),
  integrations: z
    .object({
      discord: z.object({ token: z.string(), guild: z.string() }).optional(),
      discord_webhook: z.object({ url: z.string() }).optional(),
      github: z.object({ token: z.string(), webhook_secret: z.string().optional() }).optional(),
    })
    .optional(),
  defaults: z
    .object({
      poll_interval: z.string().optional(),
      git: z
        .object({
          user_name: z.string().optional(),
          user_email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  monitoring: z
    .object({ port: z.number().int().min(1).max(65535) })
    .optional(),
});

// --- Raw readers (no Zod validation, no env interpolation) ---
// Used by the config API to return template values like ${DISCORD_TOKEN} as-is.

export function readRawColonyYaml(dir: string): unknown {
  return readYaml(join(dir, "colony.yaml"));
}

export function readRawAntYamls(dir: string): unknown[] {
  const antsDir = join(dir, "ants");
  let files: string[];
  try {
    files = readdirSync(antsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml")
    );
  } catch {
    return [];
  }
  return files.map((file) => readYaml(join(antsDir, file)));
}

// Finds a single ant config by its `name` field (not filename).
export function readRawAntYaml(dir: string, name: string): unknown | null {
  return findAntFileEntry(dir, name)?.raw ?? null;
}

// --- Config write utilities ---

// Result type for write operations — callers map to HTTP status codes.
export type ConfigWriteResult =
  | { ok: true }
  | { ok: false; type: "not_found" }
  | { ok: false; type: "conflict" }
  | { ok: false; type: "invalid"; error: string }
  | { ok: false; type: "error"; error: string };

// Returns the path to the ant's YAML file (matched by name field) and its raw content.
function findAntFileEntry(dir: string, name: string): { path: string; raw: unknown } | null {
  const antsDir = join(dir, "ants");
  let files: string[];
  try {
    files = readdirSync(antsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml")
    );
  } catch {
    return null;
  }
  for (const file of files) {
    const filePath = join(antsDir, file);
    const raw = readYaml(filePath);
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>).name === name) {
      return { path: filePath, raw };
    }
  }
  return null;
}

// Sanitises an ant name to a safe filename: lowercase, non-alphanumeric runs → hyphens.
function antFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".yaml";
}

function toYaml(data: unknown): string {
  return stringify(data, { lineWidth: 0 });
}

// Updates an existing ant's YAML file (matched by name field).
// Returns not_found if no file with that name field exists.
// Returns invalid if the body fails AntConfigSchema validation.
// The name in the body must match the name argument (renames are not allowed here).
export function writeAntYaml(dir: string, name: string, body: unknown): ConfigWriteResult {
  const result = AntConfigSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, type: "invalid", error: formatZodError(result.error) };
  }
  if (result.data.name !== name) {
    return {
      ok: false,
      type: "invalid",
      error: `name in body ("${result.data.name}") must match URL parameter ("${name}")`,
    };
  }
  const entry = findAntFileEntry(dir, name);
  if (!entry) return { ok: false, type: "not_found" };
  try {
    writeFileSync(entry.path, toYaml(result.data), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, type: "error", error: (err as Error).message };
  }
}

// Creates a new ant YAML file. Returns conflict if an ant with that name already exists.
export function createAntYaml(dir: string, body: unknown): ConfigWriteResult {
  const result = AntConfigSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, type: "invalid", error: formatZodError(result.error) };
  }
  if (findAntFileEntry(dir, result.data.name)) {
    return { ok: false, type: "conflict" };
  }
  const antsDir = join(dir, "ants");
  try {
    readdirSync(antsDir); // ensure directory exists — throws if not
  } catch {
    return { ok: false, type: "error", error: `ants/ directory not found in ${dir}` };
  }
  try {
    writeFileSync(join(antsDir, antFilename(result.data.name)), toYaml(result.data), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, type: "error", error: (err as Error).message };
  }
}

// Deletes the YAML file for the named ant. Returns not_found if no such file exists.
export function deleteAntYaml(dir: string, name: string): ConfigWriteResult {
  const entry = findAntFileEntry(dir, name);
  if (!entry) return { ok: false, type: "not_found" };
  try {
    unlinkSync(entry.path);
    return { ok: true };
  } catch (err) {
    return { ok: false, type: "error", error: (err as Error).message };
  }
}

// Writes colony.yaml from a validated JSON body. Uses RawColonyConfigSchema
// (plain strings) so token template values like ${DISCORD_TOKEN} are kept as-is.
export function writeColonyYaml(dir: string, body: unknown): ConfigWriteResult {
  const result = RawColonyConfigSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, type: "invalid", error: formatZodError(result.error) };
  }
  try {
    writeFileSync(join(dir, "colony.yaml"), toYaml(result.data), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, type: "error", error: (err as Error).message };
  }
}
