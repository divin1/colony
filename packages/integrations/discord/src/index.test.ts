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

  it("on() handler is called when emit() fires with matching event", () => {
    const discord = new DiscordIntegration(config);
    const received: unknown[] = [];
    discord.on<{ content: string }>("discord_command", (payload) => {
      received.push(payload);
    });
    discord.emit("discord_command", { content: "hello" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ content: "hello" });
  });

  it("on() does not call handler for a different event", () => {
    const discord = new DiscordIntegration(config);
    const received: unknown[] = [];
    discord.on<string>("discord_command", (p) => received.push(p));
    discord.emit("other_event", { content: "should not arrive" });
    expect(received).toHaveLength(0);
  });

  it("multiple on() handlers for same event are all called", () => {
    const discord = new DiscordIntegration(config);
    const calls: number[] = [];
    discord.on<string>("discord_command", () => calls.push(1));
    discord.on<string>("discord_command", () => calls.push(2));
    discord.emit("discord_command", "test");
    expect(calls).toEqual([1, 2]);
  });
});
