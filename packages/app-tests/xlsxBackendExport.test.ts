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

const backendFn = "exportQueryResultXlsx";

test("frontend API exposes backend XLSX export function", () => {
  assert.match(apiSource, new RegExp(`export const ${backendFn} = forward\\("${backendFn}"\\)`));
  assert.match(tauriSource, /export async function exportQueryResultXlsx\(/);
  assert.match(tauriSource, /invoke\("export_query_result_xlsx"/);
  assert.match(httpSource, /export async function exportQueryResultXlsx\(/);
});

test("UI uses backend XLSX export instead of frontend workbook builder", () => {
  assert.match(gridExportSource, /api\.exportQueryResultXlsx\(/);
  assert.doesNotMatch(gridExportSource, /buildXlsxWorkbook/);

  assert.match(treeItemSource, /api\.exportQueryResultXlsx\(/);
  assert.doesNotMatch(treeItemSource, /buildXlsxWorkbook/);
});

test("Tauri registers backend XLSX export command", () => {
  assert.match(tauriCommandsSource, /pub mod xlsx_export/);
  assert.match(tauriLibSource, /commands::xlsx_export::export_query_result_xlsx/);
});
