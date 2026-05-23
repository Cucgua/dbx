import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  canFormatCellDetailJson,
  cellDetailEditorText,
  defaultCellDetailTab,
  linkedCellDetailTarget,
  visibleCellDetailTabs,
  valueEditorActions,
  type CellDetailPresentationOptions,
} from "../../apps/desktop/src/lib/cellDetailPresentation.ts";

function options(overrides: Partial<CellDetailPresentationOptions> = {}): CellDetailPresentationOptions {
  return {
    isEditable: false,
    ...overrides,
  };
}

test("cell detail drawer keeps the original details tab as the default", () => {
  assert.equal(defaultCellDetailTab(), "details");
});

test("cell detail drawer only shows the original details tab for readonly cells", () => {
  assert.deepEqual(visibleCellDetailTabs(options()), ["details"]);
});

test("cell detail drawer adds a long value editor tab for editable cells", () => {
  assert.deepEqual(visibleCellDetailTabs(options({ isEditable: true })), ["details", "valueEditor"]);
});

test("cell detail value editor restores the original value text on cancel", () => {
  assert.equal(cellDetailEditorText({ nested: true }), '{"nested":true}');
  assert.equal(cellDetailEditorText(null), "");
  assert.equal(cellDetailEditorText("already text"), "already text");
});

test("cell detail value editor keeps json text unchanged until formatting is requested", () => {
  assert.equal(cellDetailEditorText('{"nested":true,"items":[1,2]}', "jsonb"), '{"nested":true,"items":[1,2]}');
  assert.equal(cellDetailEditorText('{"nested":true}', "varchar"), '{"nested":true}');
  assert.equal(cellDetailEditorText("{invalid", "json"), "{invalid");
});

test("cell detail value editor allows json-like string values to be manually formatted", () => {
  assert.equal(cellDetailEditorText('{"name":"示例","value":123}'), '{"name":"示例","value":123}');
  assert.equal(canFormatCellDetailJson('{"name":"示例","value":123}'), true);
  assert.equal(canFormatCellDetailJson("plain text"), false);
});

test("cell detail value editor uses cell actions instead of confirm and cancel", () => {
  assert.deepEqual(valueEditorActions({ canSetNull: true, canFormatJson: true }), [
    "formatJson",
    "setNull",
    "restoreOriginal",
  ]);
  assert.deepEqual(valueEditorActions({ canSetNull: false }), ["restoreOriginal"]);
});

test("cell detail follows the selected grid cell while open", () => {
  assert.deepEqual(
    linkedCellDetailTarget({
      isOpen: true,
      isEditing: false,
      selectedCell: { rowIndex: 2, visibleColIndex: 1 },
      actualColumnIndex: (visibleColIndex) => [0, 3, 5][visibleColIndex] ?? visibleColIndex,
    }),
    { rowIndex: 2, col: 3 },
  );
});

test("cell detail does not follow selection while closed or editing", () => {
  const selectedCell = { rowIndex: 2, visibleColIndex: 1 };
  const actualColumnIndex = (visibleColIndex: number) => visibleColIndex;

  assert.equal(linkedCellDetailTarget({ isOpen: false, isEditing: false, selectedCell, actualColumnIndex }), null);
  assert.equal(linkedCellDetailTarget({ isOpen: true, isEditing: true, selectedCell, actualColumnIndex }), null);
  assert.equal(linkedCellDetailTarget({ isOpen: true, isEditing: false, selectedCell: null, actualColumnIndex }), null);
});

test("cell detail action focuses the hovered cell before opening details", () => {
  const source = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");

  assert.match(
    source,
    /function showCellDetailsForVisibleCell\(rowIndex: number, visibleColIdx: number, actualColIdx: number\)/,
  );
  assert.match(source, /selectSingleCell\(rowIndex, visibleColIdx\)/);
  assert.match(source, /@click\.stop="showCellDetailsForVisibleCell\(item\.displayIndex, visibleColIdx, actualColIdx\)"/);
  assert.doesNotMatch(source, /@click\.stop="showCellDetails\(item\.displayIndex, actualColIdx\)"/);
});
