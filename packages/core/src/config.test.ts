import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, ColonyConfigSchema, AntConfigSchema } from "./config";

describe("ColonyConfigSchema", () => {
  it("parses a minimal valid config", () => {
    const result = ColonyConfigSchema.safeParse({ name: "my-colony" });
    expect(result.success).toBe(true);
  });

  it("rejects a config without a name", () => {
    const result = ColonyConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("interpolates env vars in integration tokens", () => {
    process.env.TEST_DISCORD_TOKEN = "tok-abc";
    const result = ColonyConfigSchema.safeParse({
      name: "test",
      integrations: {
        discord: { token: "${TEST_DISCORD_TOKEN}", guild: "my-guild" },
      },
    });
    delete process.env.TEST_DISCORD_TOKEN;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations?.discord?.token).toBe("tok-abc");
    }
  });

  it("fails when a referenced env var is missing", () => {
    delete process.env.MISSING_VAR;
    const result = ColonyConfigSchema.safeParse({
      name: "test",
      integrations: {
        discord: { token: "${MISSING_VAR}", guild: "guild" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("defaults confirmation_timeout to 30m", () => {
    const result = ColonyConfigSchema.safeParse({ name: "test", defaults: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.confirmation_timeout).toBe("30m");
    }
  });
});

describe("AntConfigSchema", () => {
  it("parses a minimal valid ant config", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "You are a worker.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an ant config missing required fields", () => {
    const result = AntConfigSchema.safeParse({ name: "worker" });
    expect(result.success).toBe(false);
  });

  it("parses a github_issue trigger with labels", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      triggers: [{ type: "github_issue", labels: ["bug"] }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults labels to [] on github_issue trigger", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      triggers: [{ type: "github_issue" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const trigger = result.data.triggers?.[0];
      expect(trigger?.type === "github_issue" && trigger.labels).toEqual([]);
    }
  });

  it("rejects an unknown trigger type", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      triggers: [{ type: "slack_message" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("loadConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "colony-test-"));
  });

  it("loads colony.yaml and all ant configs", () => {
    writeFileSync(join(dir, "colony.yaml"), "name: test-colony\n");
    mkdirSync(join(dir, "ants"));
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: worker\ndescription: A worker ant\ninstructions: Do work.\n"
    );
    const config = loadConfig(dir);
    expect(config.colony.name).toBe("test-colony");
    expect(config.ants).toHaveLength(1);
    expect(config.ants[0].name).toBe("worker");
  });

  it("returns an empty ants array when ants/ is absent", () => {
    writeFileSync(join(dir, "colony.yaml"), "name: test-colony\n");
    const config = loadConfig(dir);
    expect(config.ants).toHaveLength(0);
  });

  it("throws when colony.yaml is missing", () => {
    expect(() => loadConfig(dir)).toThrow("Failed to read");
  });

  it("throws on invalid colony.yaml", () => {
    writeFileSync(join(dir, "colony.yaml"), "{}\n");
    expect(() => loadConfig(dir)).toThrow("Invalid colony.yaml");
  });

  it("throws on invalid ant config", () => {
    writeFileSync(join(dir, "colony.yaml"), "name: test-colony\n");
    mkdirSync(join(dir, "ants"));
    writeFileSync(join(dir, "ants", "bad.yaml"), "name: bad\n");
    expect(() => loadConfig(dir)).toThrow("Invalid bad.yaml");
  });

  it("loads multiple ant configs", () => {
    writeFileSync(join(dir, "colony.yaml"), "name: test-colony\n");
    mkdirSync(join(dir, "ants"));
    const antYaml = (name: string) =>
      `name: ${name}\ndescription: ${name} ant\ninstructions: Do it.\n`;
    writeFileSync(join(dir, "ants", "alpha.yaml"), antYaml("alpha"));
    writeFileSync(join(dir, "ants", "beta.yaml"), antYaml("beta"));
    const config = loadConfig(dir);
    expect(config.ants).toHaveLength(2);
  });
});
