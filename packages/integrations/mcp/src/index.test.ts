import { describe, it, expect } from "bun:test";
import { TOOLS } from "./tools";
import { ColonyClient, formatStatus, type ColonyStatus } from "./handlers";

// --- TOOLS ---

describe("TOOLS", () => {
  const toolNames = TOOLS.map((t) => t.name);

  it("defines all six tools", () => {
    expect(toolNames).toContain("colony_status");
    expect(toolNames).toContain("colony_prompt");
    expect(toolNames).toContain("colony_pause");
    expect(toolNames).toContain("colony_resume");
    expect(toolNames).toContain("colony_clear");
    expect(toolNames).toContain("colony_output");
    expect(TOOLS).toHaveLength(6);
  });

  it("every tool has a name, description, and inputSchema", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("tools with required parameters declare them", () => {
    const withAnt = TOOLS.filter((t) => t.name !== "colony_status");
    for (const tool of withAnt) {
      expect(tool.inputSchema.required).toContain("ant");
    }
    const promptTool = TOOLS.find((t) => t.name === "colony_prompt")!;
    expect(promptTool.inputSchema.required).toContain("prompt");
  });

  it("colony_status has no required parameters", () => {
    const tool = TOOLS.find((t) => t.name === "colony_status")!;
    expect(tool.inputSchema.required ?? []).toHaveLength(0);
  });
});

// --- ColonyClient ---

function makeFetch(response: { status?: number; body?: unknown }): typeof fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const status = response.status ?? 200;
    const body = response.body !== undefined ? JSON.stringify(response.body) : "";
    return new Response(body, { status });
  };
}

const BASE = "http://localhost:8080";

const SAMPLE_STATUS: ColonyStatus = {
  colony: "test",
  ants: [
    {
      name: "worker",
      engine: "claude-cli",
      state: "running",
      queueSize: 2,
      sessionsCompleted: 5,
      sessionsCrashed: 1,
      startedAt: Date.now() - 3600_000,
      recentOutput: ["line one", "line two", "line three"],
    },
  ],
};

describe("ColonyClient auth", () => {
  it("includes Authorization header when apiKey is provided", async () => {
    let capturedAuth = "";
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(JSON.stringify(SAMPLE_STATUS), { status: 200 });
    };
    const client = new ColonyClient(BASE, "my-secret", mockFetch);
    await client.getStatus();
    expect(capturedAuth).toBe("Bearer my-secret");
  });

  it("omits Authorization header when no apiKey is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(SAMPLE_STATUS), { status: 200 });
    };
    const client = new ColonyClient(BASE, undefined, mockFetch);
    await client.getStatus();
    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });
});

describe("ColonyClient.getStatus", () => {
  it("calls GET /api/status and parses the response", async () => {
    let calledUrl = "";
    const mockFetch: typeof fetch = async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify(SAMPLE_STATUS), { status: 200 });
    };
    const client = new ColonyClient(BASE, undefined, mockFetch);
    const status = await client.getStatus();
    expect(calledUrl).toBe(`${BASE}/api/status`);
    expect(status.colony).toBe("test");
    expect(status.ants).toHaveLength(1);
  });

  it("throws a helpful error when the runner is unreachable", async () => {
    const mockFetch: typeof fetch = async () => { throw new TypeError("Failed to fetch"); };
    const client = new ColonyClient(BASE, undefined, mockFetch);
    await expect(client.getStatus()).rejects.toThrow("not reachable");
  });

  it("throws when the API responds with a non-OK status", async () => {
    const client = new ColonyClient(BASE, undefined, makeFetch({ status: 503, body: "service unavailable" }));
    await expect(client.getStatus()).rejects.toThrow("503");
  });
});

describe("ColonyClient.prompt", () => {
  it("calls POST /api/ants/:name/prompt with the prompt body", async () => {
    let calledUrl = "";
    let calledBody: unknown;
    const mockFetch: typeof fetch = async (url, init) => {
      calledUrl = String(url);
      calledBody = JSON.parse((init?.body as string) ?? "{}");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new ColonyClient(BASE, undefined, mockFetch);
    await client.prompt("worker", "Fix the tests");
    expect(calledUrl).toBe(`${BASE}/api/ants/worker/prompt`);
    expect(calledBody).toEqual({ prompt: "Fix the tests" });
  });

  it("URL-encodes ant names with special characters", async () => {
    let calledUrl = "";
    const mockFetch: typeof fetch = async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new ColonyClient(BASE, undefined, mockFetch);
    await client.prompt("my ant", "hello");
    expect(calledUrl).toContain("my%20ant");
  });
});

describe("ColonyClient.pause / resume / clear", () => {
  it("pause calls POST /api/ants/:name/pause", async () => {
    let calledUrl = "";
    let calledMethod = "";
    const mockFetch: typeof fetch = async (url, init) => {
      calledUrl = String(url);
      calledMethod = init?.method ?? "GET";
      return new Response("{}", { status: 200 });
    };
    await new ColonyClient(BASE, undefined, mockFetch).pause("worker");
    expect(calledUrl).toBe(`${BASE}/api/ants/worker/pause`);
    expect(calledMethod).toBe("POST");
  });

  it("resume calls POST /api/ants/:name/resume", async () => {
    let calledUrl = "";
    const mockFetch: typeof fetch = async (url) => {
      calledUrl = String(url);
      return new Response("{}", { status: 200 });
    };
    await new ColonyClient(BASE, undefined, mockFetch).resume("worker");
    expect(calledUrl).toBe(`${BASE}/api/ants/worker/resume`);
  });

  it("clear calls POST /api/ants/:name/clear and returns cleared count", async () => {
    let calledUrl = "";
    const mockFetch: typeof fetch = async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true, cleared: 3 }), { status: 200 });
    };
    const result = await new ColonyClient(BASE, undefined, mockFetch).clear("worker");
    expect(calledUrl).toBe(`${BASE}/api/ants/worker/clear`);
    expect(result.cleared).toBe(3);
  });
});

// --- formatStatus ---

describe("formatStatus", () => {
  it("includes colony name and ant details", () => {
    const text = formatStatus(SAMPLE_STATUS);
    expect(text).toContain("test");
    expect(text).toContain("worker");
    expect(text).toContain("running");
    expect(text).toContain("claude-cli");
  });

  it("shows queue size, completed, and failed counts", () => {
    const text = formatStatus(SAMPLE_STATUS);
    expect(text).toContain("2");  // queueSize
    expect(text).toContain("5");  // sessionsCompleted
    expect(text).toContain("1");  // sessionsCrashed
  });

  it("handles an empty colony gracefully", () => {
    const text = formatStatus({ colony: "empty", ants: [] });
    expect(text).toContain("no ants");
  });
});
