import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const objectSourceEditorSource = readFileSync("apps/desktop/src/lib/objectSourceEditor.ts", "utf8");
const appSource = readFileSync("apps/desktop/src/App.vue", "utf8");
const objectBrowserSource = readFileSync("apps/desktop/src/components/objects/ObjectBrowser.vue", "utf8");
const treeItemSource = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");
const rustObjectSource = readFileSync("crates/dbx-core/src/object_source_sql.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend object source SQL builders", () => {
  assert.match(apiSource, /export const buildExecutableObjectSourceStatements = forward\("buildExecutableObjectSourceStatements"\)/);
  assert.match(apiSource, /export const buildRoutineRenameObjectSourceStatements = forward\("buildRoutineRenameObjectSourceStatements"\)/);
  assert.match(tauriSource, /invoke\("build_executable_object_source_statements"/);
  assert.match(tauriSource, /invoke\("build_routine_rename_object_source_statements"/);
  assert.match(httpSource, /\/api\/query\/build-executable-object-source-statements/);
  assert.match(httpSource, /\/api\/query\/build-routine-rename-object-source-statements/);
});

test("frontend object source editor delegates executable SQL generation to backend APIs", () => {
  assert.match(objectSourceEditorSource, /return api\.buildExecutableObjectSourceStatements\(input\)/);
  assert.match(objectSourceEditorSource, /return api\.buildRoutineRenameObjectSourceStatements\(input\)/);
  assert.doesNotMatch(objectSourceEditorSource, /function routineDeclaration/);
  assert.doesNotMatch(objectSourceEditorSource, /function replaceSqlRoutineDeclarationName/);
  assert.doesNotMatch(objectSourceEditorSource, /DROP .* IF EXISTS/);
  assert.match(appSource, /await buildExecutableObjectSourceStatements\(/);
  assert.match(objectBrowserSource, /await buildExecutableObjectSourceStatements\(/);
  assert.match(treeItemSource, /await buildRoutineRenameObjectSourceStatements\(/);
});

test("Rust backends register object source SQL builders", () => {
  assert.match(rustCoreLibSource, /pub mod object_source_sql/);
  assert.match(rustObjectSource, /pub fn build_executable_object_source_statements/);
  assert.match(rustObjectSource, /pub fn build_routine_rename_object_source_statements/);
  assert.match(tauriLibSource, /commands::query::build_executable_object_source_statements/);
  assert.match(tauriLibSource, /commands::query::build_routine_rename_object_source_statements/);
  assert.match(webMainSource, /\/query\/build-executable-object-source-statements/);
  assert.match(webMainSource, /\/query\/build-routine-rename-object-source-statements/);
});
