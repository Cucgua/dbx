import { strict as assert } from "node:assert";
import test from "node:test";
import { buildSqlCompletionThemeRules } from "../../apps/desktop/src/lib/editorThemes.ts";

test("sql completion theme styles the autocomplete popup", () => {
  const rules = buildSqlCompletionThemeRules();

  assert.ok(rules[".cm-tooltip.cm-tooltip-autocomplete"]);
  assert.deepEqual(rules[".cm-completionIcon"], {
    display: "none !important",
    height: "0",
    margin: "0",
    paddingRight: "0 !important",
    width: "0",
  });
  assert.deepEqual(rules[".cm-completionLabel"], {
    color: "inherit",
    fontFamily: "var(--font-mono, 'JetBrains Mono', 'SF Mono', monospace)",
    fontSize: "16px",
    fontWeight: "760",
    letterSpacing: "0",
  });
  assert.equal(rules[".cm-completionMatchedText"]?.color, "#5794f9");
  assert.equal(
    rules[".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]"]?.background,
    "rgba(70, 75, 84, 0.86) !important",
  );
});
