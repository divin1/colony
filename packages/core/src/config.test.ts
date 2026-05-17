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

  it("parses colony-level poll_interval", () => {
    const result = ColonyConfigSchema.safeParse({
      name: "test",
      defaults: { poll_interval: "10m" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.poll_interval).toBe("10m");
    }
  });

  it("parses git identity config", () => {
    const result = ColonyConfigSchema.safeParse({
      name: "test",
      defaults: { git: { user_name: "Jane Smith", user_email: "jane@example.com" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.git?.user_name).toBe("Jane Smith");
      expect(result.data.defaults?.git?.user_email).toBe("jane@example.com");
    }
  });

  it("parses git identity with only user_name", () => {
    const result = ColonyConfigSchema.safeParse({
      name: "test",
      defaults: { git: { user_name: "Jane Smith" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.git?.user_name).toBe("Jane Smith");
      expect(result.data.defaults?.git?.user_email).toBeUndefined();
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

  it("rejects an unknown trigger type", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      triggers: [{ type: "slack_message" }],
    });
    expect(result.success).toBe(false);
  });

  it("parses state block with defaults", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      state: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state?.backend).toBe("memory");
      expect(result.data.state?.path).toBe("./colony-state.db");
    }
  });

  it("parses state block with sqlite backend", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      state: { backend: "sqlite", path: "/data/colony.db" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state?.backend).toBe("sqlite");
      expect(result.data.state?.path).toBe("/data/colony.db");
    }
  });

  it("rejects an invalid state backend", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      state: { backend: "redis" },
    });
    expect(result.success).toBe(false);
  });

  it("parses poll_interval", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      poll_interval: "5m",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.poll_interval).toBe("5m");
    }
  });

  // --- engine ---

  it("defaults engine to claude-cli", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("claude-cli");
    }
  });

  it("remaps deprecated engine: claude to claude-cli", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "claude",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("claude-cli");
    }
  });

  it("remaps deprecated engine: gemini to gemini-cli", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "gemini",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("gemini-cli");
    }
  });

  it("parses engine: codex", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "codex",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("codex");
    }
  });

  it("parses engine: opencode", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "opencode",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("opencode");
    }
  });

  it("parses engine: cli with binary and args", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "cli",
      cli: { binary: "my-agent", args: ["--mode", "auto"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("cli");
      expect(result.data.cli?.binary).toBe("my-agent");
      expect(result.data.cli?.args).toEqual(["--mode", "auto"]);
    }
  });

  it("defaults cli.args to [] when absent", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "cli",
      cli: { binary: "my-agent" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cli?.args).toEqual([]);
    }
  });

  it("rejects an unknown engine value", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "openai",
    });
    expect(result.success).toBe(false);
  });

  // --- logging ---

  it("logging block is optional — absent by default", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logging).toBeUndefined();
    }
  });

  it("defaults logging.lm_output to discord when logging block is present", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      logging: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logging?.lm_output).toBe("discord");
    }
  });

  it("parses logging.lm_output: console", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      logging: { lm_output: "console" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logging?.lm_output).toBe("console");
    }
  });

  it("parses logging.lm_output: both", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      logging: { lm_output: "both" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logging?.lm_output).toBe("both");
    }
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

  it("returns configDir set to the loaded directory", () => {
    writeFileSync(join(dir, "colony.yaml"), "name: test-colony\n");
    const config = loadConfig(dir);
    expect(config.configDir).toBe(dir);
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
