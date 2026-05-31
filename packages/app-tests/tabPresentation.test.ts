import { strict as assert } from "node:assert";
import test from "node:test";
import { shouldShowTabOverflowControls } from "../../apps/desktop/src/lib/tabPresentation.ts";

test("tab overflow controls only show when there are hidden tabs to reach", () => {
  assert.equal(shouldShowTabOverflowControls(0, true, true, true), false);
  assert.equal(shouldShowTabOverflowControls(3, false, false, false), false);
  assert.equal(shouldShowTabOverflowControls(3, true, false, false), true);
  assert.equal(shouldShowTabOverflowControls(3, false, true, false), true);
  assert.equal(shouldShowTabOverflowControls(3, false, false, true), true);
});
