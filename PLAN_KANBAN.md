# Colony — Kanban Dashboard + Agent Configuration Platform

_Complete as of 2026-05-16 (v0.5.0)._

---

## Goal

A full web application for managing Colony: assigning work to agents on a Kanban board, viewing history, configuring agents through forms, and monitoring live output — without ever touching a YAML file or terminal.

---

## Architecture (as built)

**`packages/core/`** — runner + HTTP API (extended with work item routes, config CRUD, CORS, auth)

**`packages/web/`** — Next.js 16 App Router frontend, separate process

```
colony/
  packages/
    core/
      src/
        work-store.ts        ← PersistedWorkItem + SQLite CRUD (colony-work.db)
        colony-state.ts      ← AntControlHandles extended; cancelWorkItem; getWorkStore; setReloadCallback
        runner.ts            ← WorkItem has id + source; PromiseQueue.next(signal); AbortController per ant; hot reload
        dashboard.ts         ← CORS; auth (Bearer + ?key=); full REST: /api/status, /api/work, /api/config, /api/ants/*
    web/
      app/
        page.tsx             ← Kanban board (4 columns by status)
        ants/
          page.tsx           ← Ant grid (pause/resume/clear/assign)
          new/page.tsx       ← New ant creation form
          [name]/page.tsx    ← Ant detail: Monitor tab (live SSE) + Config tab (editor)
        work/
          page.tsx           ← Work history table with status filters
        settings/
          page.tsx           ← Colony config editor
      components/
        AuthGate.tsx         ← Blocks app until auth succeeds; shows key-entry form on 401
        KanbanBoard.tsx      ← 4-column board; WorkItemCard; WorkItemDrawer; AddWorkModal
        AntCard.tsx          ← Ant card with controls
        AntConfigEditor.tsx  ← Config form for single ant; RestartBanner
        ColonyConfigEditor.tsx ← Colony-level settings form; RestartBanner
        NewAntForm.tsx       ← Creation form with sanitized name input
        RestartBanner.tsx    ← "Restart required" banner with "Reload now" button
        LiveOutput.tsx       ← SSE consumer with auto-scroll
        Nav.tsx              ← Navigation: Board / Ants / History / Settings
        StatusDot.tsx
        ui/                  ← shadcn/ui: Button, Badge, Card, Dialog, Sheet, Input, Textarea,
                                ScrollArea, Separator
      lib/
        api.ts               ← typed fetch wrapper; auth headers; AuthError on 401
        auth.ts              ← AuthError, isAuthError, getStoredKey, storeKey, clearKey
        types.ts             ← shared TypeScript types (mirrors backend)
        utils.ts             ← cn, formatRelative, formatDuration, formatUptime
```

**Tech stack:**

| Decision | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 App Router | `packages/web/`, Node ≥ 24 |
| UI components | shadcn/ui + Tailwind CSS | Dark theme matching existing dashboard |
| Server state | TanStack Query | 5s polling, 3s stale time |
| Live output | SSE (`EventSource`) | Proxied via Next.js rewrites to avoid CORS |
| API proxy | `next.config.ts` rewrites | `/api/*` → `COLONY_API_URL` (default `http://localhost:8080`) |
| Work queue | In-memory `PromiseQueue` (source of truth) + SQLite write | `colony-work.db` in `configDir` |
| Hot reload | `POST /api/reload` — diffs and restarts changed ants | Banner with "Reload now" button in UI |
| Auth | `COLONY_API_KEY` env var; Bearer token; `AuthGate` component | `?key=` query param for SSE (EventSource can't set headers) |
| Port | Runner: `monitoring.port`; Web: Next.js default (3000) | Two separate processes |

---

## What was built

### Layer 1 — Work item model and persistence ✅

**Data model** (`packages/core/src/work-store.ts`):

```ts
interface PersistedWorkItem {
  id: string;           // uuid
  antName: string;
  title: string;        // first line of prompt, truncated to 80 chars
  prompt: string;
  source: "manual" | "github_issue" | "cron" | "discord";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  issueContext?: { owner: string; repo: string; number: number; repoSlug: string };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastOutput?: string;
}
```

**API:**
- `GET /api/work?status=&ant=&limit=` ✅
- `GET /api/work/:id` ✅
- `DELETE /api/work/:id` — cancels queued items only; 409 if running ✅

### Layer 2 — Agent configuration CRUD ✅

**API:**
- `GET /api/config` / `PUT /api/config` — colony.yaml (raw, no env interpolation) ✅
- `GET /api/config/ants` / `GET /api/config/ants/:name` ✅
- `POST /api/config/ants` — create new ant YAML ✅
- `PUT /api/config/ants/:name` — update ant YAML (Zod-validated) ✅
- `DELETE /api/config/ants/:name` — delete ant YAML ✅
- `POST /api/reload` — hot reload without runner restart ✅

### Layer 3 — Frontend app ✅

| Route | Status | Notes |
|---|---|---|
| `/` | ✅ | Kanban board, 4 columns, work item cards, drawer, add-work modal |
| `/ants` | ✅ | Ant grid, status dots, pause/resume/clear, assign-work button |
| `/ants/new` | ✅ | New ant creation form |
| `/ants/[name]` | ✅ | Monitor tab (live SSE output + controls) + Config tab (form editor + restart banner) |
| `/work` | ✅ | History table, status filter chips, click-to-drawer |
| `/settings` | ✅ | Colony config editor |

### Auth ✅

- `COLONY_API_KEY` env var on the runner — protects all `/api/*` routes
- Bearer token via `Authorization` header on all web frontend requests
- `?key=` query param accepted for SSE endpoints (EventSource can't set headers)
- Inline HTML dashboard: `sessionStorage`-backed key prompt on 401
- Next.js dashboard: `AuthGate` component probes `api.status()` on mount; shows login card on 401

---

## Deferred

- **`PATCH /api/work/:id` (reorder)** — waiting on drag-and-drop UI
- **Skill management UI** — browse/create/edit skill files via the web UI

---

## Running the dashboard locally

```bash
# Terminal 1 — colony runner (add monitoring.port to colony.yaml)
colony run .

# Terminal 2 — web frontend
bun --cwd packages/web next dev
# Open http://localhost:3000
# API proxied to http://localhost:8080 (set COLONY_API_URL to override)
```

---

_See also: [PLAN.md](./PLAN.md) for the core roadmap, [PLAN_MCP.md](./PLAN_MCP.md) for the MCP server._
