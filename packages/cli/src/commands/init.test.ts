import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "@colony/core";

// Helper: create a temp dir and clean up after.
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "colony-init-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Run the init scaffolding logic without invoking the CLI binary.
async function runInit(dir: string): Promise<void> {
  const { initCommand } = await import("./init");
  // Parse with the target dir as an argument.
  await initCommand.parseAsync([dir], { from: "user" });
}

describe("colony init", () => {
  it("creates colony.yaml in the target directory", async () => {
    const target = join(tempDir, "my-colony");
    await runInit(target);
    expect(existsSync(join(target, "colony.yaml"))).toBe(true);
  });

  it("creates ants/worker.yaml in the target directory", async () => {
    const target = join(tempDir, "my-colony");
    await runInit(target);
    expect(existsSync(join(target, "ants", "worker.yaml"))).toBe(true);
  });

  it("creates .env in the target directory", async () => {
    const target = join(tempDir, "my-colony");
    await runInit(target);
    expect(existsSync(join(target, ".env"))).toBe(true);
  });

  it("colony.yaml contains a non-empty name field", async () => {
    const target = join(tempDir, "my-colony");
    await runInit(target);
    const raw = readFileSync(join(target, "colony.yaml"), "utf-8");
    expect(raw).toContain("name:");
  });

  it("ants/worker.yaml contains required fields", async () => {
    const target = join(tempDir, "my-colony");
    await runInit(target);
    const raw = readFileSync(join(target, "ants", "worker.yaml"), "utf-8");
    expect(raw).toContain("name:");
    expect(raw).toContain("description:");
    expect(raw).toContain("instructions:");
  });

  it("scaffolded config passes loadConfig when env vars are set", async () => {
    const target = join(tempDir, "my-colony");

    // Set dummy env vars that the template references.
    process.env.DISCORD_TOKEN = "fake-discord-token";
    process.env.GITHUB_TOKEN = "fake-github-token";

    try {
      await runInit(target);
      // loadConfig should not throw — it validates the schema.
      const config = loadConfig(target);
      expect(config.colony.name).toBe("my-colony");
      expect(config.ants.length).toBeGreaterThan(0);
    } finally {
      delete process.env.DISCORD_TOKEN;
      delete process.env.GITHUB_TOKEN;
    }
  });
});
