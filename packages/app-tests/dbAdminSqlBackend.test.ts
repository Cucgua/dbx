import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const objectRenameSource = readFileSync("apps/desktop/src/lib/objectRenameSql.ts", "utf8");
const createDatabaseSource = readFileSync("apps/desktop/src/lib/createDatabaseSql.ts", "utf8");
const dbAdminSource = readFileSync("apps/desktop/src/lib/dbAdminSql.ts", "utf8");
const objectBrowserSource = readFileSync("apps/desktop/src/components/objects/ObjectBrowser.vue", "utf8");
const treeItemSource = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");
const rustAdminSource = readFileSync("crates/dbx-core/src/db_admin_sql.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend admin SQL builders", () => {
  assert.match(apiSource, /export const buildRenameObjectSql = forward\("buildRenameObjectSql"\)/);
  assert.match(apiSource, /export const buildCreateDatabaseSql = forward\("buildCreateDatabaseSql"\)/);
  assert.match(apiSource, /export const buildDuckDbAttachDatabaseSql = forward\("buildDuckDbAttachDatabaseSql"\)/);
  assert.match(apiSource, /export const buildDropObjectSql = forward\("buildDropObjectSql"\)/);
  assert.match(apiSource, /export const buildDuplicateTableStructureSql = forward\("buildDuplicateTableStructureSql"\)/);
  assert.match(tauriSource, /invoke\("build_rename_object_sql"/);
  assert.match(tauriSource, /invoke\("build_create_database_sql"/);
  assert.match(tauriSource, /invoke\("build_duckdb_attach_database_sql"/);
  assert.match(tauriSource, /invoke\("build_drop_object_sql"/);
  assert.match(tauriSource, /invoke\("build_duplicate_table_structure_sql"/);
  assert.match(httpSource, /\/api\/query\/build-rename-object-sql/);
  assert.match(httpSource, /\/api\/query\/build-create-database-sql/);
  assert.match(httpSource, /\/api\/query\/build-duckdb-attach-database-sql/);
  assert.match(httpSource, /\/api\/query\/build-drop-object-sql/);
  assert.match(httpSource, /\/api\/query\/build-duplicate-table-structure-sql/);
});

test("frontend admin SQL helpers delegate executable SQL generation to backend APIs", () => {
  assert.match(objectRenameSource, /return api\.buildRenameObjectSql\(options\)/);
  assert.match(createDatabaseSource, /return api\.buildCreateDatabaseSql\(options\)/);
  assert.match(createDatabaseSource, /return api\.buildDuckDbAttachDatabaseSql\(path, name\)/);
  assert.match(dbAdminSource, /return api\.buildDropObjectSql\(options\)/);
  assert.match(dbAdminSource, /return api\.buildDuplicateTableStructureSql\(options\)/);
  assert.doesNotMatch(objectRenameSource, /EXEC sp_rename/);
  assert.doesNotMatch(objectRenameSource, /RENAME TABLE/);
  assert.doesNotMatch(createDatabaseSource, /CREATE DATABASE/);
  assert.doesNotMatch(createDatabaseSource, /ATTACH .* AS/);
  assert.doesNotMatch(dbAdminSource, /DROP |TRUNCATE |DELETE FROM|CREATE TABLE|CREATE SCHEMA/);
});

test("admin SQL callers await backend builders and keep async previews out of templates", () => {
  assert.match(treeItemSource, /const sql = await buildRenameObjectSql\(/);
  assert.match(treeItemSource, /await buildDuckDbAttachDatabaseSql\(/);
  assert.match(treeItemSource, /const sql = await buildCreateDatabaseSql\(/);
  assert.match(treeItemSource, /await buildDuplicateTableStructureSql\(/);
  assert.match(treeItemSource, /dropTablePreviewSql/);
  assert.match(treeItemSource, /renameObjectPreviewSql/);
  assert.doesNotMatch(treeItemSource, /buildRenameObjectPreviewSql\(\)/);
  assert.doesNotMatch(treeItemSource, /CREATE TABLE .*LIKE|TRUNCATE TABLE|DROP SCHEMA|DROP DATABASE|CREATE SCHEMA/);
  assert.match(objectBrowserSource, /const sql = await buildRenameObjectSql\(/);
  assert.match(objectBrowserSource, /await buildDuplicateTableStructureSql\(/);
  assert.match(objectBrowserSource, /truncatePreviewSql/);
  assert.match(objectBrowserSource, /renamePreviewSqlText/);
  assert.doesNotMatch(objectBrowserSource, /renamePreviewSql\(\)/);
  assert.doesNotMatch(objectBrowserSource, /CREATE TABLE .*LIKE|TRUNCATE TABLE|DELETE FROM \$|DROP \$/);
});

test("Rust backends register admin SQL builders", () => {
  assert.match(rustCoreLibSource, /pub mod db_admin_sql/);
  assert.match(rustAdminSource, /pub fn build_rename_object_sql/);
  assert.match(rustAdminSource, /pub fn build_create_database_sql/);
  assert.match(rustAdminSource, /pub fn build_duckdb_attach_database_sql/);
  assert.match(rustAdminSource, /pub fn build_drop_object_sql/);
  assert.match(rustAdminSource, /pub fn build_duplicate_table_structure_sql/);
  assert.match(tauriLibSource, /commands::query::build_rename_object_sql/);
  assert.match(tauriLibSource, /commands::query::build_create_database_sql/);
  assert.match(tauriLibSource, /commands::query::build_duckdb_attach_database_sql/);
  assert.match(tauriLibSource, /commands::query::build_drop_object_sql/);
  assert.match(tauriLibSource, /commands::query::build_duplicate_table_structure_sql/);
  assert.match(webMainSource, /\/query\/build-rename-object-sql/);
  assert.match(webMainSource, /\/query\/build-create-database-sql/);
  assert.match(webMainSource, /\/query\/build-duckdb-attach-database-sql/);
  assert.match(webMainSource, /\/query\/build-drop-object-sql/);
  assert.match(webMainSource, /\/query\/build-duplicate-table-structure-sql/);
});
