import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { parse as parseYaml } from "yaml";
import type { ColonyState } from "./colony-state.js";
import { TaskStore, taskTitle } from "./task-store.js";
import type { TaskStatus, AssigneeType, TaskSource } from "./task-store.js";
import {
  readRawColonyYaml,
  readRawAntYamls,
  readRawAntYaml,
  writeAntYaml,
  createAntYaml,
  deleteAntYaml,
  writeColonyYaml,
} from "./config.js";

// --- Skill file helpers ---

interface SkillMeta { filename: string; name: string; description: string; }

function skillsDir(colonyDir: string): string {
  return join(colonyDir, "skills");
}

// Returns null if the resolved path escapes the skills directory.
function resolveSkillPath(colonyDir: string, filename: string): string | null {
  const dir = skillsDir(colonyDir);
  const resolved = resolvePath(join(dir, filename));
  const prefix = dir.endsWith("/") ? dir : dir + "/";
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}

function parseSkillMeta(content: string, filename: string): SkillMeta {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match) {
    try {
      const fm = parseYaml(match[1]) as Record<string, unknown>;
      return {
        filename,
        name: typeof fm.name === "string" ? fm.name : filename.replace(/\.md$/, ""),
        description: typeof fm.description === "string" ? fm.description : "",
      };
    } catch { /* fall through */ }
  }
  return { filename, name: filename.replace(/\.md$/, ""), description: "" };
}

function listSkillFiles(colonyDir: string): SkillMeta[] {
  const dir = skillsDir(colonyDir);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => {
        try {
          const content = readFileSync(join(dir, f), "utf8");
          return parseSkillMeta(content, f);
        } catch {
          return { filename: f, name: f.replace(/\.md$/, ""), description: "" };
        }
      });
  } catch {
    return [];
  }
}

export interface DashboardOptions {
  apiKey?: string;
  taskStore?: TaskStore;
  webRoot?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: CORS_HEADERS });
}

const MIME_TYPES: Record<string, string> = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript",
  ".css":   "text/css",
  ".json":  "application/json",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".webp":  "image/webp",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
  ".txt":   "text/plain",
  ".map":   "application/json",
};

async function serveStatic(webRoot: string, pathname: string): Promise<Response | null> {
  const rel = pathname.replace(/^\//, "").replace(/\/$/, "") || "index.html";
  const candidate = rel.includes(".") ? rel : rel + "/index.html";
  const filePath = join(webRoot, candidate);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  const ext = (filePath.match(/\.[^./]+$/) ?? [""])[0];
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": contentType } });
}

function writeOkResponse(data: unknown = { ok: true }, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "X-Colony-Restart-Required": "true",
    },
  });
}

// --- HTTP route handler ---

export function createDashboardHandler(
  state: ColonyState,
  options: DashboardOptions = {}
): (req: Request) => Response | Promise<Response> {
  const { apiKey, taskStore, webRoot } = options;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight — always allowed so browsers can probe the API.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Auth check — applies to all /api/* routes when a key is configured.
    // Static web UI files are served without auth; the browser-side app sends the key.
    // SSE endpoints accept ?key= as an alternative because EventSource can't set headers.
    if (apiKey && path.startsWith("/api/")) {
      const auth = req.headers.get("Authorization");
      const queryKey = url.searchParams.get("key");
      const presented = auth ? auth.replace(/^Bearer /, "") : queryKey;
      if (presented !== apiKey) {
        return textResponse("Unauthorized", 401);
      }
    }

    // GET /api/status — all ant statuses
    if (path === "/api/status" && req.method === "GET") {
      return jsonResponse(state.getStatus());
    }

    // GET /api/events — SSE stream of colony-level events (tasks, projects, ant state)
    if (path === "/api/events" && req.method === "GET") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: object) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch { /* client disconnected */ }
          };

          // Send a heartbeat comment every 30s to keep the connection alive through proxies.
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* gone */ }
          }, 30_000);

          const unsub = state.subscribeEvents(send);

          req.signal.addEventListener("abort", () => {
            unsub();
            clearInterval(heartbeat);
            try { controller.close(); } catch { /* already closed */ }
          });
        },
      });

      return new Response(stream, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // POST /api/reload — hot reload config without restarting the runner
    if (path === "/api/reload" && req.method === "POST") {
      try {
        const result = await state.triggerReload();
        return jsonResponse(result);
      } catch (err) {
        return textResponse(`Reload failed: ${(err as Error).message}`, 500);
      }
    }

    // --- Project routes ---

    if (path === "/api/projects" && req.method === "GET") {
      if (!taskStore) return jsonResponse([]);
      return jsonResponse(taskStore.listProjects());
    }

    if (path === "/api/projects" && req.method === "POST") {
      if (!taskStore) return textResponse("Task store not available", 503);
      let body: { name?: unknown; description?: unknown; color?: unknown };
      try { body = await req.json() as typeof body; } catch { return textResponse("Invalid JSON", 400); }
      if (typeof body.name !== "string" || !body.name.trim()) return textResponse("name is required", 400);
      const project = taskStore.createProject(
        body.name.trim(),
        typeof body.description === "string" ? body.description : undefined,
        typeof body.color === "string" ? body.color : undefined
      );
      state.emitEvent({ type: "project", action: "created", projectId: project.id });
      return jsonResponse(project, 201);
    }

    const projectRoute = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectRoute) {
      const projectId = decodeURIComponent(projectRoute[1]);
      if (!taskStore) return textResponse("Not found", 404);
      if (req.method === "GET") {
        const p = taskStore.getProject(projectId);
        return p ? jsonResponse(p) : textResponse("Not found", 404);
      }
      if (req.method === "PUT") {
        let body: { name?: unknown; description?: unknown; color?: unknown };
        try { body = await req.json() as typeof body; } catch { return textResponse("Invalid JSON", 400); }
        const ok = taskStore.updateProject(projectId, {
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          color: "color" in body ? (body.color as string | null) : undefined,
        });
        if (ok) state.emitEvent({ type: "project", action: "updated", projectId });
        return ok ? jsonResponse({ ok: true }) : textResponse("Not found", 404);
      }
      if (req.method === "DELETE") {
        taskStore.deleteProject(projectId);
        state.emitEvent({ type: "project", action: "deleted", projectId });
        return jsonResponse({ ok: true });
      }
    }

    // --- Task routes ---

    if (path === "/api/tasks" && req.method === "GET") {
      if (!taskStore) return jsonResponse([]);
      const statusParam = url.searchParams.get("status");
      const filter = {
        projectId: url.searchParams.get("project") ?? undefined,
        assigneeType: (url.searchParams.get("assigneeType") ?? undefined) as AssigneeType | undefined,
        assigneeName: url.searchParams.get("assignee") ?? undefined,
        status: statusParam ? (statusParam.split(",") as TaskStatus[]) : undefined,
        limit: parseInt(url.searchParams.get("limit") ?? "200", 10),
        offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
      };
      return jsonResponse(taskStore.listTasks(filter));
    }

    if (path === "/api/tasks" && req.method === "POST") {
      if (!taskStore) return textResponse("Task store not available", 503);
      let body: Record<string, unknown>;
      try { body = await req.json() as Record<string, unknown>; } catch { return textResponse("Invalid JSON", 400); }
      if (typeof body.projectId !== "string") return textResponse("projectId is required", 400);
      if (typeof body.title !== "string" || !body.title.trim()) return textResponse("title is required", 400);
      const task = taskStore.createTask({
        projectId: body.projectId,
        title: body.title.trim(),
        description: typeof body.description === "string" ? body.description : "",
        assigneeType: (body.assigneeType as AssigneeType) ?? "human",
        assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : undefined,
        source: (body.source as TaskSource) ?? "manual",
        status: (body.status as TaskStatus) ?? "backlog",
      });
      state.emitEvent({ type: "task", action: "created", taskId: task.id });
      if (task.assigneeType === "ant" && task.assigneeName) {
        state.wake(task.assigneeName);
      }
      return jsonResponse(task, 201);
    }

    const taskRoute = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskRoute) {
      const taskId = decodeURIComponent(taskRoute[1]);
      if (!taskStore) return textResponse("Not found", 404);

      if (req.method === "GET") {
        const t = taskStore.getTask(taskId);
        return t ? jsonResponse(t) : textResponse("Not found", 404);
      }

      if (req.method === "PUT") {
        let body: Record<string, unknown>;
        try { body = await req.json() as Record<string, unknown>; } catch { return textResponse("Invalid JSON", 400); }
        const t = taskStore.getTask(taskId);
        if (!t) return textResponse("Not found", 404);
        taskStore.updateTask(taskId, {
          title: typeof body.title === "string" ? body.title : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          assigneeType: body.assigneeType as AssigneeType | undefined,
          assigneeName: "assigneeName" in body ? (body.assigneeName as string | null) : undefined,
          projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        });
        if (typeof body.status === "string") taskStore.setStatus(taskId, body.status as TaskStatus);
        const updated = taskStore.getTask(taskId)!;
        state.emitEvent({ type: "task", action: "updated", taskId });
        if (updated.assigneeType === "ant" && updated.assigneeName && updated.status === "todo") {
          state.wake(updated.assigneeName);
        }
        return jsonResponse(updated);
      }

      if (req.method === "PATCH") {
        let body: Record<string, unknown>;
        try { body = await req.json() as Record<string, unknown>; } catch { return textResponse("Invalid JSON", 400); }
        const t = taskStore.getTask(taskId);
        if (!t) return textResponse("Not found", 404);
        if (typeof body.status === "string") taskStore.setStatus(taskId, body.status as TaskStatus);
        if (typeof body.position === "number") taskStore.reorder(taskId, body.position);
        if ("assigneeType" in body || "assigneeName" in body) {
          taskStore.updateTask(taskId, {
            assigneeType: body.assigneeType as AssigneeType | undefined,
            assigneeName: "assigneeName" in body ? (body.assigneeName as string | null) : undefined,
          });
        }
        const updated = taskStore.getTask(taskId)!;
        state.emitEvent({ type: "task", action: "updated", taskId });
        if (updated.assigneeType === "ant" && updated.assigneeName && updated.status === "todo") {
          state.wake(updated.assigneeName);
        }
        return jsonResponse(updated);
      }

      if (req.method === "DELETE") {
        taskStore.deleteTask(taskId);
        state.emitEvent({ type: "task", action: "deleted", taskId });
        return jsonResponse({ ok: true });
      }
    }

    // --- Comment routes ---

    const commentListRoute = path.match(/^\/api\/tasks\/([^/]+)\/comments$/);
    if (commentListRoute) {
      const taskId = decodeURIComponent(commentListRoute[1]);
      if (!taskStore) return textResponse("Not found", 404);
      if (req.method === "GET") return jsonResponse(taskStore.listComments(taskId));
      if (req.method === "POST") {
        let body: { author?: unknown; body?: unknown };
        try { body = await req.json() as typeof body; } catch { return textResponse("Invalid JSON", 400); }
        if (typeof body.author !== "string" || !body.author) return textResponse("author is required", 400);
        if (typeof body.body !== "string" || !body.body) return textResponse("body is required", 400);
        if (!taskStore.getTask(taskId)) return textResponse("Not found", 404);
        const comment = taskStore.addComment(taskId, body.author, body.body);
        state.emitEvent({ type: "task", action: "updated", taskId });
        return jsonResponse(comment, 201);
      }
    }

    const commentDeleteRoute = path.match(/^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/);
    if (commentDeleteRoute && req.method === "DELETE") {
      if (!taskStore) return textResponse("Not found", 404);
      const deleted = taskStore.deleteComment(decodeURIComponent(commentDeleteRoute[2]));
      if (deleted) state.emitEvent({ type: "task", action: "updated", taskId: decodeURIComponent(commentDeleteRoute[1]) });
      return deleted ? jsonResponse({ ok: true }) : textResponse("Not found", 404);
    }

    // --- Skill routes ---

    const configDir2 = state.getConfigDir();

    if (path === "/api/skills" && req.method === "GET") {
      if (!configDir2) return jsonResponse([]);
      return jsonResponse(listSkillFiles(configDir2));
    }

    const skillRoute = path.match(/^\/api\/skills\/([^/]+)$/);
    if (skillRoute) {
      if (!configDir2) return textResponse("Config directory not available", 503);
      const rawName = decodeURIComponent(skillRoute[1]);
      const filename = rawName.endsWith(".md") ? rawName : `${rawName}.md`;
      const filePath = resolveSkillPath(configDir2, filename);
      if (!filePath) return textResponse("Invalid skill name", 400);

      if (req.method === "GET") {
        if (!existsSync(filePath)) return textResponse("Not found", 404);
        const content = readFileSync(filePath, "utf8");
        return jsonResponse({ filename, content });
      }

      if (req.method === "PUT") {
        let body: { content?: unknown };
        try { body = await req.json() as typeof body; } catch { return textResponse("Invalid JSON", 400); }
        if (typeof body.content !== "string") return textResponse("content is required", 400);
        mkdirSync(skillsDir(configDir2), { recursive: true });
        writeFileSync(filePath, body.content, "utf8");
        return jsonResponse({ ok: true, filename });
      }

      if (req.method === "DELETE") {
        if (!existsSync(filePath)) return textResponse("Not found", 404);
        unlinkSync(filePath);
        return jsonResponse({ ok: true });
      }
    }

    // Config routes — raw YAML (no env interpolation) so the editor sees/writes template values.
    const configDir = state.getConfigDir();

    // /api/config — colony.yaml
    if (path === "/api/config") {
      if (!configDir) return textResponse("Config directory not available", 503);
      if (req.method === "GET") {
        try {
          return jsonResponse(readRawColonyYaml(configDir));
        } catch (err) {
          return textResponse(`Failed to read colony.yaml: ${(err as Error).message}`, 500);
        }
      }
      if (req.method === "PUT") {
        let body: unknown;
        try { body = await req.json(); } catch { return textResponse("Invalid JSON", 400); }
        const result = writeColonyYaml(configDir, body);
        if (!result.ok) {
          if (result.type === "invalid") return textResponse(result.error, 422);
          return textResponse(result.error, 500);
        }
        return writeOkResponse();
      }
    }

    // /api/config/ants — ant list + create
    if (path === "/api/config/ants") {
      if (!configDir) return textResponse("Config directory not available", 503);
      if (req.method === "GET") {
        try {
          return jsonResponse(readRawAntYamls(configDir));
        } catch (err) {
          return textResponse(`Failed to read ant configs: ${(err as Error).message}`, 500);
        }
      }
      if (req.method === "POST") {
        let body: unknown;
        try { body = await req.json(); } catch { return textResponse("Invalid JSON", 400); }
        const result = createAntYaml(configDir, body);
        if (!result.ok) {
          if (result.type === "invalid") return textResponse(result.error, 422);
          if (result.type === "conflict") return textResponse("An ant with that name already exists", 409);
          return textResponse(result.error, 500);
        }
        return writeOkResponse({ ok: true }, 201);
      }
    }

    // /api/config/ants/:name — single ant read / update / delete
    const configAntRoute = path.match(/^\/api\/config\/ants\/([^/]+)$/);
    if (configAntRoute) {
      if (!configDir) return textResponse("Config directory not available", 503);
      const name = decodeURIComponent(configAntRoute[1]);

      if (req.method === "GET") {
        try {
          const raw = readRawAntYaml(configDir, name);
          if (!raw) return textResponse("Ant not found", 404);
          return jsonResponse(raw);
        } catch (err) {
          return textResponse(`Failed to read ant config: ${(err as Error).message}`, 500);
        }
      }

      if (req.method === "PUT") {
        let body: unknown;
        try { body = await req.json(); } catch { return textResponse("Invalid JSON", 400); }
        const result = writeAntYaml(configDir, name, body);
        if (!result.ok) {
          if (result.type === "not_found") return textResponse("Ant not found", 404);
          if (result.type === "invalid") return textResponse(result.error, 422);
          return textResponse(result.error, 500);
        }
        return writeOkResponse();
      }

      if (req.method === "DELETE") {
        const result = deleteAntYaml(configDir, name);
        if (!result.ok) {
          if (result.type === "not_found") return textResponse("Ant not found", 404);
          return textResponse(result.error, 500);
        }
        return writeOkResponse();
      }
    }

    // /api/ants/:name/:action
    const antRoute = path.match(/^\/api\/ants\/([^/]+)\/([^/]+)$/);
    if (antRoute) {
      const antName = decodeURIComponent(antRoute[1]);
      const action = antRoute[2];

      // GET /api/ants/:name/output — SSE stream of live output
      if (action === "output" && req.method === "GET") {
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          start(controller) {
            // Replay buffered output first so the client sees recent history.
            const status = state.getAntStatus(antName);
            if (status) {
              for (const line of status.recentOutput) {
                const payload = `data: ${JSON.stringify({ text: line })}\n\n`;
                controller.enqueue(encoder.encode(payload));
              }
            }

            // Subscribe to new lines.
            const unsub = state.subscribeOutput(antName, (text) => {
              try {
                const payload = `data: ${JSON.stringify({ text })}\n\n`;
                controller.enqueue(encoder.encode(payload));
              } catch {
                unsub();
              }
            });

            // Clean up when the client disconnects.
            req.signal.addEventListener("abort", () => {
              unsub();
              try { controller.close(); } catch { /* already closed */ }
            });
          },
        });

        return new Response(stream, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      }

      // POST /api/ants/:name/pause
      if (action === "pause" && req.method === "POST") {
        const ok = state.pause(antName);
        return ok ? jsonResponse({ ok: true }) : textResponse("Ant not found", 404);
      }

      // POST /api/ants/:name/resume
      if (action === "resume" && req.method === "POST") {
        const ok = state.resume(antName);
        return ok ? jsonResponse({ ok: true }) : textResponse("Ant not found", 404);
      }

      // POST /api/ants/:name/prompt — { "prompt": "..." }
      if (action === "prompt" && req.method === "POST") {
        let body: { prompt?: string };
        try {
          body = (await req.json()) as { prompt?: string };
        } catch {
          return textResponse("Invalid JSON", 400);
        }
        if (typeof body.prompt !== "string" || !body.prompt.trim()) {
          return textResponse("prompt is required", 400);
        }
        if (!state.getAntStatus(antName)) return textResponse("Ant not found", 404);
        if (taskStore) {
          const project = taskStore.getOrCreateDefaultProject();
          const prompt = body.prompt.trim();
          const task = taskStore.createTask({
            projectId: project.id,
            title: taskTitle(prompt),
            description: prompt,
            assigneeType: "ant",
            assigneeName: antName,
            source: "manual",
          });
          state.wake(antName);
          return jsonResponse({ ok: true, taskId: task.id });
        }
        return jsonResponse({ ok: true });
      }

      // POST /api/ants/:name/clear
      if (action === "clear" && req.method === "POST") {
        const cleared = state.clearQueue(antName);
        return jsonResponse({ ok: true, cleared });
      }

      // GET /api/ants/:name/memory — last session summary
      if (action === "memory" && req.method === "GET") {
        if (!state.getAntStatus(antName)) return textResponse("Ant not found", 404);
        const summary = state.getAntMemory(antName);
        return jsonResponse({ antName, summary });
      }

      // DELETE /api/ants/:name/memory — clear last session summary
      if (action === "memory" && req.method === "DELETE") {
        if (!state.getAntStatus(antName)) return textResponse("Ant not found", 404);
        state.clearAntMemory(antName);
        return jsonResponse({ ok: true });
      }
    }

    // Serve static web UI (when webRoot is configured)
    if (webRoot && req.method === "GET") {
      const staticFile = await serveStatic(webRoot, path);
      if (staticFile) return withCors(staticFile);
      // SPA fallback: unknown non-API paths → index.html
      if (!path.startsWith("/api/")) {
        const indexFile = await serveStatic(webRoot, "/");
        if (indexFile) return withCors(indexFile);
      }
    }

    return textResponse("Not found", 404);
  };
}
