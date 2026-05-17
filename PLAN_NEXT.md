# Colony — Next Phases (v0.6+)

Phases 9–11 are complete. Phase 12 is a major product direction: rebuild the work model around projects and tasks. Phases 13–16 follow.

---

## Phase 9 — GitHub webhooks ✅ (complete)

Real-time issue triggers via `POST /api/webhooks/github` (HMAC-SHA256 verified).

---

## Phase 10 — Mid-session interrupt ✅ (complete)

`pause` terminates the running engine process (SIGTERM → SIGKILL) rather than waiting for session end.

---

## Phase 11 — Drag-and-drop Kanban + `PATCH /api/work/:id` ✅ (complete)

Queued items reorderable by drag within the Queued column. Position persisted in SQLite.

---

## Phase 12 — Project & Task Management

> **Decided:** Failure → back to `todo` (ant retries automatically after backoff). Completion → always `in_review` first; human moves to `done`. Migration → fresh start, drop `colony-work.db`.

Split into two sub-phases to ship incrementally:
- **12a** — data model + backend API + runner integration (no UI changes yet; old board still works during transition)
- **12b** — full UI rebuild (new board, task drawer, comments, project switcher)

### Phase 12a — Backend: Projects, Tasks, Comments

**Goal:** Replace the ant-centric work queue with a proper project management model. Human and ants collaborate on tasks inside named projects. Ants pick up tasks assigned to them; humans manage the rest.

---

### Data model

**Projects**

```
Project:
  id:          uuid
  name:        string
  description: string
  color:       string?   # hex color for UI differentiation
  created_at:  number
```

**Tasks** (replaces `PersistedWorkItem`)

```
Task:
  id:            uuid
  project_id:    string (FK → projects)
  title:         string
  description:   string          # full markdown body (the ant's actual prompt)
  status:        "backlog" | "todo" | "in_progress" | "in_review" | "done"
  assignee_type: "ant" | "human"
  assignee_name: string?          # ant name, or human's display name / omitted
  position:      number           # sort order within the status column
  source:        "manual" | "github_issue" | "cron" | "discord"
  issue_context: json?            # same shape as current issueContext
  last_output:   string?          # ant's session summary, posted as a comment too
  created_at:    number
  updated_at:    number
  started_at:    number?
  completed_at:  number?
```

**Comments**

```
Comment:
  id:         uuid
  task_id:    string (FK → tasks)
  author:     string              # ant name or "Human" or a display name
  body:       string
  created_at: number
```

---

### Kanban columns

| Column | Label | Who sets it | Ants see it? |
|---|---|---|---|
| `backlog` | Backlog | Human | ❌ Never picked up |
| `todo` | To Do | Human / ant trigger | ✅ Eligible for ant queue |
| `in_progress` | In Progress | Runner (on pickup) | ✅ Currently running |
| `in_review` | In Review | Runner (on completion) | ❌ Awaiting human |
| `done` | Done | Human (approval) | ❌ Closed |

**Backlog** is the human's staging area. Moving a task to `todo` (and assigning it to an ant) makes it eligible for processing. Moving to `done` is always a deliberate human action.

Human-assigned tasks never leave the board without human action — the runner never touches them.

---

### Runner integration (12a)

The runner replaces its current `WorkStore`-based queue with a `TaskStore` pull model:

- On startup, each ant supervisor polls `TaskStore` for tasks where `assignee_name = antName AND status = 'todo'`, ordered by `position ASC`.
- Webhook and GitHub polling triggers create tasks in `todo` (assigned to the appropriate ant) directly in `TaskStore` instead of `WorkStore`.
- On pickup: task → `in_progress`; comment posted: `🐜 Started session`.
- On success: task → `in_review`; `last_output` stored; comment posted with summary. GitHub issue comment posted if `issue_context` is set.
- On any failure (transient, rate-limit, permanent): task → `todo` (re-queued); error comment posted. Backoff delay still applies before retry.
- Human-assigned tasks (`assignee_type = "human"`) are never touched by the runner.

No conflict detection between ants on the same project — human schedules deliberately.

### Phase 12b — UI rebuild

---

### API endpoints

**Projects**
- `GET /api/projects` — list all
- `POST /api/projects` — create
- `GET /api/projects/:id`
- `PUT /api/projects/:id` — update name/description/color
- `DELETE /api/projects/:id` — deletes all tasks (requires confirm)

**Tasks**
- `GET /api/tasks?project=&assignee=&status=&limit=` — filtered list
- `POST /api/tasks` — create (project, title, description, assignee, status default `backlog`)
- `GET /api/tasks/:id`
- `PUT /api/tasks/:id` — update all fields
- `PATCH /api/tasks/:id` — partial: `{ status }`, `{ position }`, or `{ assignee_type, assignee_name }`
- `DELETE /api/tasks/:id`

**Comments**
- `GET /api/tasks/:id/comments`
- `POST /api/tasks/:id/comments` — body `{ author, body }`
- `DELETE /api/tasks/:id/comments/:commentId`

---

**Navigation**
- Project switcher in the sidebar (dropdown or tabs); "All projects" aggregate view
- Routes: `/projects/:id` for the board, `/projects/:id/tasks/:taskId` for task detail

**Kanban board** (per project)
- Five columns: Backlog, To Do, In Progress, In Review, Done
- Backlog column visually muted — tasks here are invisible to ants
- Drag-to-reorder within Todo column (already built in Phase 11, adapt to tasks)
- Card shows: title, assignee chip (ant name or "Human" badge), comment count
- "New task" button opens a form: title, description, assignee, initial status

**Task detail panel / drawer**
- Title (editable inline)
- Description (markdown textarea)
- Assignee dropdown: list of configured ants + "Human" option
- Status selector (manual override for any column)
- Comment thread: linear, newest at bottom; human can add a note; ant comments auto-posted by runner
- Issue context link (if from GitHub)
- Timestamps: created, started, completed

**My Tasks view** (`/tasks?assignee=<name>`)
- Tasks filtered by assignee across all projects
- Useful to see what a specific ant or a human has queued

**Decided:**
- `in_review` tasks with no human action: no timeout — human drives closure.
- Re-assigning a task to a different ant: `PATCH assignee` moves it back to `todo` automatically, triggering re-queue.
- Migration: drop `colony-work.db`; fresh start.

---

## Phase 13 — Skill management UI

**Goal:** Browse, create, and edit skill files from the browser.

**Backend:**
- `GET /api/skills` — list `.md` files under `{colonyDir}/skills/`; return `[{ name, description }]` (description from YAML frontmatter)
- `GET /api/skills/:name`, `PUT /api/skills/:name`, `DELETE /api/skills/:name`
- Path-traversal guard: resolve and verify path stays within `skills/` directory
- `colony init` scaffold — create `skills/` with a `README.md` example

**Frontend:**
- `/skills` route — card grid; "New skill" button
- `/skills/[name]` — frontmatter fields + markdown body textarea; Save + Delete
- `AntConfigEditor` skill path inputs become a multi-select populated from `GET /api/skills`

---

## Phase 14 — Real-time push (SSE for status + tasks)

**Goal:** Board and ant list update instantly when the runner changes state.

**Backend:**
- `GET /api/events` — SSE stream: `ant-update`, `task-update`, `comment-added`, `heartbeat` (15s)
- `ColonyState` — Set of active SSE writers; `emit(type, data)` called from state-change paths
- `TaskStore` — emits on status transitions

**Frontend:**
- `useColonyEvents` hook — `EventSource('/api/events')`; on each event calls `queryClient.setQueryData`
- Remove `refetchInterval` from status + task-list queries; keep `refetchOnWindowFocus` as fallback

---

## Phase 15 — Optimistic updates + UX polish

**Goal:** All mutations feel instant; every page handles loading and error states.

**Changes:**
- `useMutation` with `onMutate`/`onError`/`onSettled` for: pause, resume, clear, send prompt, task status change, task reorder, comment post
- Shadcn/ui `Sonner` toasts for mutation errors
- Loading skeletons for board, task list, and ant grid initial loads
- Empty states: "No projects yet" with "Create your first project" CTA; per-column board messages
- Error boundaries on each page with retry button
- `Nav.tsx` — active route highlight; mobile-responsive collapse

---

_See also: [PLAN.md](./PLAN.md) for the core roadmap, [PLAN_KANBAN.md](./PLAN_KANBAN.md) for the dashboard._
