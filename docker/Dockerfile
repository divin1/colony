FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bunfig.toml bun.lock ./
COPY packages/ packages/
RUN bun install --frozen-lockfile

ENTRYPOINT ["bun", "packages/cli/src/index.ts", "run"]
CMD ["."]
