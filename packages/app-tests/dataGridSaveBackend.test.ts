import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const editorSource = readFileSync("apps/desktop/src/composables/useDataGridEditor.ts", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");

test("shared API exposes backend data grid save preparation", () => {
  assert.match(apiSource, /export const prepareDataGridSave = forward\("prepareDataGridSave"\)/);
  assert.match(apiSource, /export const buildDataGridCopyUpdateStatements = forward\("buildDataGridCopyUpdateStatements"\)/);
  assert.match(apiSource, /export const buildDataGridContextFilterCondition = forward\("buildDataGridContextFilterCondition"\)/);
  assert.match(apiSource, /export const buildDataGridCountSql = forward\("buildDataGridCountSql"\)/);
  assert.match(apiSource, /export const buildHiveTablePropertiesSql = forward\("buildHiveTablePropertiesSql"\)/);
  assert.match(tauriSource, /export async function prepareDataGridSave\(/);
  assert.match(tauriSource, /invoke\("prepare_data_grid_save"/);
  assert.match(tauriSource, /invoke\("build_data_grid_copy_update_statements"/);
  assert.match(tauriSource, /invoke<string \| null>\("build_data_grid_context_filter_condition"/);
  assert.match(tauriSource, /invoke\("build_data_grid_count_sql"/);
  assert.match(tauriSource, /invoke\("build_hive_table_properties_sql"/);
  assert.match(httpSource, /export async function prepareDataGridSave\(/);
  assert.match(httpSource, /\/api\/query\/prepare-data-grid-save/);
  assert.match(httpSource, /\/api\/query\/build-data-grid-copy-update-statements/);
  assert.match(httpSource, /\/api\/query\/build-data-grid-context-filter-condition/);
  assert.match(httpSource, /\/api\/query\/build-data-grid-count-sql/);
  assert.match(httpSource, /\/api\/query\/build-hive-table-properties-sql/);
});

test("data grid save flow uses backend save preparation", () => {
  assert.match(editorSource, /await api\.prepareDataGridSave\(stmtOptions\)/);
  assert.doesNotMatch(editorSource, /buildDataGridSaveStatements\(/);
  assert.doesNotMatch(editorSource, /buildDataGridRollbackStatements\(/);
  assert.doesNotMatch(editorSource, /validateDataGridSave\(/);
});

test("Rust backends register data grid save preparation", () => {
  assert.match(rustCoreLibSource, /pub mod data_grid_sql/);
  assert.match(tauriLibSource, /commands::query::prepare_data_grid_save/);
  assert.match(tauriLibSource, /commands::query::build_data_grid_copy_update_statements/);
  assert.match(tauriLibSource, /commands::query::build_data_grid_context_filter_condition/);
  assert.match(tauriLibSource, /commands::query::build_data_grid_count_sql/);
  assert.match(tauriLibSource, /commands::query::build_hive_table_properties_sql/);
  assert.match(webMainSource, /\/query\/prepare-data-grid-save/);
  assert.match(webMainSource, /\/query\/build-data-grid-copy-update-statements/);
  assert.match(webMainSource, /\/query\/build-data-grid-context-filter-condition/);
  assert.match(webMainSource, /\/query\/build-data-grid-count-sql/);
  assert.match(webMainSource, /\/query\/build-hive-table-properties-sql/);
});
