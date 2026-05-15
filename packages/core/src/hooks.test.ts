import { describe, it, expect, mock } from "bun:test";
import type { ConfirmationChannel } from "./hooks";

describe("ConfirmationChannel", () => {
  it("can be satisfied structurally", async () => {
    const channel: ConfirmationChannel = {
      send: mock(async () => ({ id: "msg-1" })),
      addReaction: mock(async () => {}),
      waitForReaction: mock(async () => null),
    };

    const sent = await channel.send("ch-1", "hello");
    expect(sent.id).toBe("msg-1");

    await channel.addReaction("msg-1", "✅");

    const reaction = await channel.waitForReaction("msg-1", {
      timeout: 1000,
      allowedEmojis: ["✅", "❌"],
    });
    expect(reaction).toBeNull();
  });
});
