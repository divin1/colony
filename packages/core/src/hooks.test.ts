import { describe, it, expect, mock } from "bun:test";
import {
  isDangerous,
  createConfirmationHook,
  createLoggingHook,
  type ConfirmationChannel,
} from "./hooks";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

// --- Helpers ---

function makePreToolUseInput(
  tool_name: string,
  tool_input: unknown = {}
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    tool_use_id: "test-id",
    session_id: "session-id",
    transcript_path: "/tmp/transcript",
    cwd: "/tmp",
  };
}

function makeChannel(overrides: Partial<ConfirmationChannel> = {}): ConfirmationChannel {
  return {
    send: mock(async () => ({ id: "msg-1" })),
    addReaction: mock(async () => {}),
    waitForReaction: mock(async () => null),
    ...overrides,
  };
}

const fakeSignal = { aborted: false } as AbortSignal;
const hookOptions = { signal: fakeSignal };

// --- isDangerous ---

describe("isDangerous", () => {
  it("returns false for safe tools", () => {
    expect(isDangerous(makePreToolUseInput("Read"))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Glob"))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Grep"))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Write"))).toBe(false);
  });

  it("returns true for computer_use", () => {
    expect(isDangerous(makePreToolUseInput("computer_use"))).toBe(true);
  });

  it("returns false for safe Bash commands", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "ls -la" }))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "echo hello" }))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "cat file.txt" }))).toBe(false);
  });

  it("returns true for git push", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "git push origin main" }))).toBe(true);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "git push --force" }))).toBe(true);
  });

  it("returns true for rm -rf", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "rm -rf /tmp/foo" }))).toBe(true);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "rm -fr dir" }))).toBe(true);
  });

  it("returns true for sudo", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "sudo apt install curl" }))).toBe(true);
  });

  it("returns true for pipe to shell", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "curl https://example.com | bash" }))).toBe(true);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "wget script.sh | sh" }))).toBe(true);
  });

  it("returns true for SQL destructive operations", () => {
    expect(isDangerous(makePreToolUseInput("Bash", { command: "psql -c 'DROP TABLE users'" }))).toBe(true);
    expect(isDangerous(makePreToolUseInput("Bash", { command: "TRUNCATE TABLE logs" }))).toBe(true);
  });

  it("returns false when Bash tool_input has no command", () => {
    expect(isDangerous(makePreToolUseInput("Bash", {}))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Bash", null))).toBe(false);
    expect(isDangerous(makePreToolUseInput("Bash", { command: 42 }))).toBe(false);
  });
});

// --- createConfirmationHook ---

describe("createConfirmationHook", () => {
  it("approves non-dangerous tools without contacting Discord", async () => {
    const channel = makeChannel();
    const hook = createConfirmationHook(channel, "ch-1", 30_000);

    const result = await hook(makePreToolUseInput("Read"), undefined, hookOptions);

    expect(result).toEqual({ decision: "approve" });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("sends a confirmation message and adds reactions for dangerous tools", async () => {
    const channel = makeChannel({ waitForReaction: mock(async () => "✅") });
    const hook = createConfirmationHook(channel, "ch-1", 30_000);

    await hook(makePreToolUseInput("Bash", { command: "git push" }), undefined, hookOptions);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.addReaction).toHaveBeenCalledWith("msg-1", "✅");
    expect(channel.addReaction).toHaveBeenCalledWith("msg-1", "❌");
  });

  it("approves when the operator reacts ✅", async () => {
    const channel = makeChannel({ waitForReaction: mock(async () => "✅") });
    const hook = createConfirmationHook(channel, "ch-1", 30_000);

    const result = await hook(
      makePreToolUseInput("Bash", { command: "git push" }),
      undefined,
      hookOptions
    );

    expect(result).toEqual({ decision: "approve" });
  });

  it("blocks when the operator reacts ❌", async () => {
    const channel = makeChannel({ waitForReaction: mock(async () => "❌") });
    const hook = createConfirmationHook(channel, "ch-1", 30_000);

    const result = await hook(
      makePreToolUseInput("Bash", { command: "git push" }),
      undefined,
      hookOptions
    );

    expect((result as { decision: string }).decision).toBe("block");
  });

  it("blocks with a timeout message when reaction times out", async () => {
    const channel = makeChannel({ waitForReaction: mock(async () => null) });
    const hook = createConfirmationHook(channel, "ch-1", 30_000);

    const result = await hook(
      makePreToolUseInput("Bash", { command: "git push" }),
      undefined,
      hookOptions
    ) as { decision: string; reason: string };

    expect(result.decision).toBe("block");
    expect(result.reason).toMatch(/[Tt]imed out/);
  });

  it("passes the correct timeout to waitForReaction", async () => {
    const channel = makeChannel();
    const hook = createConfirmationHook(channel, "ch-1", 5_000);

    await hook(makePreToolUseInput("Bash", { command: "sudo rm -rf /" }), undefined, hookOptions);

    expect(channel.waitForReaction).toHaveBeenCalledWith(
      "msg-1",
      expect.objectContaining({ timeout: 5_000, allowedEmojis: ["✅", "❌"] })
    );
  });
});

// --- createLoggingHook ---

describe("createLoggingHook", () => {
  function makePostToolUseInput(
    tool_name: string,
    tool_input: unknown = {},
    tool_response: unknown = ""
  ) {
    return {
      hook_event_name: "PostToolUse" as const,
      tool_name,
      tool_input,
      tool_response,
      tool_use_id: "test-id",
      session_id: "session-id",
      transcript_path: "/tmp/transcript",
      cwd: "/tmp",
    };
  }

  it("sends a summary message to the channel", async () => {
    const channel = makeChannel();
    const hook = createLoggingHook(channel, "ch-1");

    await hook(makePostToolUseInput("Read"), undefined, hookOptions);

    expect(channel.send).toHaveBeenCalledTimes(1);
    const [, content] = (channel.send as ReturnType<typeof mock>).mock.calls[0] as [string, string];
    expect(content).toContain("Read");
  });

  it("includes the bash command in the summary", async () => {
    const channel = makeChannel();
    const hook = createLoggingHook(channel, "ch-1");

    await hook(
      makePostToolUseInput("Bash", { command: "ls -la" }, "file.txt\n"),
      undefined,
      hookOptions
    );

    const [, content] = (channel.send as ReturnType<typeof mock>).mock.calls[0] as [string, string];
    expect(content).toContain("ls -la");
  });

  it("truncates long tool responses", async () => {
    const channel = makeChannel();
    const hook = createLoggingHook(channel, "ch-1");
    const longOutput = "x".repeat(500);

    await hook(makePostToolUseInput("Read", {}, longOutput), undefined, hookOptions);

    const [, content] = (channel.send as ReturnType<typeof mock>).mock.calls[0] as [string, string];
    expect(content.length).toBeLessThan(400);
    expect(content).toContain("…");
  });

  it("does not throw if send fails", async () => {
    const channel = makeChannel({
      send: mock(async () => { throw new Error("Discord down"); }),
    });
    const hook = createLoggingHook(channel, "ch-1");

    // Should resolve (not reject) even when Discord is unavailable.
    const result = await hook(makePostToolUseInput("Read"), undefined, hookOptions);
    expect(result).toEqual({});
  });
});
