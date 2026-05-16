import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { createHmac } from "crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ColonyState } from "./colony-state";
import { createDashboardHandler } from "./dashboard";

function makeState(configDir?: string) {
  const s = new ColonyState("test-colony", undefined, configDir);
  s.register("worker", "claude-cli", {
    pause: mock(() => {}),
    resume: mock(() => {}),
    pushPrompt: mock(() => {}),
    clearQueue: mock(() => 2),
    getQueueSize: mock(() => 0),
    removeWorkItem: mock(() => false),
  });
  s.pushOutput("worker", "hello");
  s.pushOutput("worker", "world");
  return s;
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
  });
}

describe("createDashboardHandler", () => {
  it("GET /api/status returns colony and ants JSON", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/api/status"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { colony: string; ants: unknown[] };
    expect(body.colony).toBe("test-colony");
    expect(Array.isArray(body.ants)).toBe(true);
    expect(body.ants).toHaveLength(1);
  });

  it("GET / returns HTML dashboard", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("/api/status");
  });

  it("GET /dashboard also returns HTML", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("POST /api/ants/:name/pause returns ok", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/worker/pause"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/ants/:name/resume returns ok", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/worker/resume"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/ants/:name/clear returns cleared count", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/worker/clear"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cleared: number };
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(2);
  });

  it("POST /api/ants/:name/prompt with valid body returns ok", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/worker/prompt", { prompt: "do the thing" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/ants/:name/prompt with missing prompt returns 400", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/worker/prompt", {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/ants/unknown/pause returns 404", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/ants/unknown/pause"));
    expect(res.status).toBe(404);
  });

  it("GET /api/ants/:name/output returns SSE content-type", async () => {
    const state = makeState();
    const handler = createDashboardHandler(state);
    const ac = new AbortController();
    const res = await handler(new Request("http://localhost/api/ants/worker/output", { signal: ac.signal }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    ac.abort();
  });

  it("GET /unknown returns 404", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/unknown"));
    expect(res.status).toBe(404);
  });
});

// --- Auth tests ---

describe("createDashboardHandler — auth", () => {
  it("allows all requests when no apiKey is configured", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/api/status"));
    expect(res.status).toBe(200);
  });

  it("returns 401 for /api/* when apiKey is set and no Authorization header", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(req("GET", "/api/status"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header has the wrong key", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(
      new Request("http://localhost/api/status", {
        headers: { Authorization: "Bearer wrong" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("allows /api/* when the correct Bearer token is sent", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(
      new Request("http://localhost/api/status", {
        headers: { Authorization: "Bearer secret" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("allows OPTIONS preflight without auth (CORS preflight)", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(new Request("http://localhost/api/status", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
  });

  it("serves the HTML dashboard without auth even when apiKey is set", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(req("GET", "/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("CORS headers include Authorization", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(new Request("http://localhost/api/status", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("allows /api/* when key is passed as ?key= query param (for SSE)", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(new Request("http://localhost/api/status?key=secret"));
    expect(res.status).toBe(200);
  });

  it("returns 401 when ?key= query param has the wrong value", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(new Request("http://localhost/api/status?key=wrong"));
    expect(res.status).toBe(401);
  });
});

// --- GitHub webhook helpers ---

function makeWebhookSig(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function webhookReq(body: unknown, opts: { event?: string; sig?: string } = {}): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.event) headers["X-GitHub-Event"] = opts.event;
  if (opts.sig) headers["X-Hub-Signature-256"] = opts.sig;
  return new Request("http://localhost/api/webhooks/github", { method: "POST", headers, body: raw });
}

const SAMPLE_ISSUE_EVENT = {
  action: "opened",
  issue: {
    number: 42,
    title: "Fix the bug",
    body: "It breaks on login.",
    html_url: "https://github.com/acme/repo/issues/42",
    labels: [{ name: "ant-ready" }],
  },
  repository: {
    full_name: "acme/repo",
    name: "repo",
    owner: { login: "acme" },
  },
};

describe("createDashboardHandler — GitHub webhook", () => {
  it("returns 200 and calls onGithubWebhook for a valid issues event", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { onGithubWebhook: handler_fn });
    const raw = JSON.stringify(SAMPLE_ISSUE_EVENT);
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues" }));
    expect(res.status).toBe(200);
    expect(handler_fn).toHaveBeenCalledTimes(1);
    expect((handler_fn.mock.calls[0] as unknown[])[0]).toMatchObject({ action: "opened" });
  });

  it("does not call onGithubWebhook for non-issues events", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { onGithubWebhook: handler_fn });
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "push" }));
    expect(res.status).toBe(200);
    expect(handler_fn).not.toHaveBeenCalled();
  });

  it("does not call onGithubWebhook for closed action", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { onGithubWebhook: handler_fn });
    const payload = { ...SAMPLE_ISSUE_EVENT, action: "closed" };
    const res = await handler(webhookReq(payload, { event: "issues" }));
    expect(res.status).toBe(200);
    expect(handler_fn).not.toHaveBeenCalled();
  });

  it("calls onGithubWebhook for action: labeled", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { onGithubWebhook: handler_fn });
    const payload = { ...SAMPLE_ISSUE_EVENT, action: "labeled", label: { name: "ant-ready" } };
    const res = await handler(webhookReq(payload, { event: "issues" }));
    expect(res.status).toBe(200);
    expect(handler_fn).toHaveBeenCalledTimes(1);
  });

  it("verifies HMAC-SHA256 signature when webhookSecret is set", async () => {
    const handler_fn = mock(() => {});
    const secret = "my-webhook-secret";
    const handler = createDashboardHandler(makeState(), { webhookSecret: secret, onGithubWebhook: handler_fn });
    const raw = JSON.stringify(SAMPLE_ISSUE_EVENT);
    const goodSig = makeWebhookSig(raw, secret);

    const ok = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues", sig: goodSig }));
    expect(ok.status).toBe(200);
    expect(handler_fn).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when signature is wrong", async () => {
    const handler = createDashboardHandler(makeState(), { webhookSecret: "secret" });
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues", sig: "sha256=bad" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is missing and webhookSecret is set", async () => {
    const handler = createDashboardHandler(makeState(), { webhookSecret: "secret" });
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues" }));
    expect(res.status).toBe(401);
  });

  it("skips signature check when webhookSecret is not set", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { onGithubWebhook: handler_fn });
    // no sig header, no secret — should still work
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues" }));
    expect(res.status).toBe(200);
    expect(handler_fn).toHaveBeenCalledTimes(1);
  });

  it("webhook endpoint is reachable even when apiKey auth is set", async () => {
    const handler_fn = mock(() => {});
    const handler = createDashboardHandler(makeState(), { apiKey: "secret", onGithubWebhook: handler_fn });
    const res = await handler(webhookReq(SAMPLE_ISSUE_EVENT, { event: "issues" }));
    expect(res.status).toBe(200);
    expect(handler_fn).toHaveBeenCalledTimes(1);
  });
});

describe("createDashboardHandler — reload", () => {
  it("POST /api/reload returns 500 when no reload callback is set", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("POST", "/api/reload"));
    expect(res.status).toBe(500);
  });

  it("POST /api/reload returns the callback result", async () => {
    const state = makeState();
    const reloadResult = { added: ["new-ant"], removed: [], updated: [] };
    state.setReloadCallback(async () => reloadResult);
    const handler = createDashboardHandler(state);
    const res = await handler(req("POST", "/api/reload"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(reloadResult);
  });
});

// --- Config route tests ---

describe("createDashboardHandler — config routes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-dashboard-test-`);
    mkdirSync(join(dir, "ants"));
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: my-colony\nmonitoring:\n  port: 8080\n"
    );
    writeFileSync(
      join(dir, "ants", "worker.yaml"),
      "name: worker\ndescription: Does work\ninstructions: Work hard.\nengine: claude-cli\n"
    );
    writeFileSync(
      join(dir, "ants", "reviewer.yaml"),
      "name: reviewer\ndescription: Reviews PRs\ninstructions: Review carefully.\nengine: claude-cli\n"
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/config returns colony.yaml as JSON", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/config"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("my-colony");
  });

  it("GET /api/config returns env var templates uninterpolated", async () => {
    writeFileSync(
      join(dir, "colony.yaml"),
      "name: my-colony\nintegrations:\n  discord:\n    token: ${DISCORD_TOKEN}\n    guild: my-guild\n"
    );
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/config"));
    const body = (await res.json()) as { integrations: { discord: { token: string } } };
    expect(body.integrations.discord.token).toBe("${DISCORD_TOKEN}");
  });

  it("GET /api/config returns 503 when configDir is not set", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/api/config"));
    expect(res.status).toBe(503);
  });

  it("GET /api/config/ants returns all ant configs as array", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/config/ants"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
    const names = (body as { name: string }[]).map((a) => a.name).sort();
    expect(names).toEqual(["reviewer", "worker"]);
  });

  it("GET /api/config/ants/:name returns the matching ant config", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/config/ants/worker"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; description: string };
    expect(body.name).toBe("worker");
    expect(body.description).toBe("Does work");
  });

  it("GET /api/config/ants/:name returns 404 for unknown ant", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/config/ants/ghost"));
    expect(res.status).toBe(404);
  });

  it("GET /api/config/ants returns 503 when configDir is not set", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/api/config/ants"));
    expect(res.status).toBe(503);
  });

  // --- Write routes ---

  it("PUT /api/config/ants/:name updates the YAML file", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const updated = {
      name: "worker",
      description: "Updated description",
      instructions: "New instructions.",
      engine: "claude-cli",
    };
    const res = await handler(req("PUT", "/api/config/ants/worker", updated));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colony-restart-required")).toBe("true");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // Read back to verify
    const verify = await handler(req("GET", "/api/config/ants/worker"));
    const verifyBody = (await verify.json()) as { description: string };
    expect(verifyBody.description).toBe("Updated description");
  });

  it("PUT /api/config/ants/:name returns 404 for unknown ant", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("PUT", "/api/config/ants/ghost", {
      name: "ghost",
      description: "Ghost ant",
      instructions: "Haunt things.",
      engine: "claude-cli",
    }));
    expect(res.status).toBe(404);
  });

  it("PUT /api/config/ants/:name returns 422 for invalid body", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("PUT", "/api/config/ants/worker", { name: "worker" }));
    expect(res.status).toBe(422);
  });

  it("PUT /api/config/ants/:name returns 422 when name in body mismatches URL", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("PUT", "/api/config/ants/worker", {
      name: "other-ant",
      description: "x",
      instructions: "y",
    }));
    expect(res.status).toBe(422);
  });

  it("POST /api/config/ants creates a new YAML file", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const newAnt = {
      name: "tester",
      description: "Runs tests",
      instructions: "Run bun test.",
      engine: "claude-cli",
    };
    const res = await handler(req("POST", "/api/config/ants", newAnt));
    expect(res.status).toBe(201);
    expect(res.headers.get("x-colony-restart-required")).toBe("true");
    // Should now appear in list
    const list = await handler(req("GET", "/api/config/ants"));
    const names = ((await list.json()) as { name: string }[]).map((a) => a.name);
    expect(names).toContain("tester");
  });

  it("POST /api/config/ants returns 409 when ant name already exists", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("POST", "/api/config/ants", {
      name: "worker",
      description: "Duplicate",
      instructions: "Work.",
      engine: "claude-cli",
    }));
    expect(res.status).toBe(409);
  });

  it("DELETE /api/config/ants/:name removes the YAML file", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("DELETE", "/api/config/ants/reviewer"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colony-restart-required")).toBe("true");
    // Should no longer appear in list
    const list = await handler(req("GET", "/api/config/ants"));
    const names = ((await list.json()) as { name: string }[]).map((a) => a.name);
    expect(names).not.toContain("reviewer");
  });

  it("DELETE /api/config/ants/:name returns 404 for unknown ant", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("DELETE", "/api/config/ants/ghost"));
    expect(res.status).toBe(404);
  });

  it("PUT /api/config updates colony.yaml", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const updated = { name: "renamed-colony", monitoring: { port: 9000 } };
    const res = await handler(req("PUT", "/api/config", updated));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colony-restart-required")).toBe("true");
    const verify = await handler(req("GET", "/api/config"));
    const verifyBody = (await verify.json()) as { name: string };
    expect(verifyBody.name).toBe("renamed-colony");
  });

  it("PUT /api/config returns 422 for invalid body", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("PUT", "/api/config", {}));
    expect(res.status).toBe(422);
  });
});
