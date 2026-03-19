# Supervisor Behavior

Each ant runs inside an infinite supervisor loop. The loop starts a new agent session, waits for it to finish, then decides what to do next based on the outcome. This page documents how the supervisor classifies failures and responds to them.

---

## Error categories

When a session ends with an error the supervisor maps it to one of seven categories before deciding how to respond. The mapping is implemented in `packages/core/src/errors.ts` and is derived directly from the Agent SDK's error types.

### Transient errors

Temporary failures that are expected to succeed on retry.

| SDK value | Description |
|---|---|
| `server_error` | Anthropic API 5xx |
| `unknown` | Unrecognised error from the API |
| `max_output_tokens` | Response was truncated; the next attempt may succeed |
| `error_during_execution` | General execution error |

**Response:** exponential backoff before restarting. Discord message: `❌ **<name>** crashed: … Restarting in Xs…`

### Rate limit

The API rate limit was hit, either as an assistant message error (`rate_limit`) or as a `rate_limit_event` message with `status: rejected`.

**Response:** wait until the rate limit resets. If the API provides a `resetsAt` timestamp the supervisor waits exactly that long; otherwise falls back to exponential backoff. Discord message: `⏳ **<name>** is rate limited. Resuming in Xs…`

### Permanent errors

Failures that will not resolve on their own and indicate a configuration or prompt problem.

| SDK value | Description |
|---|---|
| `invalid_request` | Malformed request (bad model name, unsupported parameter, etc.) |
| `error_max_structured_output_retries` | Structured output schema could not be satisfied after retries |

**Response:** exponential backoff before restarting. Discord message: `🚫 **<name>** encountered a permanent error: … Restarting in Xs…`

### Max turns

The session hit the configured turn limit and terminated normally (`error_max_turns`). This is **not** a crash — it is an expected completion for long-running tasks.

**Response:** silent immediate restart. No Discord message, no backoff, consecutive-crash counter reset to 0.

### Billing errors — pause and wait

These three categories require **human intervention** before the ant can do any useful work. The supervisor pauses the ant indefinitely and waits for a human to send `resume` or `/resume` in the ant's Discord channel.

| Category | SDK value | Discord message |
|---|---|---|
| `billing` | `billing_error` | `💳 **<name>** has a billing error — check your Anthropic account. Pausing until resumed.` |
| `auth` | `authentication_failed` | `🔐 **<name>** failed to authenticate — check credentials. Pausing until resumed.` |
| `budget` | `error_max_budget_usd` | `💰 **<name>** exceeded its USD budget cap. Pausing until resumed.` |

The ant takes no CPU while paused — it sleeps on an unresolved Promise. As soon as the human sends `/resume`, the Promise resolves and the ant starts a new session.

---

## Exponential backoff

For transient and permanent errors the supervisor waits before restarting. The delay doubles with each consecutive crash:

| Crash # | Delay |
|---|---|
| 1 | 10 s |
| 2 | 20 s |
| 3 | 40 s |
| 4 | 80 s |
| 5+ | 5 min (cap) |

The counter resets to 0 after any successful session or after a `max_turns` completion. Billing, auth, and budget errors do not increment the counter — they pause indefinitely instead.

---

## Recovering from a blocking error

When an ant posts a `💳`, `🔐`, or `💰` message:

1. **Fix the underlying cause.**
   - **Billing** — update your payment method or top up your Anthropic credits at [console.anthropic.com](https://console.anthropic.com).
   - **Auth** — rotate or replace the `ANTHROPIC_API_KEY` in your `.env` file and restart the colony runner (the runner reads the environment at startup, so a live reload requires a restart).
   - **Budget** — raise the `maxBudgetUsd` limit in your ant config, or top up credits if the account-level cap was hit.

2. **Send `/resume`** (or just `resume`) in the ant's Discord channel.

The ant will start a new session immediately.

---

## What operators see in Discord

Summary of all messages the supervisor posts to an ant's channel:

| Emoji | Event |
|---|---|
| 🐜 | Colony started, ant initialising |
| ✅ | Session completed successfully |
| ❌ | Transient crash — includes countdown to restart |
| ⏳ | Rate limit — includes countdown until reset |
| 🚫 | Permanent error — includes countdown to restart |
| 💳 | Billing error — ant paused, awaiting `/resume` |
| 🔐 | Auth error — ant paused, awaiting `/resume` |
| 💰 | Budget cap hit — ant paused, awaiting `/resume` |
| ⏸️ | Ant will pause after current session (response to `/pause`) |
| ▶️ | Ant resuming (response to `/resume`) |
| ⚙️ | Confirmation required for a dangerous action |
