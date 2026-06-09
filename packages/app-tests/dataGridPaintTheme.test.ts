import { strict as assert } from "node:assert";
import { test } from "vitest";
import { resolveDataGridPaintTheme } from "../../apps/desktop/src/lib/dataGridPaintTheme.ts";

test("canvas grid paint theme falls back from advanced CSS colors", () => {
  const vars = new Map([
    ["--background", "oklch(1 0 0)"],
    ["--foreground", "oklch(0.145 0 0)"],
    ["--primary", "oklch(0.205 0 0)"],
    ["--border", "oklch(0.922 0 0)"],
    ["--data-grid-cell-selected-bg", "color-mix(in oklab, var(--primary) 25%, transparent)"],
    ["--data-grid-row-number-selected-bg", "color-mix(in oklab, var(--primary) 25%, var(--background))"],
  ]);

  const theme = resolveDataGridPaintTheme({
    getVar: (name) => vars.get(name) ?? "",
    isDark: false,
  });

  assert.equal(theme.background, "rgb(255, 255, 255)");
  assert.equal(theme.foreground, "rgb(10, 10, 10)");
  assert.equal(theme.border, "rgb(229, 231, 235)");
  assert.equal(theme.primary, "rgb(23, 23, 23)");
  assert.equal(theme.cellSelected, "rgb(226, 226, 226)");
  assert.equal(theme.rowNumberSelected, "rgb(226, 226, 226)");
});

test("canvas grid paint theme converts rgb color-mix tokens to rgba", () => {
  const vars = new Map([
    ["--primary", "rgb(23 23 23)"],
    ["--background", "rgb(255 255 255)"],
    ["--data-grid-cell-selected-bg", "color-mix(in oklab, var(--primary) 25%, transparent)"],
    ["--data-grid-row-number-selected-bg", "color-mix(in oklab, var(--primary) 25%, var(--background))"],
  ]);

  const theme = resolveDataGridPaintTheme({
    getVar: (name) => vars.get(name) ?? "",
    isDark: false,
  });

  assert.equal(theme.cellSelected, "rgba(23, 23, 23, 0.25)");
  assert.equal(theme.rowNumberSelected, "rgb(197, 197, 197)");
});
