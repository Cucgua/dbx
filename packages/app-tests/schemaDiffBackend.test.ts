import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const schemaDiffDialogSource = readFileSync("apps/desktop/src/components/diff/SchemaDiffDialog.vue", "utf8");
const schemaDiffSource = readFileSync("apps/desktop/src/lib/schemaDiff.ts", "utf8");
const tauriCommandsSource = readFileSync("src-tauri/src/commands/mod.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webRoutesSource = readFileSync("crates/dbx-web/src/routes/mod.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");

test("shared API exposes backend schema diff preparation and SQL generation", () => {
  assert.match(apiSource, /export const prepareSchemaDiff = forward\("prepareSchemaDiff"\)/);
  assert.match(apiSource, /export const generateSchemaSyncSql = forward\("generateSchemaSyncSql"\)/);
  assert.match(tauriSource, /export async function prepareSchemaDiff\(/);
  assert.match(tauriSource, /invoke\("prepare_schema_diff"/);
  assert.match(tauriSource, /export async function generateSchemaSyncSql\(/);
  assert.match(tauriSource, /invoke\("generate_schema_sync_sql"/);
  assert.match(httpSource, /export async function prepareSchemaDiff\(/);
  assert.match(httpSource, /\/api\/schema-diff\/prepare/);
  assert.match(httpSource, /export async function generateSchemaSyncSql\(/);
  assert.match(httpSource, /\/api\/schema-diff\/generate-sync-sql/);
});

test("schema diff dialog delegates diff and SQL generation to backend APIs", () => {
  assert.match(schemaDiffDialogSource, /await api\.prepareSchemaDiff\(/);
  assert.match(schemaDiffDialogSource, /await api\.generateSchemaSyncSql\(/);
  assert.doesNotMatch(schemaDiffDialogSource, /diffColumns\(/);
  assert.doesNotMatch(schemaDiffDialogSource, /diffIndexes\(/);
  assert.doesNotMatch(schemaDiffDialogSource, /diffForeignKeys\(/);
  assert.doesNotMatch(schemaDiffDialogSource, /diffTriggers\(/);
  assert.doesNotMatch(schemaDiffDialogSource, /generateSyncSql\(/);
});

test("frontend schema diff module no longer owns executable diff logic", () => {
  assert.doesNotMatch(schemaDiffSource, /export function diffColumns/);
  assert.doesNotMatch(schemaDiffSource, /export function generateSyncSql/);
});

test("Rust backends register schema diff APIs", () => {
  assert.match(rustCoreLibSource, /pub mod schema_diff/);
  assert.match(tauriCommandsSource, /pub mod schema_diff/);
  assert.match(tauriLibSource, /commands::schema_diff::prepare_schema_diff/);
  assert.match(tauriLibSource, /commands::schema_diff::generate_schema_sync_sql/);
  assert.match(webRoutesSource, /pub mod schema_diff/);
  assert.match(webMainSource, /\/schema-diff\/prepare/);
  assert.match(webMainSource, /\/schema-diff\/generate-sync-sql/);
});
