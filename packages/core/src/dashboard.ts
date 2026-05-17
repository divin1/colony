import { createHmac, timingSafeEqual } from "crypto";
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

// Minimal GitHub issues webhook payload — only fields Colony uses.
export interface GitHubIssueEvent {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string }>;
  };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
  // Present only for action: "labeled"
  label?: { name: string };
}

export interface DashboardOptions {
  apiKey?: string;
  webhookSecret?: string;
  onGithubWebhook?: (event: GitHubIssueEvent) => void;
  taskStore?: TaskStore;
}

function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
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
  const { apiKey, webhookSecret, onGithubWebhook, taskStore } = options;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight — always allowed so browsers can probe the API.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /api/webhooks/github — exempt from API key auth; verified by webhook secret instead.
    if (path === "/api/webhooks/github" && req.method === "POST") {
      const rawBody = await req.text();

      if (webhookSecret) {
        const sig = req.headers.get("X-Hub-Signature-256") ?? "";
        if (!verifyGitHubSignature(rawBody, sig, webhookSecret)) {
          return textResponse("Invalid signature", 401);
        }
      }

      const event = req.headers.get("X-GitHub-Event");
      if (event === "issues" && onGithubWebhook) {
        let payload: GitHubIssueEvent;
        try {
          payload = JSON.parse(rawBody) as GitHubIssueEvent;
        } catch {
          return textResponse("Invalid JSON", 400);
        }
        if (payload.action === "opened" || payload.action === "labeled") {
          try { onGithubWebhook(payload); } catch { /* never let a bad handler crash the server */ }
        }
      }

      return textResponse("ok");
    }

    // Auth check — applies to all /api/* routes when a key is configured.
    // HTML pages (/ and /dashboard) are exempt so the inline dashboard can load.
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

    // GET / — dashboard HTML
    if ((path === "/" || path === "/dashboard") && req.method === "GET") {
      return withCors(
        new Response(DASHBOARD_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
    }

    return textResponse("Not found", 404);
  };
}

// --- Dashboard HTML ---

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Colony</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
a{color:#58a6ff}
header{padding:14px 20px;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:10px}
header h1{font-size:1rem;font-weight:600;color:#8b949e}
header h1 span{color:#e1e4e8}
.tag{font-size:.72rem;background:#21262d;color:#8b949e;padding:2px 7px;border-radius:10px}
main{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;overflow:hidden}
.card-head{padding:10px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid #21262d}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.starting{background:#388bfd;animation:pulse 1.2s ease-in-out infinite}
.dot.running{background:#3fb950}
.dot.paused{background:#d29922}
.dot.crashed{background:#f85149}
.dot.backoff{background:#f0883e;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.ant-name{font-weight:600;font-size:.9rem}
.engine{font-size:.72rem;font-family:monospace;background:#0d1117;color:#8b949e;padding:2px 6px;border-radius:4px}
.queue-tag{font-size:.72rem;background:#1f2937;color:#d29922;padding:2px 7px;border-radius:10px;display:none}
.queue-tag.visible{display:inline}
.ant-meta{margin-left:auto;font-size:.75rem;color:#6e7681}
.output-wrap{position:relative}
.output{font-family:'Menlo','Monaco','Courier New',monospace;font-size:.76rem;
        background:#0d1117;padding:10px 12px;height:180px;overflow-y:auto;
        white-space:pre-wrap;word-break:break-word;color:#8b949e;line-height:1.5}
.output .ln{color:#6e7681}
.output .ln.err{color:#f85149}
.output .ln.ok{color:#3fb950}
.output .ln.status{color:#6e7681;font-style:italic}
.card-foot{padding:8px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid #21262d}
button{padding:3px 10px;border:1px solid #30363d;border-radius:5px;cursor:pointer;
       font-size:.78rem;background:#21262d;color:#c9d1d9;transition:background .1s}
button:hover:not(:disabled){background:#30363d}
button:disabled{opacity:.4;cursor:default}
.btn-pause{border-color:#d29922;color:#d29922}
.btn-resume{border-color:#3fb950;color:#3fb950}
.btn-danger{border-color:#f85149;color:#f85149}
.prompt-input{flex:1;min-width:160px;padding:3px 8px;background:#0d1117;
              border:1px solid #30363d;border-radius:5px;color:#e1e4e8;font-size:.78rem}
.prompt-input:focus{outline:none;border-color:#58a6ff}
.empty{padding:40px;text-align:center;color:#6e7681;font-size:.9rem}
.uptime{color:#8b949e}
#auth-screen{display:none;position:fixed;inset:0;background:#0f1117;z-index:999;
             align-items:center;justify-content:center}
#auth-screen.visible{display:flex}
.auth-box{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:32px;
          width:100%;max-width:340px;display:flex;flex-direction:column;gap:16px}
.auth-box h2{font-size:1rem;font-weight:600}
.auth-box p{font-size:.82rem;color:#8b949e}
.auth-box input{width:100%;padding:6px 10px;background:#0d1117;border:1px solid #30363d;
                border-radius:5px;color:#e1e4e8;font-size:.85rem}
.auth-box input:focus{outline:none;border-color:#58a6ff}
.auth-box .err{font-size:.78rem;color:#f85149;min-height:1em}
.auth-btn{width:100%;padding:6px 10px;background:#238636;border:1px solid #2ea043;
          border-radius:5px;color:#e1e4e8;font-size:.85rem;font-weight:500;cursor:pointer}
.auth-btn:hover{background:#2ea043}
.auth-btn:disabled{opacity:.5;cursor:default}
</style>
</head>
<body>
<header>
  <span>🐜</span>
  <h1>Colony: <span id="colony-name">…</span></h1>
  <span class="tag" id="ant-count"></span>
</header>
<main id="main"><div class="empty">Connecting…</div></main>

<div id="auth-screen">
  <div class="auth-box">
    <h2>Colony</h2>
    <p>Enter the API key to access this colony.</p>
    <input type="password" id="auth-input" placeholder="API key" autocomplete="current-password">
    <div class="err" id="auth-err"></div>
    <button class="auth-btn" id="auth-btn" onclick="submitAuth()">Connect</button>
  </div>
</div>

<script>
const main = document.getElementById('main');
const colonyNameEl = document.getElementById('colony-name');
const antCountEl = document.getElementById('ant-count');
const authScreen = document.getElementById('auth-screen');
const authInput = document.getElementById('auth-input');
const authErr = document.getElementById('auth-err');
const authBtn = document.getElementById('auth-btn');

const STORAGE_KEY = 'colony_api_key';

function getStoredKey() {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function storeKey(k) {
  try { sessionStorage.setItem(STORAGE_KEY, k); } catch {}
}
function authHeaders(extra) {
  const key = getStoredKey();
  const h = extra || {};
  if (key) h['Authorization'] = 'Bearer ' + key;
  return h;
}

function showAuth(errMsg) {
  authErr.textContent = errMsg || '';
  authScreen.classList.add('visible');
  authInput.value = '';
  authBtn.disabled = false;
  setTimeout(() => authInput.focus(), 50);
}

async function submitAuth() {
  const key = authInput.value.trim();
  if (!key) return;
  authBtn.disabled = true;
  authErr.textContent = '';
  storeKey(key);
  try {
    const res = await fetch('/api/status', { headers: { Authorization: 'Bearer ' + key } });
    if (res.status === 401) { showAuth('Invalid API key. Try again.'); return; }
    authScreen.classList.remove('visible');
    refresh();
  } catch {
    showAuth('Connection failed. Try again.');
  }
}

authInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });

const sseMap = {};
const knownAnts = new Set();

function uptime(startedAt) {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function lineClass(text) {
  if (/^(✅|🐜)/.test(text)) return 'ok';
  if (/^(❌|💳|🔐|💰|🚫)/.test(text)) return 'err';
  if (/^(⏳|⏸️|▶️|⚙️)/.test(text)) return 'status';
  return '';
}

function appendLine(name, text) {
  const el = document.getElementById('out-' + name);
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'ln ' + lineClass(text);
  div.textContent = text;
  el.appendChild(div);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
    el.scrollTop = el.scrollHeight;
  }
}

function connectSSE(name) {
  if (sseMap[name]) sseMap[name].close();
  const key = getStoredKey();
  const qs = key ? '?key=' + encodeURIComponent(key) : '';
  const es = new EventSource('/api/ants/' + encodeURIComponent(name) + '/output' + qs);
  sseMap[name] = es;
  es.onmessage = (e) => {
    try { appendLine(name, JSON.parse(e.data).text); } catch {}
  };
  es.onerror = () => {
    es.close();
    delete sseMap[name];
    setTimeout(() => connectSSE(name), 4000);
  };
}

async function doAction(name, action, body) {
  const url = '/api/ants/' + encodeURIComponent(name) + '/' + action;
  const opts = body
    ? { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }
    : { method: 'POST', headers: authHeaders() };
  try {
    const res = await fetch(url, opts);
    if (res.status === 401) { showAuth('Session expired. Re-enter API key.'); return; }
  } catch {}
  refresh();
}

function sendPrompt(name) {
  const inp = document.getElementById('inp-' + name);
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) return;
  inp.value = '';
  doAction(name, 'prompt', { prompt: val });
}

function renderCard(ant) {
  const dot = ant.state;
  const q = ant.queueSize;
  const isPaused = ant.state === 'paused';
  const pauseBtn = isPaused
    ? '<button class="btn-resume" onclick="doAction(\\''+ant.name+'\\',\\'resume\\')">▶ Resume</button>'
    : '<button class="btn-pause" onclick="doAction(\\''+ant.name+'\\',\\'pause\\')">⏸ Pause</button>';
  return '<div class="card" id="card-'+ant.name+'">'
    + '<div class="card-head">'
    +   '<span class="dot '+dot+'" id="dot-'+ant.name+'"></span>'
    +   '<span class="ant-name">'+ant.name+'</span>'
    +   '<span class="engine">'+ant.engine+'</span>'
    +   '<span class="queue-tag'+(q>0?' visible':'')+'" id="q-'+ant.name+'">'+(q>0?q+' queued':'')+'</span>'
    +   '<span class="ant-meta" id="meta-'+ant.name+'">'
    +     ant.sessionsCompleted+' done &middot; '+ant.sessionsCrashed+' failed &middot; <span class="uptime" id="up-'+ant.name+'"></span>'
    +   '</span>'
    + '</div>'
    + '<div class="output-wrap"><div class="output" id="out-'+ant.name+'"></div></div>'
    + '<div class="card-foot">'
    +   '<span id="pbtn-'+ant.name+'">'+pauseBtn+'</span>'
    +   '<button class="btn-danger" onclick="if(confirm(\\'Clear '+ant.name+' queue?\\'))doAction(\\''+ant.name+'\\',\\'clear\\')">🗑 Clear</button>'
    +   '<input class="prompt-input" id="inp-'+ant.name+'" type="text" placeholder="Send a work instruction…"'
    +     ' onkeydown="if(event.key===\\'Enter\\')sendPrompt(\\''+ant.name+'\\')">'
    +   '<button onclick="sendPrompt(\\''+ant.name+'\\')">Send</button>'
    + '</div>'
    + '</div>';
}

function updateCard(ant) {
  const dot = document.getElementById('dot-' + ant.name);
  if (dot) { dot.className = 'dot ' + ant.state; }

  const q = document.getElementById('q-' + ant.name);
  if (q) {
    q.textContent = ant.queueSize > 0 ? ant.queueSize + ' queued' : '';
    q.className = 'queue-tag' + (ant.queueSize > 0 ? ' visible' : '');
  }

  const meta = document.getElementById('meta-' + ant.name);
  if (meta) {
    meta.innerHTML = ant.sessionsCompleted + ' done &middot; '
      + ant.sessionsCrashed + ' failed &middot; <span class="uptime" id="up-'+ant.name+'"></span>';
  }

  const pbtn = document.getElementById('pbtn-' + ant.name);
  if (pbtn) {
    const isPaused = ant.state === 'paused';
    pbtn.innerHTML = isPaused
      ? '<button class="btn-resume" onclick="doAction(\\''+ant.name+'\\',\\'resume\\')">▶ Resume</button>'
      : '<button class="btn-pause" onclick="doAction(\\''+ant.name+'\\',\\'pause\\')">⏸ Pause</button>';
  }
}

function tickUptimes(ants) {
  for (const ant of ants) {
    const el = document.getElementById('up-' + ant.name);
    if (el) el.textContent = uptime(ant.startedAt);
  }
}

let lastAnts = [];

async function refresh() {
  try {
    const res = await fetch('/api/status', { headers: authHeaders() });
    if (res.status === 401) { showAuth(); return; }
    if (!res.ok) return;
    const data = await res.json();

    colonyNameEl.textContent = data.colony;
    document.title = 'Colony — ' + data.colony;
    antCountEl.textContent = data.ants.length + ' ant' + (data.ants.length !== 1 ? 's' : '');

    const ants = data.ants;
    lastAnts = ants;
    const currentNames = new Set(ants.map(a => a.name));
    const needsRender = [...currentNames].some(n => !knownAnts.has(n))
                     || [...knownAnts].some(n => !currentNames.has(n));

    if (needsRender) {
      main.innerHTML = ants.length === 0
        ? '<div class="empty">No ants configured.</div>'
        : ants.map(renderCard).join('');
      for (const ant of ants) {
        if (!knownAnts.has(ant.name)) connectSSE(ant.name);
        knownAnts.add(ant.name);
      }
    } else {
      for (const ant of ants) updateCard(ant);
    }
    tickUptimes(ants);
  } catch {}
}

refresh();
const POLL_MS = 5000;
setInterval(refresh, POLL_MS);
setInterval(() => tickUptimes(lastAnts), 1000);
</script>
</body>
</html>`;
