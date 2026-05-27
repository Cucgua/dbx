import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const queryStoreSource = readFileSync("apps/desktop/src/stores/queryStore.ts", "utf8");
const dataGridActionsSource = readFileSync("apps/desktop/src/composables/useDataGridActions.ts", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");
const rustQueryResultSqlSource = readFileSync("crates/dbx-core/src/query_result_sql.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend query result SQL builders", () => {
  assert.match(
    apiSource,
    /export const prepareQueryPaginationExecutionPlan = forward\("prepareQueryPaginationExecutionPlan"\)/,
  );
  assert.match(apiSource, /export const buildSortedQuerySql = forward\("buildSortedQuerySql"\)/);

  assert.match(tauriSource, /invoke\("prepare_query_pagination_execution_plan"/);
  assert.match(tauriSource, /invoke\("build_sorted_query_sql"/);

  assert.match(httpSource, /\/api\/query\/prepare-pagination-plan/);
  assert.match(httpSource, /\/api\/query\/build-sorted-sql/);
});

test("frontend query result pagination and sorting delegate to backend APIs", () => {
  assert.match(queryStoreSource, /await api\.prepareQueryPaginationExecutionPlan\(/);
  assert.match(dataGridActionsSource, /await api\.buildSortedQuerySql\(/);

  assert.doesNotMatch(queryStoreSource, /queryResultPagination/);
  assert.doesNotMatch(dataGridActionsSource, /queryResultSort/);
});

test("Rust backends register query result SQL builders", () => {
  assert.match(rustCoreLibSource, /pub mod query_result_sql/);
  assert.match(rustQueryResultSqlSource, /pub fn build_query_pagination_execution_plan/);
  assert.match(rustQueryResultSqlSource, /pub fn build_sorted_query_sql/);
  assert.match(tauriLibSource, /commands::query::prepare_query_pagination_execution_plan/);
  assert.match(tauriLibSource, /commands::query::build_sorted_query_sql/);
  assert.match(webMainSource, /\/query\/prepare-pagination-plan/);
  assert.match(webMainSource, /\/query\/build-sorted-sql/);
});

test("SQL Server pagination keeps user-provided TOP clauses", () => {
  assert.match(rustQueryResultSqlSource, /fn add_sql_server_top/);
  assert.match(rustQueryResultSqlSource, /if has_top_level_select_top\(sql\)/);
  assert.match(rustQueryResultSqlSource, /SELECT TOP 1000 \* FROM TicketInfo/);
});
