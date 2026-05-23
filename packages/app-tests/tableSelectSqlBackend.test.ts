import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const tableSelectSource = readFileSync("apps/desktop/src/lib/tableSelectSql.ts", "utf8");
const dataGridActionsSource = readFileSync("apps/desktop/src/composables/useDataGridActions.ts", "utf8");
const navigationTargetsSource = readFileSync("apps/desktop/src/composables/useNavigationTargets.ts", "utf8");
const dataGridSource = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");
const rustSqlDialectSource = readFileSync("crates/dbx-core/src/sql_dialect.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend table select SQL builder", () => {
  assert.match(apiSource, /export const buildTableSelectSql = forward\("buildTableSelectSql"\)/);
  assert.match(tauriSource, /invoke\("build_table_select_sql"/);
  assert.match(httpSource, /\/api\/query\/build-table-select-sql/);
});

test("frontend table select builder delegates to backend API", () => {
  assert.match(tableSelectSource, /return api\.buildTableSelectSql\(options\)/);
  assert.doesNotMatch(tableSelectSource, /function buildSqlServerTableSelectSql/);
  assert.doesNotMatch(tableSelectSource, /function buildNeo4jTableSelectSql/);
  assert.doesNotMatch(tableSelectSource, /ROW_NUMBER\(\) OVER/);
});

test("table data callers await backend table select SQL", () => {
  assert.match(dataGridActionsSource, /await buildTableSql\(tab/);
  assert.match(navigationTargetsSource, /await buildTableSelectSql\(/);
  assert.match(dataGridSource, /await buildTableSelectSql\(/);
});

test("Rust backends register table select SQL builder", () => {
  assert.match(rustSqlDialectSource, /pub fn build_table_data_select_sql/);
  assert.match(tauriLibSource, /commands::query::build_table_select_sql/);
  assert.match(webMainSource, /\/query\/build-table-select-sql/);
});
