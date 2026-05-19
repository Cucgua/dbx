import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/connection/ConnectionDialog.vue", "utf8");

test("Oracle connection mode uses an inline option group", () => {
  const oracleModeBlock = source.match(
    /<div v-if="form\.db_type === 'oracle'"[^>]*>\s*<Label[^>]*>连接方式<\/Label>[\s\S]*?<\/div>/,
  )?.[0];

  assert.ok(oracleModeBlock, "expected Oracle connection mode block");
  assert.match(oracleModeBlock, /type="button"/);
  assert.match(oracleModeBlock, /form\.oracle_connection_type = 'service_name'/);
  assert.match(oracleModeBlock, /form\.oracle_connection_type = 'sid'/);
  assert.doesNotMatch(oracleModeBlock, /<Select/);
});
