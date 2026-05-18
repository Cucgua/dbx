# Contributing to DBX

Thanks for helping improve DBX. This repository contains the desktop app, Rust backend, Docker service, documentation site, CLI, MCP server, and optional plugins.

## Project Layout

- `apps/desktop/` - Vue desktop frontend.
- `crates/dbx-core/` - shared Rust database core.
- `crates/dbx-web/` - Docker/web backend service.
- `src-tauri/` - Tauri desktop shell and native commands.
- `packages/` - Node packages, including CLI, MCP server, shared Node core, and app tests.
- `plugins/` - optional DBX plugins.
- `docs/` - documentation site and docs assets.
- `deploy/` - Docker and deployment assets.

## Development Setup

Required tools:

- Node.js `>=22.13.0`
- pnpm `10.27.0`
- Rust stable
- Java 17, when working on JDBC plugin packaging

Install dependencies:

```bash
pnpm install
```

Run the desktop app during development:

```bash
pnpm dev:tauri
```

Run the web backend:

```bash
pnpm dev:backend
```

## Checks

Before opening a pull request, run:

```bash
pnpm check
cargo fmt --check
cargo check --workspace --locked
```

For package changes, also run:

```bash
pnpm test:packages
pnpm publish:dry-run
```

For Docker or deployment changes, run the relevant Docker Compose or Docker build checks from `deploy/`.

## Pull Requests

- Keep changes focused and reviewable.
- Include tests for behavior changes when practical.
- Update documentation when user-facing behavior changes.
- Use clear commit messages following Conventional Commits, such as `fix(app): clamp window size`.

## Reporting Issues

Use GitHub Issues for reproducible bugs, feature requests, database compatibility reports, and questions. Include the DBX version, operating system, database type, and relevant logs or screenshots when possible.
