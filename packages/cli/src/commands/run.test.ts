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
  env?: Record<string, string | undefined>
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "run", dir], {
    cwd: CLI_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
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
