import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const gridExportSource = readFileSync("apps/desktop/src/composables/useDataGridExport.ts", "utf8");
const treeItemSource = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");
const tauriCommandsSource = readFileSync("src-tauri/src/commands/mod.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");

const backendFn = "exportQueryResultCsv";

test("frontend API exposes backend CSV export function", () => {
  assert.match(apiSource, new RegExp(`export const ${backendFn} = forward\\("${backendFn}"\\)`));
  assert.match(tauriSource, /export async function exportQueryResultCsv\(/);
  assert.match(tauriSource, /invoke\("export_query_result_csv"/);
  assert.match(httpSource, /export async function exportQueryResultCsv\(/);
});

test("CSV export entrypoints use backend API instead of frontend CSV formatter", () => {
  assert.match(gridExportSource, /api\.exportQueryResultCsv\(/);
  assert.doesNotMatch(gridExportSource, /formatCsv\(/);

  assert.match(treeItemSource, /api\.exportQueryResultCsv\(/);
  assert.doesNotMatch(treeItemSource, /content = formatCsv/);
});

test("Rust backend registers CSV export modules and command", () => {
  assert.match(rustCoreLibSource, /pub mod csv_export/);
  assert.match(tauriCommandsSource, /pub mod csv_export/);
  assert.match(tauriLibSource, /commands::csv_export::export_query_result_csv/);
});
