import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/editor/QueryEditor.vue", "utf8");

test("SQL editor handles focus-search shortcut with its custom search overlay", () => {
  assert.match(
    source,
    /key:\s*shortcutToCodeMirrorKey\(shortcuts\.focusSearch\)[\s\S]*?run:\s*\(\)\s*=>\s*openSearch\(\)/,
  );
});

test("SQL editor search shortcut keymap has higher priority than CodeMirror basicSetup search", () => {
  assert.match(source, /runKeymapComp\.of\(Prec\.highest\(runKeymapExtension\(keymap\)\)\)/);
  assert.match(source, /runKeymapComp\.reconfigure\(editorPrec\.highest\(runKeymapExtension\(editorViewModule\.keymap\)\)\)/);
});
