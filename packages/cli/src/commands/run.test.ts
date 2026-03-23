import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "colony-run-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const CLI_ROOT = join(import.meta.dir, "../../../..");

function spawnRun(
  dir: string,
  env?: Record<string, string | undefined>,
  extraArgs: string[] = []
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(
    [process.execPath, "run", "packages/cli/src/index.ts", "run", ...extraArgs, dir],
    {
      cwd: CLI_ROOT,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
}

describe("colony run", () => {
  it("fails when colony.yaml is missing", async () => {
    const dir = join(tempDir, "empty");
    mkdirSync(dir, { recursive: true });

    const proc = spawnRun(dir);
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error:");
  });

  it("fails when colony.yaml has no discord integration", async () => {
    const dir = join(tempDir, "no-discord");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "colony.yaml"), "name: test\n");
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: w\ndescription: d\ninstructions: i\n"
    );

    const proc = spawnRun(dir);
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("discord");
  });

  it("fails when no ant configs exist", async () => {
    const dir = join(tempDir, "no-ants");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: test\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: g\n"
    );

    const proc = spawnRun(dir, { DISCORD_TOKEN: "fake-token" });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("No ant configs found");
  });

  it("fails with invalid ant config", async () => {
    const dir = join(tempDir, "bad-ant");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: test\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: g\n"
    );
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(join(dir, "ants", "bad.yaml"), "name: bad\n"); // missing required fields

    const proc = spawnRun(dir, { DISCORD_TOKEN: "fake-token" });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error:");
  });

  it("auto-loads .env from the colony directory when --env is not given", async () => {
    const dir = join(tempDir, "auto-env");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: auto-env-test\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: g\n"
    );
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: worker\ndescription: Test\ninstructions: Work.\nintegrations:\n  discord:\n    channel: ch\n"
    );
    // Place .env in the colony dir — no --env flag needed.
    writeFileSync(join(dir, ".env"), "DISCORD_TOKEN=auto-loaded-token\n");

    const env: Record<string, string | undefined> = { ...process.env, DISCORD_TOKEN: undefined };
    const proc = spawnRun(dir, env);

    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    clearTimeout(timeout);

    const output = stdout + stderr;
    expect(output.includes("auto-env-test") || output.includes("Fatal:")).toBe(true);
    expect(output).not.toContain("Missing env var");
  });

  it("--env loads variables from the file before config validation", async () => {
    const dir = join(tempDir, "env-flag");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: env-test\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: g\n"
    );
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: worker\ndescription: Test\ninstructions: Work.\nintegrations:\n  discord:\n    channel: ch\n"
    );
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "DISCORD_TOKEN=fake-token\n");

    // Pass --env but strip DISCORD_TOKEN from the process env so only the file supplies it.
    const env: Record<string, string | undefined> = { ...process.env, DISCORD_TOKEN: undefined };
    const proc = spawnRun(dir, env, ["--env", envFile]);

    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    clearTimeout(timeout);

    // Config validation passed if we see the colony name or hit the Discord connection step.
    const output = stdout + stderr;
    expect(output.includes("env-test") || output.includes("Fatal:")).toBe(true);
    // Must not fail on a missing env var.
    expect(output).not.toContain("Missing env var");
  });

  it("--env reports an error for a missing file", async () => {
    const dir = join(tempDir, "bad-env");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "colony.yaml"), "name: test\n");

    const proc = spawnRun(dir, {}, ["--env", join(dir, "nonexistent.env")]);
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error:");
  });

  it("prints the colony name when starting with valid config", async () => {
    const dir = join(tempDir, "valid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: my-test-colony\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: g\n"
    );
    mkdirSync(join(dir, "ants"), { recursive: true });
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: worker\ndescription: Test\ninstructions: Work.\nintegrations:\n  discord:\n    channel: ch\n"
    );

    // The run command will try to connect to Discord and fail (fake token).
    // We just verify it gets past config validation and prints the startup message.
    const proc = spawnRun(dir, { DISCORD_TOKEN: "fake-token" });

    // Give it a moment to start, then kill it — we just need the initial output.
    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    clearTimeout(timeout);

    // It should either print the starting message or fail at Discord connection — both valid.
    const output = stdout + stderr;
    const passedConfigValidation =
      output.includes("my-test-colony") || output.includes("Fatal:");
    expect(passedConfigValidation).toBe(true);
  });
});
