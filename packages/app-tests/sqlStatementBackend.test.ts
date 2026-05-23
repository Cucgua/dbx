import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const executionTargetSource = readFileSync("apps/desktop/src/lib/sqlExecutionTarget.ts", "utf8");
const sqlSource = readFileSync("crates/dbx-core/src/sql.rs", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");

test("shared API exposes backend current statement resolution", () => {
  assert.match(apiSource, /export const findStatementAtCursor = forward\("findStatementAtCursor"\)/);
  assert.match(tauriSource, /export async function findStatementAtCursor\(/);
  assert.match(tauriSource, /invoke\("find_statement_at_cursor"/);
  assert.match(httpSource, /export async function findStatementAtCursor\(/);
  assert.match(httpSource, /\/api\/query\/find-statement-at-cursor/);
});

test("execution target prefers backend current statement resolution", () => {
  assert.match(executionTargetSource, /api\.findStatementAtCursor\(fullSql, options\.cursorPos\)/);
  assert.doesNotMatch(executionTargetSource, /sqlStatementSplit/);
  assert.doesNotMatch(executionTargetSource, /return findStatementAtCursor\(fullSql, options\.cursorPos\)/);
});

test("Rust backends register current statement resolution", () => {
  assert.match(sqlSource, /pub fn find_statement_at_cursor/);
  assert.match(tauriLibSource, /commands::query::find_statement_at_cursor/);
  assert.match(webMainSource, /\/query\/find-statement-at-cursor/);
});
