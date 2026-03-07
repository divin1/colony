# Docker Deployment

Docker is the recommended way to run a colony in production. The provided `Dockerfile` and `docker-compose.yml` give you a zero-downtime, auto-restarting deployment with a single command.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2 (bundled with Docker Desktop; install separately on Linux)
- A working colony directory with a valid `colony.yaml` and at least one ant in `ants/`

---

## Directory layout

Your colony directory must be on the Docker host. The container mounts it at runtime, so you can edit configs and restart without rebuilding the image.

```
my-colony/              ← this is the directory you mount
  colony.yaml
  ants/
    worker.yaml
    reviewer.yaml
  .env                  ← secrets live here, never in YAML
```

The `docker/` directory inside the Colony repo contains the `Dockerfile` and a template `docker-compose.yml`. You reference them from your colony directory.

---

## Option A — docker compose (recommended)

From the root of the Colony repo (the directory you cloned), with your colony directory alongside it:

```
colony/         ← cloned repo
  docker/
    Dockerfile
    docker-compose.yml
my-colony/      ← your colony directory
  colony.yaml
  ants/
  .env
```

1. **Copy and adapt the compose file** into your colony directory:

```bash
cp colony/docker/docker-compose.yml my-colony/docker-compose.yml
```

2. **Edit `docker-compose.yml`** to set the correct paths:

```yaml
services:
  colony:
    build:
      context: ../colony          # path to the cloned Colony repo
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    env_file: .env                # secrets from your colony directory
    volumes:
      - .:/colony                 # mount your colony directory into the container
    working_dir: /colony
    command: ["run", "."]
```

3. **Start:**

```bash
cd my-colony
docker compose up -d
```

4. **Tail logs:**

```bash
docker compose logs -f
```

5. **Stop:**

```bash
docker compose down
```

The `restart: unless-stopped` policy means the container restarts automatically if it crashes or after a host reboot, until you explicitly stop it with `docker compose down`.

---

## Option B — docker run

Build the image once from the Colony repo root:

```bash
cd colony
docker build -f docker/Dockerfile -t colony:latest .
```

Run it, mounting your colony directory:

```bash
docker run -d \
  --name my-colony \
  --restart unless-stopped \
  --env-file /path/to/my-colony/.env \
  -v /path/to/my-colony:/colony \
  -w /colony \
  colony:latest run .
```

View logs:

```bash
docker logs -f my-colony
```

Stop and remove:

```bash
docker stop my-colony
docker rm my-colony
```

---

## Environment variables

Secrets are passed to the container via `--env-file` (docker run) or `env_file:` (compose). Never put tokens in `colony.yaml` or commit `.env`.

**`.env` format:**

```env
ANTHROPIC_API_KEY=sk-ant-...
DISCORD_TOKEN=MTIz...
GITHUB_TOKEN=ghp_...
```

Variables referenced in YAML as `${VAR_NAME}` are read from the container's environment at startup. If a variable is missing, `colony run` exits immediately with a clear error — check `docker logs` to see which variable is absent.

---

## Updating configs

Because the colony directory is mounted as a volume, you can change ant configs without rebuilding the image. Just restart the container:

```bash
# with compose:
docker compose restart

# with docker run:
docker restart my-colony
```

The runner reloads all config from disk on startup.

---

## Updating Colony itself

When you pull a new version of the Colony repo and want to deploy it:

```bash
cd colony
git pull
bun install       # update lockfile if dependencies changed

# rebuild the image:
docker compose build    # or: docker build -f docker/Dockerfile -t colony:latest .

# restart with the new image:
docker compose up -d
```

---

## Logs and monitoring

The runner logs to stdout. Docker captures this automatically.

```bash
# follow live:
docker compose logs -f

# last 100 lines:
docker compose logs --tail=100
```

What you will see in the logs:

```
Colony "my-colony" online — 2 ant(s) starting.
```

Ant activity (status updates, tool summaries, errors) goes to Discord, not stdout. Check your Discord channels for runtime details.

---

## Running multiple colonies

Each colony is an independent container. To run two colonies on the same host, give them different service names and colony directories:

```yaml
# docker-compose.yml
services:
  colony-acme:
    build: { context: ../colony, dockerfile: docker/Dockerfile }
    restart: unless-stopped
    env_file: acme/.env
    volumes: [./acme:/colony]
    working_dir: /colony
    command: ["run", "."]

  colony-internal:
    build: { context: ../colony, dockerfile: docker/Dockerfile }
    restart: unless-stopped
    env_file: internal/.env
    volumes: [./internal:/colony]
    working_dir: /colony
    command: ["run", "."]
```

Each colony uses its own Discord bot, guild, and `.env`.

---

## Persistent state

If your ants use `state.backend: sqlite`, the database file is written inside the mounted colony directory on the host. It survives container restarts and re-deploys automatically because it is part of the volume mount.

```yaml
# ants/worker.yaml
state:
  backend: sqlite
  path: ./colony-state.db    # written to /path/to/my-colony/colony-state.db on the host
```

No extra volume configuration is needed.
