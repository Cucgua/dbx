import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/editor/QueryEditor.vue", "utf8");

test("query editor reconfigures autocompletion when snippets change", () => {
  assert.match(source, /let completionComp: import\("@codemirror\/state"\)\.Compartment \| null = null;/);
  assert.match(
    source,
    /let buildSqlCompletionExtension: \(\(\) => import\("@codemirror\/state"\)\.Extension\) \| null = null;/,
  );
  assert.match(source, /completionComp = new Compartment\(\);/);
  assert.match(source, /completionComp\.of\(buildSqlCompletionExtension\(\)\)/);
  assert.match(source, /\(\) => settingsStore\.editorSettings\.snippets/);
  assert.match(source, /completionComp\.reconfigure\(buildSqlCompletionExtension\(\)\)/);
  assert.match(source, /codeMirrorStartCompletion\?\.\(view\.value\)/);
});

test("query editor disables CodeMirror label re-filtering for custom SQL completions", () => {
  assert.match(source, /from: position - completionContext\.prefix\.length,\s*filter: false,\s*options:/s);
});
