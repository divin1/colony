import { describe, it, expect } from "bun:test";
import { runAntWithCursor } from "./cursor";
import type { ConfirmationChannel } from "./hooks";
import type { AntConfig } from "./config";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

function makeAntConfig(overrides: Partial<AntConfig> = {}): AntConfig {
  return {
    name: "test-ant",
    description: "A test ant",
    instructions: "Do test work.",
    engine: "cursor",
    ...overrides,
  };
}

function makeChannel(): ConfirmationChannel & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    send: async (_channelId: string, message: string) => {
      messages.push(message);
      return { id: "msg-id" };
    },
    addReaction: async () => {},
    waitForReaction: async () => null,
  };
}

// Builds a fake ChildProcess that emits stdout data and exits.
function makeFakeProc(
  stdout: string,
  exitCode: number,
  spawnError?: Error
): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();

  setImmediate(() => {
    if (spawnError) {
      proc.emit("error", spawnError);
      return;
    }
    (proc as unknown as { stdout: EventEmitter }).stdout.emit(
      "data",
      Buffer.from(stdout)
    );
    proc.emit("close", exitCode);
  });

  return proc;
}

describe("runAntWithCursor", () => {
  it("sends cursor output to the channel", async () => {
    const channel = makeChannel();
    await runAntWithCursor("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc("hello from cursor", 0),
    });

    expect(channel.messages).toEqual(["hello from cursor"]);
  });

  it("sends nothing when cursor produces no output", async () => {
    const channel = makeChannel();
    await runAntWithCursor("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc("", 0),
    });

    expect(channel.messages).toHaveLength(0);
  });

  it("throws when cursor exits with non-zero code", async () => {
    const channel = makeChannel();
    await expect(
      runAntWithCursor("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        _spawn: () => makeFakeProc("", 1),
      })
    ).rejects.toThrow("cursor exited with code 1");
  });

  it("throws when cursor CLI cannot be found", async () => {
    const channel = makeChannel();
    await expect(
      runAntWithCursor("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        _spawn: () => makeFakeProc("", 0, new Error("spawn cursor ENOENT")),
      })
    ).rejects.toThrow("Failed to spawn cursor CLI");
  });

  it("chunks output longer than 1900 characters", async () => {
    const longOutput = "x".repeat(4000);
    const channel = makeChannel();
    await runAntWithCursor("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc(longOutput, 0),
    });

    expect(channel.messages.length).toBeGreaterThan(1);
    expect(channel.messages.join("")).toBe(longOutput);
  });

  it("injects autonomy instructions into the system prompt", async () => {
    let capturedArgs: string[] = [];
    const channel = makeChannel();
    await runAntWithCursor("do some work", {
      config: makeAntConfig({ autonomy: "strict" }),
      channel,
      channelId: "ch-1",
      _spawn: (_cmd, args) => {
        capturedArgs = args;
        return makeFakeProc("done", 0);
      },
    });

    const systemIdx = capturedArgs.indexOf("--system");
    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(capturedArgs[systemIdx + 1]).toContain("strict");
  });
});
