import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

test("data grid does not memoize virtual rows", () => {
  assert.doesNotMatch(source, /v-memo=/);
  assert.doesNotMatch(source, /function rowRenderMemoDeps/);
  assert.match(source, /\{\{ item\.displayIndex \+ 1 \}\}/);
});
