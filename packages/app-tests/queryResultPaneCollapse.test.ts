import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/layout/ContentArea.vue", "utf8");

test("query result pane is hidden by default and can be reopened after output exists", () => {
  assert.match(source, /const resultsPaneOpen = ref\(false\)/);
  assert.match(source, /const hasQueryOutput = computed\(/);
  assert.match(source, /watch\(\s*hasQueryOutput,[\s\S]*?resultsPaneOpen\.value = true/);
  assert.match(source, /<Pane[\s\S]*:size="resultsPaneOpen \? 40 : 100"[\s\S]*>/);
  assert.match(source, /<Pane v-if="resultsPaneOpen"[\s\S]*:size="60"[\s\S]*>/);
  assert.match(source, /resultsPaneOpen = false/);
  assert.match(source, /v-if="hasQueryOutput && !resultsPaneOpen"/);
  assert.match(source, /resultsPaneOpen = true/);
});
