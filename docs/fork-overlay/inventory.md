# DBX Fork Overlay Inventory

## Baseline

- Target baseline: `t8y2/dbx` upstream main.
- Current upstream baseline commit: `a8c08cd7`.
- Current fork source: `Cucgua/dbx`.
- Current fork source commit observed when this inventory was created: `580a72e6` on `feature/schema-rag-v1`.
- Current fork branch sources may include `feature/schema-rag-v1`, `origin/main`, and backup branches.

## Keep

- HTTP MCP overlay.
- Schema RAG sidecar.
- Schema RAG AI tool loop.
- Minimal settings panels and Tauri command glue.
- Sidecar build and release glue.

## Drop

- Oracle OCI.
- Oracle 11g client setup.
- Oracle service/SID/default database behavior.
- `default_database` fork semantics unless already present upstream.
- Release/CI patches unrelated to HTTP MCP or Schema RAG.

## Patch Sources

| Area | Source Paths | Destination Strategy |
| --- | --- | --- |
| HTTP MCP | `crates/dbx-mcp/**` | Copy as isolated crate, then remove Oracle-specific tool branches. |
| RAG sidecar | `crates/dbx-schema-rag-sidecar/**` | Copy as isolated sidecar crate. |
| RAG Tauri commands | `src-tauri/src/commands/schema_rag.rs` | Copy as isolated command module, adapt to upstream schema APIs. |
| AI integration | `apps/desktop/src/lib/ai.ts` | Extract into focused overlay modules; keep `ai.ts` thin. |
| Settings | `EditorSettingsDialog.vue`, `settingsStore.ts` | Convert to extension panels and extension settings store. |
| Release | `.github/workflows/release.yml` | Start from upstream release workflow, then add sidecar-specific dependencies. |
