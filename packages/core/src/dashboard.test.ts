import { describe, it, expect, mock } from "bun:test";
import { ColonyState } from "./colony-state";
import { createDashboardHandler } from "./dashboard";

function makeState() {
  const s = new ColonyState("test-colony");
  s.register("worker", "claude-cli", {
    pause: mock(() => {}),
    resume: mock(() => {}),
    pushPrompt: mock(() => {}),
    clearQueue: mock(() => 2),
    getQueueSize: mock(() => 0),
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
