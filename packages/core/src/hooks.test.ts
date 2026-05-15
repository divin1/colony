import { describe, it, expect, mock } from "bun:test";
import type { ConfirmationChannel } from "./hooks";

describe("ConfirmationChannel", () => {
  it("can be satisfied with just send()", async () => {
    const channel: ConfirmationChannel = {
      send: mock(async () => ({ id: "msg-1" })),
    };

    const sent = await channel.send("ch-1", "hello");
    expect(sent.id).toBe("msg-1");
  });
});
