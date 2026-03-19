import type {
  SDKAssistantMessageError,
  SDKResultError,
} from "@anthropic-ai/claude-agent-sdk";

export type AntErrorCategory =
  | "rate_limit" // transient, wait for resetsAt if available
  | "billing" // semi-permanent, alert and pause
  | "auth" // permanent, alert and stop restarting
  | "budget" // permanent (USD cap hit), alert and stop
  | "max_turns" // informational, restart immediately no penalty
  | "transient" // generic transient (server_error, unknown), exponential backoff
  | "permanent"; // invalid_request, structured output; alert and stop

export class AntSessionError extends Error {
  constructor(
    message: string,
    public readonly category: AntErrorCategory,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "AntSessionError";
  }
}

export function classifyAssistantError(
  err: SDKAssistantMessageError
): AntErrorCategory {
  switch (err) {
    case "rate_limit":
      return "rate_limit";
    case "billing_error":
      return "billing";
    case "authentication_failed":
      return "auth";
    case "server_error":
      return "transient";
    case "unknown":
      return "transient";
    case "invalid_request":
      return "permanent";
    case "max_output_tokens":
      return "transient";
  }
}

export function classifyResultError(
  subtype: SDKResultError["subtype"]
): AntErrorCategory {
  switch (subtype) {
    case "error_during_execution":
      return "transient";
    case "error_max_turns":
      return "max_turns";
    case "error_max_budget_usd":
      return "budget";
    case "error_max_structured_output_retries":
      return "permanent";
  }
}
