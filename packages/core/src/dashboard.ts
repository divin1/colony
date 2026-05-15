import type { ColonyState } from "./colony-state.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

// --- HTTP route handler ---

export function createDashboardHandler(
  state: ColonyState
): (req: Request) => Response | Promise<Response> {
  const workStore = state.getWorkStore();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /api/status — all ant statuses
    if (path === "/api/status" && req.method === "GET") {
      return jsonResponse(state.getStatus());
    }

    // GET /api/work — list work items (filterable by status, ant, limit, offset)
    if (path === "/api/work" && req.method === "GET") {
      if (!workStore) return jsonResponse([]);
      const statusParam = url.searchParams.get("status");
      const antName = url.searchParams.get("ant") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      const status = statusParam
        ? (statusParam.split(",") as Parameters<typeof workStore.list>[0]["status"])
        : undefined;
      const items = workStore.list({ status, antName, limit, offset });
      return jsonResponse(items);
    }

    // /api/work/:id
    const workRoute = path.match(/^\/api\/work\/([^/]+)$/);
    if (workRoute) {
      const id = decodeURIComponent(workRoute[1]);

      // GET /api/work/:id — single item
      if (req.method === "GET") {
        if (!workStore) return textResponse("Not found", 404);
        const item = workStore.get(id);
        if (!item) return textResponse("Not found", 404);
        return jsonResponse(item);
      }

      // DELETE /api/work/:id — cancel a queued item
      if (req.method === "DELETE") {
        if (!workStore) return textResponse("Not found", 404);
        const result = state.cancelWorkItem(id);
        if (result === "not_found") return textResponse("Not found", 404);
        if (result === "running") return textResponse("Item is currently running", 409);
        return jsonResponse({ ok: true });
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
        const ok = state.pushPrompt(antName, body.prompt.trim(), "manual");
        return ok ? jsonResponse({ ok: true }) : textResponse("Ant not found", 404);
      }

      // POST /api/ants/:name/clear
      if (action === "clear" && req.method === "POST") {
        const cleared = state.clearQueue(antName);
        return jsonResponse({ ok: true, cleared });
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
</style>
</head>
<body>
<header>
  <span>🐜</span>
  <h1>Colony: <span id="colony-name">…</span></h1>
  <span class="tag" id="ant-count"></span>
</header>
<main id="main"><div class="empty">Connecting…</div></main>

<script>
const main = document.getElementById('main');
const colonyNameEl = document.getElementById('colony-name');
const antCountEl = document.getElementById('ant-count');

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
  const es = new EventSource('/api/ants/' + encodeURIComponent(name) + '/output');
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
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'POST' };
  try { await fetch(url, opts); } catch {}
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
    const res = await fetch('/api/status');
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
