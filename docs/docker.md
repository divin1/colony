# Docker Deployment

Docker is the recommended way to run a colony in production. A single `docker compose up -d` starts both the Colony runner and the web dashboard, with automatic restarts on crash or host reboot.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2 (bundled with Docker Desktop; install separately on Linux)
- A working colony directory with a valid `colony.yaml` and at least one ant in `ants/`

---

## Services

| Service | What it runs | Default port |
|---|---|---|
| `runner` | Colony runner — ant supervisor, HTTP API | 8080 (internal only) |
| `web` | Next.js dashboard — Kanban board, config editor, live output | 3000 (host-exposed) |

The `web` service proxies all `/api/*` calls to `http://runner:8080` over the internal Docker network. The runner's port is not exposed to the host by default; open your browser at **http://localhost:3000**.

---

## Directory layout

```
colony/          ← cloned Colony repo
  docker/
    Dockerfile
    Dockerfile.web
    docker-compose.yml
    .env.example
my-colony/       ← your colony directory (mounted at runtime)
  colony.yaml
  ants/
    worker.yaml
  .env            ← fill in your tokens here
```

The colony directory is mounted as a volume — you can edit configs and hot-reload without rebuilding images.

---

## Quick start

### 1. Enable the HTTP API

`colony.yaml` must have `monitoring.port` set for the dashboard to work:

```yaml
name: my-colony
monitoring:
  port: 8080
```

### 2. Create your `.env`

```bash
cp colony/docker/.env.example my-colony/.env
```

Edit `my-colony/.env` and fill in your credentials:

```env
ANTHROPIC_API_KEY=sk-ant-...   # required for claude-cli ants

DISCORD_TOKEN=                 # optional — full Discord bot
DISCORD_WEBHOOK_URL=           # optional — send-only webhook

# Set a secret to protect the dashboard with an API key (recommended for
# any deployment accessible beyond localhost):
COLONY_API_KEY=your-secret-here
```

### 3. Copy and adapt the compose file

```bash
cp colony/docker/docker-compose.yml my-colony/docker-compose.yml
```

Edit the `context:` paths to point at the Colony repo:

```yaml
services:
  runner:
    build:
      context: ../colony          # path to the cloned Colony repo
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    env_file: .env
    volumes:
      - .:/colony
    working_dir: /colony
    command: ["run", "."]

  web:
    build:
      context: ../colony
      dockerfile: docker/Dockerfile.web
    restart: unless-stopped
    environment:
      COLONY_API_URL: http://runner:8080
    depends_on:
      - runner
    ports:
      - "3000:3000"
```

### 4. Build and start

```bash
cd my-colony
docker compose build   # first time, or after pulling a new Colony version
docker compose up -d
```

Open **http://localhost:3000**. If `COLONY_API_KEY` is set in `.env`, the dashboard will prompt for the key on first load.

### 5. Tail logs

```bash
docker compose logs -f           # all services
docker compose logs -f runner    # runner only
docker compose logs -f web       # web only
```

### 6. Stop

```bash
docker compose down
```

---

## Running without the web dashboard

If you only want the runner (no dashboard), use a single-service compose file or `docker run` directly:

```bash
cd colony
docker build -f docker/Dockerfile -t colony-runner:latest .

docker run -d \
  --name my-colony \
  --restart unless-stopped \
  --env-file /path/to/my-colony/.env \
  -v /path/to/my-colony:/colony \
  -w /colony \
  colony-runner:latest run .
```

---

## Dashboard auth

Set `COLONY_API_KEY` in `.env` to protect the HTTP API and web dashboard with a Bearer token. The web frontend prompts for the key on first load and stores it in the browser's `localStorage`.

If you also use the MCP server (`colony mcp`), pass the same key:

```bash
colony mcp --url http://your-host:3000 --key your-secret-here
# or via env: export COLONY_API_KEY=your-secret-here
```

> **Note:** The web service does not need `COLONY_API_KEY` itself. The browser sends the Bearer token directly to the runner through the Next.js proxy.

---

## Exposing the raw API

The runner's port 8080 is internal by default. To expose it to the host (e.g. for direct API access or a remote MCP server), uncomment in `docker-compose.yml`:

```yaml
  runner:
    ports:
      - "8080:8080"
```

---

## Updating configs

The colony directory is mounted as a volume, so config changes take effect after a hot reload — no image rebuild needed:

1. Edit ant or colony YAML files.
2. Click **Reload** in the dashboard, or call `POST /api/reload`.

To restart all ants:

```bash
docker compose restart runner
```

---

## Updating Colony itself

```bash
cd colony
git pull
bun install           # update lockfile if deps changed

docker compose build  # rebuild both images
docker compose up -d  # restart with new images
```

---

## Persistent state

All runtime databases are written to the mounted colony directory and survive container restarts automatically.

| File | Contents |
|---|---|
| `colony-tasks.db` | Projects, tasks, and comments (the Kanban board) |
| `colony-state.db` | Per-ant session summaries (used when `state.backend: sqlite` is set) |

Both files are created on first run. Because the colony directory is volume-mounted to the host, data persists as long as the host directory exists. Add `*.db` to your `.gitignore` to avoid accidentally committing them.

The per-ant session state backend is configured separately in each ant's YAML:

```yaml
# ants/worker.yaml
state:
  backend: sqlite
  path: ./colony-state.db    # written to my-colony/colony-state.db on the host
```

---

## Running multiple colonies

Each colony is an independent stack. Use separate compose files and directories:

```
projects/
  acme/
    colony.yaml
    ants/
    .env
    docker-compose.yml    # context: ../../colony
  internal/
    colony.yaml
    ants/
    .env
    docker-compose.yml
```

Each runs on its own port:

```yaml
# acme/docker-compose.yml
services:
  web:
    ports:
      - "3001:3000"   # acme dashboard on :3001

# internal/docker-compose.yml
services:
  web:
    ports:
      - "3002:3000"   # internal dashboard on :3002
```
