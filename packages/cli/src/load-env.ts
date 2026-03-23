import { readFileSync, existsSync } from "node:fs";

function parseAndApply(raw: string): void {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    const value = val.replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

/** Load a .env file explicitly. Exits with an error if the file cannot be read. */
export function loadEnvFile(envPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    console.error(`Error: cannot read env file: ${envPath}`);
    process.exit(1);
  }
  parseAndApply(raw);
}

/** Silently load a .env file if it exists. No-op if the file is absent. */
export function tryLoadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  try {
    parseAndApply(readFileSync(envPath, "utf8"));
  } catch {
    // Ignore unreadable file on auto-load.
  }
}
