import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

test("data grid wires copy and delete row shortcuts", () => {
  assert.match(source, /isCopyCurrentRowShortcut/);
  assert.match(source, /isDeleteCurrentRowShortcut/);
  assert.match(source, /copyCurrentRow\(\)/);
  assert.match(source, /deleteCurrentRow\(\)/);
});
