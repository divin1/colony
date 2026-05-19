import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ColonyState } from "./colony-state";
import { TaskStore } from "./task-store";
import { createDashboardHandler } from "./dashboard";

function makeState(configDir?: string) {
  const s = new ColonyState("test-colony", configDir);
  s.register("worker", "claude-cli", {
    pause: mock(() => {}),
    resume: mock(() => {}),
    wake: mock(() => {}),
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

  it("GET / returns 404 when no webRoot configured", async () => {
    const handler = createDashboardHandler(makeState());
    const res = await handler(req("GET", "/"));
    expect(res.status).toBe(404);
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

  it("GET / returns 404 (not 401) when no webRoot set even with apiKey", async () => {
    const handler = createDashboardHandler(makeState(), { apiKey: "secret" });
    const res = await handler(req("GET", "/"));
    // Non-API path; no auth gate. Without webRoot, falls through to 404.
    expect(res.status).toBe(404);
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

// --- PATCH /api/work/:id (reorder) ---

// --- Task / Project / Comment route tests ---

describe("createDashboardHandler — task routes", () => {
  let dir: string;
  let ts: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-task-test-`);
    ts = new TaskStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeStateWithTask() {
    const s = new ColonyState("test-colony", dir);
    s.register("worker", "claude-cli", {
      pause: mock(() => {}),
      resume: mock(() => {}),
      wake: mock(() => {}),
      clearQueue: mock(() => 0),
      getQueueSize: mock(() => 0),
    });
    return s;
  }

  it("GET /api/projects returns empty array when no projects exist", async () => {
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(req("GET", "/api/projects"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/projects creates a project", async () => {
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(req("POST", "/api/projects", { name: "My Project" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { name: string };
    expect(body.name).toBe("My Project");
    expect(ts.listProjects()).toHaveLength(1);
  });

  it("GET /api/tasks returns empty array when no tasks exist", async () => {
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(req("GET", "/api/tasks"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/tasks creates a task", async () => {
    const project = ts.createProject("Test");
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(req("POST", "/api/tasks", {
      projectId: project.id,
      title: "Fix the bug",
      description: "Details here",
      assigneeType: "ant",
      assigneeName: "worker",
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { title: string; status: string };
    expect(body.title).toBe("Fix the bug");
    expect(body.status).toBe("backlog"); // default — human moves to todo when ready
  });

  it("PATCH /api/tasks/:id updates status", async () => {
    const project = ts.createProject("P");
    const task = ts.createTask({ projectId: project.id, title: "T", description: "", assigneeType: "human" });
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(new Request(`http://localhost/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    }));
    expect(res.status).toBe(200);
    expect(ts.getTask(task.id)!.status).toBe("done");
  });

  it("PATCH /api/tasks/:id reorders a task", async () => {
    const project = ts.createProject("P");
    const a = ts.createTask({ projectId: project.id, title: "A", description: "", assigneeType: "human" });
    ts.createTask({ projectId: project.id, title: "B", description: "", assigneeType: "human" });
    const c = ts.createTask({ projectId: project.id, title: "C", description: "", assigneeType: "human" });
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    await handler(new Request(`http://localhost/api/tasks/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: 0 }),
    }));
    const titles = ts.listTasks({ projectId: project.id }).map((t) => t.title);
    expect(titles[0]).toBe("C");
  });

  it("DELETE /api/tasks/:id removes the task", async () => {
    const project = ts.createProject("P");
    const task = ts.createTask({ projectId: project.id, title: "T", description: "", assigneeType: "human" });
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(new Request(`http://localhost/api/tasks/${task.id}`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(ts.getTask(task.id)).toBeNull();
  });

  it("POST /api/tasks/:id/comments adds a comment", async () => {
    const project = ts.createProject("P");
    const task = ts.createTask({ projectId: project.id, title: "T", description: "", assigneeType: "human" });
    const handler = createDashboardHandler(makeStateWithTask(), { taskStore: ts });
    const res = await handler(new Request(`http://localhost/api/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "worker", body: "Done!" }),
    }));
    expect(res.status).toBe(201);
    expect(ts.listComments(task.id)).toHaveLength(1);
  });
});

// --- Skill route tests ---

describe("createDashboardHandler — skill routes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/colony-skill-test-`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("GET /api/skills returns empty array when skills dir does not exist", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(req("GET", "/api/skills"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("PUT /api/skills/:name creates a skill file", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const content = "---\nname: Test Skill\ndescription: A test\n---\n\n## Body";
    const res = await handler(new Request("http://localhost/api/skills/test-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { filename: string };
    expect(body.filename).toBe("test-skill.md");
  });

  it("GET /api/skills lists created skill files with parsed metadata", async () => {
    const handler = createDashboardHandler(makeState(dir));
    await handler(new Request("http://localhost/api/skills/my-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "---\nname: My Skill\ndescription: Great skill\n---\n\nBody" }),
    }));
    const res = await handler(req("GET", "/api/skills"));
    expect(res.status).toBe(200);
    const list = await res.json() as { filename: string; name: string; description: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("My Skill");
    expect(list[0].description).toBe("Great skill");
    expect(list[0].filename).toBe("my-skill.md");
  });

  it("GET /api/skills/:name returns file content", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const content = "---\nname: S\n---\n\nHello";
    await handler(new Request("http://localhost/api/skills/s", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }));
    const res = await handler(req("GET", "/api/skills/s"));
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toBe(content);
  });

  it("DELETE /api/skills/:name removes the file", async () => {
    const handler = createDashboardHandler(makeState(dir));
    await handler(new Request("http://localhost/api/skills/to-delete", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# skill" }),
    }));
    const del = await handler(new Request("http://localhost/api/skills/to-delete", { method: "DELETE" }));
    expect(del.status).toBe(200);
    const list = await (await handler(req("GET", "/api/skills"))).json() as unknown[];
    expect(list).toHaveLength(0);
  });

  it("returns 400 for path traversal attempts", async () => {
    const handler = createDashboardHandler(makeState(dir));
    const res = await handler(new Request("http://localhost/api/skills/..%2F..%2Fetc%2Fpasswd", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "bad" }),
    }));
    expect(res.status).toBe(400);
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
