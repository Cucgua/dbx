import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const gridExportSource = readFileSync("apps/desktop/src/composables/useDataGridExport.ts", "utf8");
const tauriCommandsSource = readFileSync("src-tauri/src/commands/mod.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webRoutesSource = readFileSync("crates/dbx-web/src/routes/mod.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");

test("frontend API exposes backend JSON and Markdown export functions", () => {
  assert.match(apiSource, /export const exportQueryResultJson = forward\("exportQueryResultJson"\)/);
  assert.match(apiSource, /export const exportQueryResultMarkdown = forward\("exportQueryResultMarkdown"\)/);

  assert.match(tauriSource, /export async function exportQueryResultJson\(/);
  assert.match(tauriSource, /invoke\("export_query_result_json"/);
  assert.match(tauriSource, /export async function exportQueryResultMarkdown\(/);
  assert.match(tauriSource, /invoke\("export_query_result_markdown"/);

  assert.match(httpSource, /export async function exportQueryResultJson\(/);
  assert.match(httpSource, /\/api\/export\/query-result-json/);
  assert.match(httpSource, /export async function exportQueryResultMarkdown\(/);
  assert.match(httpSource, /\/api\/export\/query-result-markdown/);
});

test("data grid JSON and Markdown exports use backend APIs", () => {
  assert.match(gridExportSource, /api\.exportQueryResultJson\(/);
  assert.match(gridExportSource, /api\.exportQueryResultMarkdown\(/);
  assert.doesNotMatch(gridExportSource, /formatJson\(/);
  assert.doesNotMatch(gridExportSource, /formatMarkdownTable/);
});

test("Rust backends register JSON and Markdown export modules", () => {
  assert.match(rustCoreLibSource, /pub mod text_export/);
  assert.match(tauriCommandsSource, /pub mod text_export/);
  assert.match(tauriLibSource, /commands::text_export::export_query_result_json/);
  assert.match(tauriLibSource, /commands::text_export::export_query_result_markdown/);
  assert.match(webRoutesSource, /pub mod text_export/);
  assert.match(webMainSource, /\/export\/query-result-json/);
  assert.match(webMainSource, /\/export\/query-result-markdown/);
});
