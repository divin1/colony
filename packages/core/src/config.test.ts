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

  it("parses confirmation block with defaults", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      confirmation: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmation?.always_confirm_tools).toEqual([]);
      expect(result.data.confirmation?.dangerous_patterns).toEqual([]);
    }
  });

  it("parses confirmation block with explicit values", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      confirmation: {
        always_confirm_tools: ["Write", "Edit"],
        dangerous_patterns: ["\\bmy-deploy\\.sh\\b"],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmation?.always_confirm_tools).toEqual(["Write", "Edit"]);
      expect(result.data.confirmation?.dangerous_patterns).toEqual(["\\bmy-deploy\\.sh\\b"]);
    }
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

  it("defaults engine to claude", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("claude");
    }
  });

  it("parses engine: gemini", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "gemini",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("gemini");
    }
  });

  it("parses gemini block with model override", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "gemini",
      gemini: { model: "gemini-2.0-flash" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gemini?.model).toBe("gemini-2.0-flash");
    }
  });

  it("defaults gemini model to gemini-2.5-pro", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      engine: "gemini",
      gemini: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gemini?.model).toBe("gemini-2.5-pro");
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

  it("defaults autonomy to human", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autonomy).toBe("human");
    }
  });

  it("parses autonomy: full", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      autonomy: "full",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autonomy).toBe("full");
    }
  });

  it("parses autonomy: strict", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      autonomy: "strict",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autonomy).toBe("strict");
    }
  });

  it("rejects an unknown autonomy value", () => {
    const result = AntConfigSchema.safeParse({
      name: "worker",
      description: "Does work",
      instructions: "Do it.",
      autonomy: "yolo",
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
