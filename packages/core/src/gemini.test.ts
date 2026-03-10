import { describe, it, expect } from "bun:test";
import { runAntWithGemini } from "./gemini";
import type { ConfirmationChannel } from "./hooks";
import type { AntConfig } from "./config";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

function makeAntConfig(overrides: Partial<AntConfig> = {}): AntConfig {
  return {
    name: "test-ant",
    description: "A test ant",
    instructions: "Do test work.",
    engine: "gemini",
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

describe("runAntWithGemini", () => {
  it("sends gemini output to the channel", async () => {
    const channel = makeChannel();
    await runAntWithGemini("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc("hello from gemini", 0),
    });

    expect(channel.messages).toEqual(["hello from gemini"]);
  });

  it("sends nothing when gemini produces no output", async () => {
    const channel = makeChannel();
    await runAntWithGemini("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc("", 0),
    });

    expect(channel.messages).toHaveLength(0);
  });

  it("throws when gemini exits with non-zero code", async () => {
    const channel = makeChannel();
    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        _spawn: () => makeFakeProc("", 1),
      })
    ).rejects.toThrow("gemini exited with code 1");
  });

  it("throws when gemini CLI cannot be found", async () => {
    const channel = makeChannel();
    await expect(
      runAntWithGemini("do some work", {
        config: makeAntConfig(),
        channel,
        channelId: "ch-1",
        _spawn: () => makeFakeProc("", 0, new Error("spawn gemini ENOENT")),
      })
    ).rejects.toThrow("Failed to spawn gemini CLI");
  });

  it("chunks output longer than 1900 characters", async () => {
    const longOutput = "x".repeat(4000);
    const channel = makeChannel();
    await runAntWithGemini("do some work", {
      config: makeAntConfig(),
      channel,
      channelId: "ch-1",
      _spawn: () => makeFakeProc(longOutput, 0),
    });

    expect(channel.messages.length).toBeGreaterThan(1);
    expect(channel.messages.join("")).toBe(longOutput);
  });
});
