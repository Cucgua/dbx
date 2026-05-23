import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("tab bar exposes a data-table-only dropdown switcher", () => {
  const source = readFileSync("apps/desktop/src/components/layout/AppTabBar.vue", "utf8");

  assert.match(source, /tab\.mode === "data"/);
  assert.match(
    source,
    /showPinnedDataTabsMenu = computed\(\s*\(\) => dataTabs\.value\.length > 0 && \(canScrollLeft\.value \|\| canScrollRight\.value\),?\s*\)/,
  );
  assert.match(source, /const dataTabsMenuContainerClass = computed\(\(\) =>/);
  assert.match(source, /<div v-if="showPinnedDataTabsMenu" :class="dataTabsMenuContainerClass">/);
  assert.match(source, /t\(['"]tabs\.openDataTabs['"]\)/);
  assert.match(source, /DropdownMenuContent align="end" class="w-auto min-w-36 max-w-60"/);
  assert.match(source, /ChevronDown class="h-4 w-4"/);
  assert.match(source, /<Table2 class="w-3\.5 h-3\.5 mr-2 shrink-0 text-emerald-600 dark:text-emerald-400" \/>/);
  assert.match(source, /@click="activateDataTab\(tab\.id\)"/);
});
