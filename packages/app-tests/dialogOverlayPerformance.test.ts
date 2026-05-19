import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

test("dialog overlays scope backdrop filters to the open state", () => {
  const overlaySource = readFileSync("apps/desktop/src/components/ui/dialog/DialogOverlay.vue", "utf8");
  const scrollContentSource = readFileSync("apps/desktop/src/components/ui/dialog/DialogScrollContent.vue", "utf8");

  assert.match(overlaySource, /data-open:supports-backdrop-filter:backdrop-blur-xs/);
  assert.match(scrollContentSource, /data-\[state=open\]:supports-backdrop-filter:backdrop-blur-xs/);
  assert.doesNotMatch(overlaySource, /\sbg-black\/10 duration-100 supports-backdrop-filter:backdrop-blur-xs/);
  assert.doesNotMatch(scrollContentSource, /\sbg-black\/10 supports-backdrop-filter:backdrop-blur-xs/);
});
