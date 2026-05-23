import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const switchSource = readFileSync("apps/desktop/src/components/ui/switch/Switch.vue", "utf8");

test("Switch styling follows Reka UI data-state attributes", () => {
  assert.doesNotMatch(switchSource, /data-checked/);
  assert.doesNotMatch(switchSource, /data-unchecked/);
  assert.match(switchSource, /data-\[state=checked\]:bg-primary/);
  assert.match(switchSource, /data-\[state=unchecked\]:bg-input/);
  assert.match(switchSource, /group-data-\[state=checked\]\/switch:translate-x-\[calc\(100%-2px\)\]/);
  assert.match(switchSource, /group-data-\[state=unchecked\]\/switch:translate-x-0/);
});
