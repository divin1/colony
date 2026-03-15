import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "colony-validate-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Scaffold a minimal valid colony directory.
function writeValidColony(dir: string): void {
  writeFileSync(
    join(dir, "colony.yaml"),
    `name: test-colony\nintegrations:\n  discord:\n    token: \${DISCORD_TOKEN}\n    guild: test-guild\n`
  );
  mkdirSync(join(dir, "ants"), { recursive: true });
  writeFileSync(
    join(dir, "ants", "worker.yaml"),
    `name: worker\ndescription: A test worker\ninstructions: Do work.\nintegrations:\n  discord:\n    channel: worker-logs\n`
  );
}

const PROJECT_ROOT = join(import.meta.dir, "../../../..");

async function runValidate(
  dir: string,
  env?: Record<string, string | undefined>
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "validate", dir], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DISCORD_TOKEN: "fake-token", GITHUB_TOKEN: "fake-token", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("colony validate", () => {
  it("succeeds with valid config and prints colony name", async () => {
    const dir = join(tempDir, "colony");
    mkdirSync(dir, { recursive: true });
    writeValidColony(dir);

    const { exitCode, stdout } = await runValidate(dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Colony "test-colony"');
    expect(stdout).toContain("config is valid");
  });

  it("prints the ant count and names", async () => {
    const dir = join(tempDir, "colony");
    mkdirSync(dir, { recursive: true });
    writeValidColony(dir);

    const { stdout } = await runValidate(dir);
    expect(stdout).toContain("1 ant(s) configured");
    expect(stdout).toContain("worker");
  });

  it("fails when colony.yaml is missing", async () => {
    const dir = join(tempDir, "empty");
    mkdirSync(dir, { recursive: true });

    const { exitCode, stderr } = await runValidate(dir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Validation failed");
  });

  it("fails when colony.yaml has invalid schema", async () => {
    const dir = join(tempDir, "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "colony.yaml"), "not_a_valid_key: true\n");

    const { exitCode, stderr } = await runValidate(dir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Validation failed");
  });

  it("fails when an ant config is invalid", async () => {
    const dir = join(tempDir, "bad-ant");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "colony.yaml"), "name: test\n");
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(join(dir, "ants", "bad.yaml"), "name: bad\n"); // missing required fields

    const { exitCode, stderr } = await runValidate(dir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Validation failed");
  });

  it("succeeds with zero ants", async () => {
    const dir = join(tempDir, "no-ants");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "colony.yaml"), "name: lonely-colony\n");

    const { exitCode, stdout } = await runValidate(dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0 ant(s) configured");
  });

  it("fails when a referenced env var is missing", async () => {
    const dir = join(tempDir, "missing-env");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: test\nintegrations:\n  discord:\n    token: ${NONEXISTENT_VAR_12345}\n    guild: g\n"
    );

    const { exitCode, stderr } = await runValidate(dir, {
      DISCORD_TOKEN: undefined,
      NONEXISTENT_VAR_12345: undefined,
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Validation failed");
  });
});
