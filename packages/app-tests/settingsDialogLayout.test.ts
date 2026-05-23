import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/editor/EditorSettingsDialog.vue", "utf8");
const shortcutSource = readFileSync("apps/desktop/src/lib/shortcutRegistry.ts", "utf8");

test("settings dialog uses a side category navigation", () => {
  assert.match(source, /settingsCategoryNav/);
  assert.match(source, /settingsCategoryButton/);
});

test("Redis scan size lives in its own settings category", () => {
  const redisTab = source.indexOf('value: "redis"');
  const redisContent = source.search(/activeSettingsTab === ['"]redis['"]/);
  const redisScanSetting = source.indexOf('t("settings.redisScanPageSize")');
  const editorContent = source.search(/activeSettingsTab === ['"]editor['"]/);

  assert.ok(redisTab > -1);
  assert.ok(redisContent > -1);
  assert.ok(redisScanSetting > redisContent);
  assert.ok(redisScanSetting > editorContent);
});

test("settings action footer stays at the bottom of the content pane", () => {
  const footerTags = source.match(/<DialogFooter[^>]*class="[^"]*"[^>]*>/g) || [];

  assert.match(source, /class="[^"]*overflow-hidden[^"]*flex-col[^"]*"/);
  assert.match(source, /class="[^"]*overflow-y-auto[^"]*"/);
  assert.match(source, /<DialogFooter[\s\S]*class="[^"]*shrink-0[^"]*"/);
  assert.match(source, /<DialogFooter[\s\S]*class="[^"]*bg-transparent[^"]*"/);
  assert.ok(footerTags.length > 0);
  for (const footerTag of footerTags) {
    assert.doesNotMatch(footerTag, /sticky/);
    assert.doesNotMatch(footerTag, /bg-background/);
  }
});

test("settings dialog has a shortcuts category", () => {
  assert.match(source, /value: "shortcuts"/);
  assert.match(source, /activeSettingsTab === ['"]shortcuts['"]/);
  assert.match(source, /SHORTCUT_DEFINITIONS/);
  assert.match(shortcutSource, /settings\.shortcutToggleTranspose/);
  assert.match(shortcutSource, /settings\.shortcutCopyCurrentRow/);
  assert.match(shortcutSource, /settings\.shortcutDeleteCurrentRow/);
});

test("settings editor theme preview can follow app appearance", () => {
  assert.match(source, /useTheme/);
  assert.match(source, /appAppearance: isDark\.value \? "dark" : "light"/);
  assert.match(source, /loadEditorTheme\(ss\.theme, ss\.appAppearance\)/);
});

test("shortcut settings capture custom keydown input instead of fixed select options", () => {
  assert.match(source, /onShortcutKeydown/);
  assert.match(source, /@keydown="\(event: KeyboardEvent\) => onShortcutKeydown/);
  assert.doesNotMatch(source, /definition\.options/);
});

test("shortcut conflicts only block applying changed shortcut settings", () => {
  assert.match(source, /const shortcutsChanged = computed/);
  assert.match(source, /const hasBlockingShortcutConflicts = computed/);
  assert.match(source, /shortcutsChanged\.value && hasShortcutConflicts\.value/);
  assert.match(source, /if \(hasBlockingShortcutConflicts\.value\) return/);
  assert.match(source, /:disabled="!hasChanges\(\) \|\| hasBlockingShortcutConflicts"/);
});

test("settings dialog exposes sidebar activation in navigation settings", () => {
  assert.match(source, /value: "navigation"/);
  assert.match(source, /activeSettingsTab === ['"]navigation['"]/);
  assert.match(source, /settings\.sidebarActivation/);
  assert.match(source, /settings\.autoSelectActiveSidebarNode/);
  assert.match(source, /editAutoSelectActiveSidebarNode/);
  assert.match(source, /<Switch id="auto-select-active-sidebar-node" v-model="editAutoSelectActiveSidebarNode"/);
  assert.match(source, /<Switch id="editor-word-wrap" v-model="editWordWrap"/);
  assert.doesNotMatch(source, /v-model:checked/);
  assert.match(source, /settings\.sidebarHiddenTablePrefixes/);
  assert.match(source, /editSidebarHiddenTablePrefixes/);
  assert.match(source, /focus-visible:ring-inset/);
});

test("AI settings can browse provider model names while keeping manual input", () => {
  assert.match(source, /aiListModels/);
  assert.match(source, /<SearchableSelect[\s\S]*:options="aiModelOptionIds"/);
  assert.match(source, /v-model="aiEditModel"/);
  assert.match(source, /aiRefreshModels/);
});

test("settings switches bind through the Switch modelValue contract", () => {
  assert.doesNotMatch(source, /v-model:checked="editWordWrap"/);
  assert.doesNotMatch(source, /v-model:checked="editMcpHttpEnabled"/);
  assert.match(source, /<Switch id="editor-word-wrap" v-model="editWordWrap"/);
  assert.match(source, /<Switch id="mcp-http-enabled" v-model="editMcpHttpEnabled"/);
});
