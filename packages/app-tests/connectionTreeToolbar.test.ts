import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connectionTreeSource = readFileSync(
  new URL("../../apps/desktop/src/components/sidebar/ConnectionTree.vue", import.meta.url),
  "utf8",
);

test("connection tree toolbar is visible before any connection exists", () => {
  assert.ok(connectionTreeSource.includes(":title=\"t('connectionGroup.createGroup')\""));
  assert.ok(
    !connectionTreeSource.includes('v-if="store.treeNodes.length > 0" class="sticky'),
    "the toolbar should not be hidden when the connection tree is empty",
  );
});
