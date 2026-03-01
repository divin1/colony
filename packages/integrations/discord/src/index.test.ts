import { describe, it, expect } from "bun:test";
import { DiscordIntegration } from "./index";

// Tests that don't require a live Discord connection.
const config = { token: "fake-token", guild: "test-guild" };

describe("DiscordIntegration", () => {
  it("can be instantiated without connecting", () => {
    const discord = new DiscordIntegration(config);
    expect(discord).toBeInstanceOf(DiscordIntegration);
  });

  it("addReaction throws for an untracked message ID", async () => {
    const discord = new DiscordIntegration(config);
    await expect(discord.addReaction("unknown-id", "✅")).rejects.toThrow(
      "Unknown message ID"
    );
  });

  it("waitForReaction resolves null on timeout", async () => {
    const discord = new DiscordIntegration(config);
    const result = await discord.waitForReaction("any-id", {
      timeout: 10,
      allowedEmojis: ["✅", "❌"],
    });
    expect(result).toBeNull();
  });

  it("waitForReaction resolves null independently for each call", async () => {
    const discord = new DiscordIntegration(config);
    const [a, b] = await Promise.all([
      discord.waitForReaction("msg-1", { timeout: 10, allowedEmojis: ["✅"] }),
      discord.waitForReaction("msg-2", { timeout: 10, allowedEmojis: ["✅"] }),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it("on() registers a handler without throwing", () => {
    const discord = new DiscordIntegration(config);
    expect(() => {
      discord.on<string>("discord_command", (_cmd) => {});
    }).not.toThrow();
  });
});
