# Dev Reference

## Setup

```bash
bun install
```

## Common tasks

```bash
bun test                        # run all tests
bun run packages/cli/src/index.ts validate config/examples/   # validate examples
```

## Web UI

```bash
cd packages/web && bun run build   # build static export → packages/web/out/
# dev server (proxying to a running colony at :8080):
cd packages/web && bun run dev
```

## Local install (binary + web UI)

```bash
make install   # builds binary + web UI, installs both to ~/.local/bin / ~/.local/share
make clean     # remove build artifacts
```

## Release

```bash
# 1. Bump version in package.json, packages/cli, packages/core, packages/web
# 2. Add CHANGELOG entry
# 3. Update PLAN.md (_Last updated_, version, test count)
# 4. bun test — 0 failures
# 5. bun run packages/cli/src/index.ts validate config/examples/
git tag v0.X.0
git push origin v0.X.0
# → GitHub Actions builds tarballs and publishes the release automatically
```
