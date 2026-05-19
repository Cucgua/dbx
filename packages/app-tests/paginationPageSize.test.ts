import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_PAGE_SIZE_OPTIONS,
  normalizeResultPageSize,
  resultPageSizeMenuOptions,
} from "../../apps/desktop/src/lib/paginationPageSize.ts";
import { readFileSync } from "node:fs";

test("normalizes query result page sizes into a safe range", () => {
  assert.equal(normalizeResultPageSize(undefined), 100);
  assert.equal(normalizeResultPageSize(0), 100);
  assert.equal(normalizeResultPageSize(-5), 100);
  assert.equal(normalizeResultPageSize(42.8), 42);
  assert.equal(normalizeResultPageSize(200000), 100000);
});

test("query result page size menu includes the current custom value", () => {
  assert.deepEqual(RESULT_PAGE_SIZE_OPTIONS, [50, 100, 500, 1000]);
  assert.deepEqual(resultPageSizeMenuOptions(5000), [50, 100, 500, 1000, 5000]);
  assert.deepEqual(resultPageSizeMenuOptions(100), [50, 100, 500, 1000]);
});

test("data grid page size menu exposes a custom input", () => {
  const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

  assert.match(source, /customPageSizeInput/);
  assert.match(source, /settingsStore\.updateEditorSettings\(\{ pageSize: normalizedSize \}\)/);
  assert.match(source, /t\("grid\.customRowsPerPage"\)/);
});

test("data grid page size follows the global editor setting", () => {
  const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

  assert.match(source, /\(\) => settingsStore\.editorSettings\.pageSize/);
  assert.match(source, /pageSize\.value = normalizeResultPageSize\(value, pageSize\.value\)/);
});

test("truncated result copy uses the active page size", () => {
  const gridSource = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");
  const zhSource = readFileSync("apps/desktop/src/i18n/locales/zh-CN.ts", "utf8");
  const enSource = readFileSync("apps/desktop/src/i18n/locales/en.ts", "utf8");

  assert.match(gridSource, /const showTruncationWarning = computed/);
  assert.match(gridSource, /v-if="showTruncationWarning"/);
  assert.match(gridSource, /t\("grid\.truncatedHint", \{ count: pageSize \}\)/);
  assert.match(zhSource, /结果已截断，仅显示前 \{count\} 行/);
  assert.match(enSource, /Results truncated to \{count\} rows/);
  assert.doesNotMatch(zhSource, /仅显示前 10,000 行/);
  assert.doesNotMatch(enSource, /truncated to 10,000 rows/);
});

test("query execution sends the selected page size to agent drivers", () => {
  const source = readFileSync("apps/desktop/src/stores/queryStore.ts", "utf8");

  assert.match(source, /if \(tab\.mode === "data"\) \{/);
  assert.match(source, /pageLimit = settingsStore\.editorSettings\.pageSize/);
  assert.match(source, /maxRows: pageLimit,\s*fetchSize: pageLimit,\s*pageSize: pageLimit/s);
  assert.doesNotMatch(source, /maxRows: 10000,\s*fetchSize: pageLimit,\s*pageSize: pageLimit/s);
});

test("native sql drivers receive the selected row limit", () => {
  const querySource = readFileSync("crates/dbx-core/src/query.rs", "utf8");
  const postgresSource = readFileSync("crates/dbx-core/src/db/postgres.rs", "utf8");
  const mysqlSource = readFileSync("crates/dbx-core/src/db/mysql.rs", "utf8");
  const sqliteSource = readFileSync("crates/dbx-core/src/db/sqlite.rs", "utf8");
  const sqlserverSource = readFileSync("crates/dbx-core/src/db/sqlserver.rs", "utf8");
  const clickhouseSource = readFileSync("crates/dbx-core/src/db/clickhouse_driver.rs", "utf8");

  assert.match(querySource, /let max_rows = options\.max_rows/);
  assert.match(querySource, /db::postgres::execute_query_with_max_rows\(&p, sql, max_rows\)/);
  assert.match(querySource, /db::mysql::execute_query_with_max_rows\(&p, sql, bare, max_rows\)/);
  assert.match(querySource, /db::sqlite::execute_query_with_max_rows\(&p, sql, max_rows\)/);
  assert.match(querySource, /db::clickhouse_driver::execute_query_with_max_rows\(&client, &database, sql, max_rows\)/);
  assert.match(querySource, /db::sqlserver::execute_query_with_max_rows\(&mut client, sql, max_rows\)/);
  assert.match(querySource, /truncate_result_with_max_rows\(result, max_rows\)/);
  assert.match(postgresSource, /let row_limit = query_result_row_limit\(max_rows\)/);
  assert.match(mysqlSource, /let row_limit = query_result_row_limit\(max_rows\)/);
  assert.match(sqliteSource, /let row_limit = query_result_row_limit\(max_rows\)/);
  assert.match(sqlserverSource, /let row_limit = query_result_row_limit\(max_rows\)/);
  assert.match(clickhouseSource, /let row_limit = query_result_row_limit\(max_rows\)/);
});

test("table data grid receives pagination context", () => {
  const source = readFileSync("apps/desktop/src/components/layout/ContentArea.vue", "utf8");

  assert.match(source, /:page-offset="activeTab\.resultPageOffset"/);
  assert.match(source, /:page-limit="activeTab\.resultPageLimit"/);
});

test("data grid page size menu keeps the custom control compact", () => {
  const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

  assert.match(source, /DropdownMenuContent align="end" class="w-36"/);
  assert.match(source, /class="h-7 w-24 text-xs tabular-nums/);
  assert.match(source, /:aria-label="t\('grid\.applyPageSize'\)"/);
  assert.doesNotMatch(source, /<Check class="h-3 w-3" \/>\s*\{\{ t\("grid\.applyPageSize"\) \}\}/);
});

test("editor settings dialog does not duplicate result page size controls", () => {
  const source = readFileSync("apps/desktop/src/components/editor/EditorSettingsDialog.vue", "utf8");

  assert.doesNotMatch(source, /editPageSize/);
  assert.doesNotMatch(source, /settings\.resultPageSize/);
  assert.doesNotMatch(source, /pageSize: normalizeResultPageSize/);
});
