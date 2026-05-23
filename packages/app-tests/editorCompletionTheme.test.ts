import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildEditorFontThemeRules,
  buildSqlCompletionThemeRules,
  EDITOR_FONT_FAMILY_CSS_VAR,
  EDITOR_FONT_SIZE_CSS_VAR,
} from "../../apps/desktop/src/lib/editorThemes.ts";

test("sql completion theme styles the autocomplete popup", () => {
  const rules = buildSqlCompletionThemeRules();

  assert.deepEqual(rules[".cm-tooltip.cm-tooltip-autocomplete"], {
    background: "var(--popover)",
    border: "1px solid color-mix(in oklch, var(--border) 82%, var(--foreground) 18%)",
    borderRadius: "8px",
    boxShadow: "0 8px 18px rgb(0 0 0 / 0.14)",
    color: "var(--popover-foreground)",
    fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, var(--font-mono, monospace))`,
    maxWidth: "min(520px, calc(100vw - 24px))",
    minWidth: "min(280px, calc(100vw - 24px))",
    overflow: "hidden",
    padding: "4px 0",
  });
  assert.deepEqual(rules[".cm-completionIcon"], {
    alignItems: "center",
    display: "inline-flex",
    flex: "0 0 15px",
    height: "15px",
    justifyContent: "center",
    marginRight: "0.65em",
    opacity: "1",
    overflow: "hidden",
    position: "relative",
    width: "15px",
  });
  assert.equal(rules[".cm-completionIcon:before"]?.backgroundColor, "currentColor");
  assert.equal(rules[".cm-completionIcon:before"]?.content, "''");
  assert.equal(rules[".cm-completionIcon:before"]?.WebkitMaskSize, "14px 14px");
  assert.equal(rules[".cm-completionIcon:after"]?.display, "none");
  assert.equal(rules[".cm-completionIcon-table"]?.color, "color-mix(in oklch, var(--primary) 92%, var(--popover-foreground))");
  assert.equal(rules[".cm-completionIcon-column"]?.color, "color-mix(in oklch, var(--blue-500, #3b82f6) 92%, var(--popover-foreground))");
  assert.equal(rules[".cm-completionIcon-keyword"]?.color, "color-mix(in oklch, var(--orange-500, #f97316) 92%, var(--popover-foreground))");
  assert.equal(rules[".cm-completionIcon-keyword"]?.["--dbx-completion-icon-mask"]?.includes("m16%2018%206-6-6-6"), true);
  assert.equal(rules[".cm-completionIcon-snippet"]?.color, "color-mix(in oklch, var(--emerald-500, #10b981) 92%, var(--popover-foreground))");
  assert.deepEqual(rules[".cm-completionLabel"], {
    color: "inherit",
    fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, var(--font-mono, monospace))`,
    fontSize: `clamp(12px, var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px), 14px)`,
    fontWeight: "520",
    letterSpacing: "0",
  });
  assert.equal(rules[".cm-completionMatchedText"]?.color, "oklch(0.62 0.19 255)");
  assert.equal(
    rules[".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]"]?.background,
    "color-mix(in oklch, var(--primary) 14%, var(--popover)) !important",
  );
});

test("query editor portals CodeMirror tooltips outside clipped editor panes", () => {
  const source = readFileSync("apps/desktop/src/components/editor/QueryEditor.vue", "utf8");

  assert.match(source, /tooltips/);
  assert.match(source, /tooltips\(\{\s*parent:\s*document\.body\s*\}\)/s);
});

test("editor font theme reads size and family from CSS variables", () => {
  const rules = buildEditorFontThemeRules({ fixedHeight: true, scrollable: true });

  assert.equal(rules["&"]?.height, "100%");
  assert.equal(rules["&"]?.fontSize, `var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px)`);
  assert.deepEqual(rules[".cm-content"], {
    fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, monospace)`,
  });
  assert.equal(rules[".cm-gutters"]?.fontSize, `var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px)`);
  assert.deepEqual(rules[".cm-scroller"], { overflow: "auto" });
});
