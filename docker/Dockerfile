# Stage 1: build web static files
FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bunfig.toml bun.lock ./
COPY packages/ packages/
RUN bun install --frozen-lockfile
RUN cd packages/web && bun run build

# Stage 2: runtime
FROM oven/bun:1
WORKDIR /app
COPY package.json bunfig.toml bun.lock ./
COPY packages/ packages/
RUN bun install --frozen-lockfile
COPY --from=web-builder /app/packages/web/out /app/web

ENV COLONY_WEB_ROOT=/app/web
ENTRYPOINT ["bun", "packages/cli/src/index.ts"]
CMD ["run", "."]
