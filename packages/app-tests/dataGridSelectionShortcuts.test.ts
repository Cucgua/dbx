import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url), "utf8");
const selectionSource = readFileSync(
  new URL("../../apps/desktop/src/composables/useDataGridSelection.ts", import.meta.url),
  "utf8",
);

test("data grid wires whole table, row, and column selection gestures", () => {
  assert.match(source, /@click="selectAllCells"/);
  assert.match(source, /@click="selectColumn\(colIdx, \$event\)"/);
  assert.match(source, /columnIsSelected\(colIdx\)/);
  assert.match(selectionSource, /function selectAllCells\(\)/);
  assert.match(selectionSource, /function selectColumn\(colIndex: number, event\?: MouseEvent\)/);
  assert.match(selectionSource, /lastClickedColumnIndex/);
});

test("data grid intercepts copy and select-all shortcuts for grid selections", () => {
  assert.match(source, /clipboardShortcut\(event, "a"\)/);
  assert.match(source, /selectAllCells\(\)/);
  assert.match(source, /isTransposeMode\.value && hasRowSelection\.value/);
  assert.match(source, /copyRow\(\);/);
  assert.match(source, /if \(hasCellSelection\.value\) \{\s+copySelectionTsv\(\);/);
  assert.match(source, /copySelectedRowsTsv\(\)/);
});

test("transpose cells reuse grid cell selection and details", () => {
  assert.match(source, /function selectTransposeCell\(rowIndex: number, actualColIdx: number, event: MouseEvent\)/);
  assert.match(source, /transposeCellIsSelected\(cell\.recordIndex, cell\.valueIndex\)/);
  assert.match(source, /@click="selectTransposeCell\(cell\.recordIndex, cell\.valueIndex, \$event\)"/);
  assert.match(source, /@contextmenu="onTransposeCellContext\(cell\.recordIndex, cell\.valueIndex, \$event\)"/);
  assert.match(source, /showCellDetails\(cell\.recordIndex, cell\.valueIndex\)/);
});

test("transpose record headers copy selected records as rows", () => {
  assert.match(source, /function selectTransposeRecord\(rowIndex: number, event\?: MouseEvent\)/);
  assert.match(source, /handleRowClick\(rowIndex, item\.id, event\)/);
  assert.match(source, /@click="selectTransposeRecord\(recordIndex, \$event\)"/);
  assert.match(source, /@contextmenu="selectTransposeRecord\(recordIndex, \$event\)"/);
  assert.match(source, /copyRowJsonLabel/);
  assert.match(source, /if \(isTransposeMode\.value\)/);
  assert.match(source, /grid\.copyColumnJson/);
  assert.match(source, /grid\.copyColumnsJson/);
});
