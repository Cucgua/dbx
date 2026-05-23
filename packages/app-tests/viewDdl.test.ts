import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const viewDdlSource = readFileSync("apps/desktop/src/lib/viewDdl.ts", "utf8");
const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustSource = readFileSync("crates/dbx-core/src/object_source_sql.rs", "utf8");

test("frontend view DDL helper delegates executable DDL generation to backend API", () => {
  assert.match(viewDdlSource, /return api\.buildViewDdlSql\(input\)/);
  assert.doesNotMatch(viewDdlSource, /CREATE OR REPLACE VIEW|CREATE VIEW|ensureSemicolon|quotePostgresIdentifier/);
});

test("sidebar view context menu exposes a separate DDL action", () => {
  const source = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");

  assert.match(source, /function viewObjectDdl/);
  assert.match(source, /await buildViewDdl\(/);
  assert.match(source, /contextMenu\.viewDdl/);
});

test("object browser view context menu exposes a separate DDL action", () => {
  const source = readFileSync("apps/desktop/src/components/objects/ObjectBrowser.vue", "utf8");

  assert.match(source, /function openViewDdl/);
  assert.match(source, /await buildViewDdl\(/);
  assert.match(source, /contextMenu\.viewDdl/);
});

test("shared API exposes backend view DDL builder", () => {
  assert.match(apiSource, /export const buildViewDdlSql = forward\("buildViewDdlSql"\)/);
  assert.match(tauriSource, /invoke\("build_view_ddl_sql"/);
  assert.match(httpSource, /\/api\/query\/build-view-ddl-sql/);
  assert.match(tauriLibSource, /commands::query::build_view_ddl_sql/);
  assert.match(webMainSource, /\/query\/build-view-ddl-sql/);
});

test("Rust object source SQL exposes view DDL builder", () => {
  assert.match(rustSource, /pub struct BuildViewDdlInput/);
  assert.match(rustSource, /pub fn build_view_ddl_sql/);
  assert.match(rustSource, /CREATE OR REPLACE VIEW/);
});
