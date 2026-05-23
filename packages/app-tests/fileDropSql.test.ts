import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const fileDropSource = readFileSync("apps/desktop/src/composables/useFileDrop.ts", "utf8");
const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustSource = readFileSync("crates/dbx-core/src/query_execution_sql.rs", "utf8");

test("file drop data preview delegates executable DuckDB SQL generation to backend API", () => {
  assert.match(fileDropSource, /return api\.buildDroppedFilePreviewSql\(\{ path \}\)/);
  assert.match(fileDropSource, /const dataQuery = await getDataFileQuery\(path\)/);
  assert.doesNotMatch(fileDropSource, /read_parquet|read_csv|read_json|SELECT \* FROM/);
});

test("shared API exposes backend dropped file preview SQL builder", () => {
  assert.match(apiSource, /export const buildDroppedFilePreviewSql = forward\("buildDroppedFilePreviewSql"\)/);
  assert.match(tauriSource, /invoke<string \| null>\("build_dropped_file_preview_sql"/);
  assert.match(httpSource, /\/api\/query\/build-dropped-file-preview-sql/);
  assert.match(tauriLibSource, /commands::query::build_dropped_file_preview_sql/);
  assert.match(webMainSource, /\/query\/build-dropped-file-preview-sql/);
});

test("Rust query execution SQL exposes dropped file preview builder", () => {
  assert.match(rustSource, /pub fn build_dropped_file_preview_sql/);
  assert.match(rustSource, /read_parquet/);
  assert.match(rustSource, /read_csv/);
  assert.match(rustSource, /read_json/);
});
