import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const searchSource = readFileSync("apps/desktop/src/lib/databaseSearch.ts", "utf8");
const dialogSource = readFileSync("apps/desktop/src/components/search/DatabaseSearchDialog.vue", "utf8");
const rustSearchSource = readFileSync("crates/dbx-core/src/database_search_sql.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend database search SQL builders", () => {
  assert.match(apiSource, /export const buildDatabaseSearchSql = forward\("buildDatabaseSearchSql"\)/);
  assert.match(apiSource, /export const buildSearchResultWhere = forward\("buildSearchResultWhere"\)/);
  assert.match(tauriSource, /invoke\("build_database_search_sql"/);
  assert.match(tauriSource, /invoke\("build_search_result_where"/);
  assert.match(httpSource, /\/api\/query\/build-database-search-sql/);
  assert.match(httpSource, /\/api\/query\/build-search-result-where/);
});

test("database search frontend delegates executable SQL generation to backend APIs", () => {
  assert.match(searchSource, /return api\.buildDatabaseSearchSql\(options\)/);
  assert.match(searchSource, /return api\.buildSearchResultWhere\(options\)/);
  assert.match(dialogSource, /await buildDatabaseSearchSql\(/);
  assert.match(dialogSource, /await buildSearchResultWhere\(/);
  assert.doesNotMatch(searchSource, /function textCastExpression/);
  assert.doesNotMatch(searchSource, /function sqlValueLiteral/);
  assert.doesNotMatch(searchSource, /SELECT \* FROM/);
});

test("Rust backends register database search SQL builders", () => {
  assert.match(rustCoreLibSource, /pub mod database_search_sql/);
  assert.match(rustSearchSource, /pub fn build_database_search_sql/);
  assert.match(rustSearchSource, /pub fn build_search_result_where/);
  assert.match(tauriLibSource, /commands::query::build_database_search_sql/);
  assert.match(tauriLibSource, /commands::query::build_search_result_where/);
  assert.match(webMainSource, /\/query\/build-database-search-sql/);
  assert.match(webMainSource, /\/query\/build-search-result-where/);
});
