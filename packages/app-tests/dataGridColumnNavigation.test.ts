import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

test("table info column rows navigate the grid header", () => {
  assert.match(source, /function scrollToTableInfoColumn\(columnName: string\)/);
  assert.match(source, /@click="scrollToTableInfoColumn\(column\.name\)"/);
  assert.match(source, /:data-grid-column-index="actualColumnIndex\(colIdx\)"/);
});

test("column navigation reveals hidden columns and keeps header scroll synchronized", () => {
  const match = source.match(/function scrollToTableInfoColumn\(columnName: string\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "DataGrid should define scrollToTableInfoColumn");
  assert.match(match[1], /hiddenColumnIndexes\.value\.delete\(columnIndex\)/);
  assert.match(match[1], /\.data-grid-scroller/);
  assert.match(match[1], /headerRef\.value\.scrollLeft = scroller\.scrollLeft/);
  assert.match(match[1], /highlightedColumnIndex\.value = columnIndex/);
});
