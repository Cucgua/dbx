import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/config/DriverStoreDialog.vue", "utf8");

test("driver store keeps the v0.5.12 grouped-list appearance", () => {
  assert.match(source, /max-w-4xl mx-auto px-6 py-6/);
  assert.match(source, /rounded-xl border bg-muted\/20 p-4/);
  assert.match(source, /rounded-md border divide-y/);
  assert.match(source, /flex items-center gap-3 px-4 py-2\.5 transition hover:bg-muted\/30/);
});

test("driver store only keeps oval button styling from the later appearance pass", () => {
  assert.match(source, /rounded-full/);
  for (const className of [
    "driver-store-page",
    "driver-store-panel",
    "driver-store-list",
    "driver-store-row",
    "driver-store-icon",
    "driver-store-badge",
    "driver-store-action-primary",
    "driver-store-action-secondary",
  ]) {
    assert.doesNotMatch(source, new RegExp(className));
  }
  assert.doesNotMatch(source, /<style scoped>/);
});
