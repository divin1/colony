import { describe, it, expect } from "bun:test";
import {
  AntSessionError,
  classifyAssistantError,
  classifyResultError,
} from "./errors";
import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";

describe("classifyAssistantError", () => {
  const cases: Array<[SDKAssistantMessageError, string]> = [
    ["rate_limit", "rate_limit"],
    ["billing_error", "billing"],
    ["authentication_failed", "auth"],
    ["server_error", "transient"],
    ["unknown", "transient"],
    ["invalid_request", "permanent"],
    ["max_output_tokens", "transient"],
  ];

  for (const [input, expected] of cases) {
    it(`maps "${input}" → "${expected}"`, () => {
      expect(classifyAssistantError(input)).toBe(expected);
    });
  }
});

describe("classifyResultError", () => {
  it('maps "error_during_execution" → "transient"', () => {
    expect(classifyResultError("error_during_execution")).toBe("transient");
  });

  it('maps "error_max_turns" → "max_turns"', () => {
    expect(classifyResultError("error_max_turns")).toBe("max_turns");
  });

  it('maps "error_max_budget_usd" → "budget"', () => {
    expect(classifyResultError("error_max_budget_usd")).toBe("budget");
  });

  it('maps "error_max_structured_output_retries" → "permanent"', () => {
    expect(classifyResultError("error_max_structured_output_retries")).toBe(
      "permanent"
    );
  });
});

describe("AntSessionError", () => {
  it("carries category and message", () => {
    const err = new AntSessionError("something went wrong", "transient");
    expect(err.message).toBe("something went wrong");
    expect(err.category).toBe("transient");
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.name).toBe("AntSessionError");
    expect(err instanceof Error).toBe(true);
  });

  it("carries retryAfterMs when provided", () => {
    const err = new AntSessionError("rate limited", "rate_limit", 45_000);
    expect(err.retryAfterMs).toBe(45_000);
  });
});
