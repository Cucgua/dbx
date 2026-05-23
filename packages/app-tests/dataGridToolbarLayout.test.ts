import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

test("data grid toolbar keeps a minimum content width", () => {
  assert.match(source, /class="data-grid-topbar-scroll shrink-0 overflow-x-auto/);
  assert.match(source, /class="data-grid-topbar flex items-stretch/);
  assert.match(source, /\.data-grid-topbar\s*\{\s*min-width: 760px;/s);
  assert.match(source, /\.data-grid-topbar-scroll\s*\{\s*scrollbar-width: thin;/s);
});

test("data grid toolbar suggestions render outside the scroll container", () => {
  assert.match(source, /<Teleport to="body">/);
  assert.match(source, /class="fixed z-50 min-w-\[180px\] rounded-md border bg-popover/);
  assert.match(source, /:style="whereSuggestionStyle"/);
  assert.match(source, /:style="orderBySuggestionStyle"/);
});
