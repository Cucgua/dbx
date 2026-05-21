import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("toolbar theme and language menus use shadcn tooltip without nesting trigger primitives", () => {
  const source = readFileSync("apps/desktop/src/components/layout/AppToolbar.vue", "utf8");

  assert.match(
    source,
    /<Tooltip>\s*<TooltipTrigger as-child>\s*<span class="inline-flex">\s*<DropdownMenu>\s*<DropdownMenuTrigger as-child>\s*<Button[\s\S]*?<\/Button>\s*<\/DropdownMenuTrigger>\s*<DropdownMenuContent align="end">[\s\S]*?<\/DropdownMenuContent>\s*<\/DropdownMenu>\s*<\/span>\s*<\/TooltipTrigger>\s*<TooltipContent>{{ t\("toolbar\.theme"\) }}<\/TooltipContent>\s*<\/Tooltip>/,
  );
  assert.match(
    source,
    /<Tooltip>\s*<TooltipTrigger as-child>\s*<span class="inline-flex">\s*<DropdownMenu>\s*<DropdownMenuTrigger as-child>\s*<Button[\s\S]*?<\/Button>\s*<\/DropdownMenuTrigger>\s*<DropdownMenuContent align="end">[\s\S]*?<\/DropdownMenuContent>\s*<\/DropdownMenu>\s*<\/span>\s*<\/TooltipTrigger>\s*<TooltipContent>{{ t\("common\.language"\) }}<\/TooltipContent>\s*<\/Tooltip>/,
  );
  assert.doesNotMatch(
    source,
    /<DropdownMenu>\s*<Tooltip>\s*<TooltipTrigger as-child>\s*<DropdownMenuTrigger as-child>/,
  );
  assert.doesNotMatch(source, /group\/toolbar-tip/);
  assert.doesNotMatch(source, /group-hover\/toolbar-tip/);
});
