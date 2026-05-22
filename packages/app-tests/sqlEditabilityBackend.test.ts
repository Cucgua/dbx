import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const queryStoreSource = readFileSync("apps/desktop/src/stores/queryStore.ts", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustCoreLibSource = readFileSync("crates/dbx-core/src/lib.rs", "utf8");

test("shared API exposes backend SQL editability analysis", () => {
  assert.match(apiSource, /export const analyzeEditableQueryEditability = forward\("analyzeEditableQueryEditability"\)/);
  assert.match(tauriSource, /export async function analyzeEditableQueryEditability\(/);
  assert.match(tauriSource, /invoke\("analyze_editable_query_editability"/);
  assert.match(httpSource, /export async function analyzeEditableQueryEditability\(/);
  assert.match(httpSource, /\/api\/query\/analyze-editability/);
});

test("query metadata analysis uses backend SQL editability analysis", () => {
  assert.match(queryStoreSource, /await api\.analyzeEditableQueryEditability\(sql\)/);
  assert.doesNotMatch(queryStoreSource, /analyzeEditableQueryEditability,\n\s+sourceColumnsForResult/);
});

test("Rust backends register SQL editability analysis", () => {
  assert.match(rustCoreLibSource, /pub mod sql_editability/);
  assert.match(tauriLibSource, /commands::query::analyze_editable_query_editability/);
  assert.match(webMainSource, /\/query\/analyze-editability/);
});
