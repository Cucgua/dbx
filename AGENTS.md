# Repository Guidelines

## Project Structure & Module Organization
DBX is a Tauri 2 desktop app with optional web, docs, and MCP surfaces. `src/` contains the Vue 3 + TypeScript UI: `components/`, `composables/`, `stores/`, `lib/`, `types/`, `styles/`, and `i18n/`. `src-tauri/` contains the Tauri shell, commands, config, capabilities, and icons. `crates/dbx-core/` holds shared Rust database, query, schema, import, transfer, storage, and AI logic. `src-web/` is the Rust web backend. `tests/` contains Node `node:test` specs for pure TypeScript utilities. `docs/` is the Fumadocs/Next.js site, `mcp/` is the standalone MCP server, and `public/` stores static assets.

## Build, Test, and Development Commands
Use `pnpm install` for root dependencies. `pnpm dev:tauri` runs the desktop app; `pnpm dev:web` runs the browser frontend; `pnpm dev:backend` runs the Rust web backend with `DBX_PASSWORD` defaulting to `test`. `pnpm build` performs `vue-tsc --noEmit` and a Vite build. `pnpm check` runs frontend formatting, linting, and type checks; `pnpm fmt` formats `src/**/*.{ts,vue}`. Rust validation mirrors CI: `cargo fmt --check` and `cargo check --workspace --locked`. Build docs from `docs/` with `pnpm build`; build `mcp/` with `npm run build`.

## Coding Style & Naming Conventions
Frontend code uses strict TypeScript, Vue SFCs, Pinia stores, and the `@/` alias for `src/`. Use PascalCase components, `useXxx` composables, `xxxStore` stores, and descriptive camelCase utility files under `src/lib/`. Format TypeScript and Vue with `oxfmt`; lint with `oxlint --vue-plugin src`. Rust uses edition 2021 and `rustfmt.toml` with `max_width = 120`; use snake_case modules and functions.

## Testing Guidelines
There is no root `pnpm test` script. Add targeted specs under `tests/*.test.ts` for pure utility behavior, using Node’s built-in `node:test` style with `node:assert`. For Rust changes, add tests close to the affected crate/module and run the smallest relevant Cargo test in your host environment. Run `pnpm check` and the CI Rust checks before opening a PR.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits such as `feat(oracle): ...`, `fix(postgres): ...`, and `docs: ...`. Keep commits scoped and behavior-focused. PRs should describe the visible change, list validation performed, link related issues, and include screenshots or recordings for UI changes. Mention database type and version when fixing driver-specific behavior.

## Security & Agent Notes
Never commit real database credentials, tokens, private keys, or production data. Redact connection strings and logs in issues. When working from WSL on a `/mnt/*` checkout, run build/test commands in the Windows host terminal or IDE environment rather than WSL shell to avoid toolchain drift.
