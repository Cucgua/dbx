import { ref, computed, type ComputedRef, type Ref } from "vue";
import {
  extractSelection,
  isCellInSelection,
  normalizeSelectionRange,
  type CellPosition,
  type CellSelectionRange,
  type SelectionData,
} from "@/lib/gridSelection";

type CellValue = string | number | boolean | null;

interface RowItem {
  id: number;
  sourceIndex?: number;
  newIndex?: number;
  data: CellValue[];
  isNew: boolean;
  isDeleted: boolean;
  isDirtyCol: boolean[];
  status: string;
}

export interface UseDataGridSelectionOptions {
  columns: ComputedRef<string[]>;
  displayItems: ComputedRef<RowItem[]>;
  editingCell: Ref<{ rowId: number; col: number } | null>;
  showTranspose: Ref<boolean>;
  transposeRowIndex: Ref<number | null>;
  gridRef: Ref<HTMLDivElement | undefined>;
}

export function useDataGridSelection(options: UseDataGridSelectionOptions) {
  const { columns, displayItems, editingCell, showTranspose, transposeRowIndex, gridRef } = options;

  const selectionAnchor = ref<CellPosition | null>(null);
  const selectionFocus = ref<CellPosition | null>(null);
  const isSelectingCells = ref(false);

  const selectedRange = computed<CellSelectionRange | null>(() => {
    if (!selectionAnchor.value || !selectionFocus.value) return null;
    return normalizeSelectionRange(selectionAnchor.value, selectionFocus.value);
  });

  const visibleSelectionRows = computed(() => displayItems.value.map((item) => item.data));

  const selectedCells = computed<SelectionData>(() =>
    extractSelection(columns.value, visibleSelectionRows.value, selectedRange.value),
  );

  const selectedCellCount = computed(() => selectedCells.value.columns.length * selectedCells.value.rows.length);
  const hasCellSelection = computed(() => selectedCellCount.value > 0);

  function clearCellSelection() {
    selectionAnchor.value = null;
    selectionFocus.value = null;
    isSelectingCells.value = false;
  }

  function selectSingleCell(rowIndex: number, colIndex: number) {
    const cell = { rowIndex, colIndex };
    selectionAnchor.value = cell;
    selectionFocus.value = cell;
  }

  function selectRow(rowIndex: number) {
    if (columns.value.length === 0) return;
    selectionAnchor.value = { rowIndex, colIndex: 0 };
    selectionFocus.value = { rowIndex, colIndex: columns.value.length - 1 };
  }

  function finishCellSelection() {
    isSelectingCells.value = false;
    document.removeEventListener("mouseup", finishCellSelection);
  }

  function focusGridWithoutScrolling() {
    gridRef.value?.focus({ preventScroll: true });
  }

  function beginCellSelection(rowIndex: number, colIndex: number, event: MouseEvent) {
    if (event.button !== 0) return;
    if (editingCell.value) return;
    event.preventDefault();
    focusGridWithoutScrolling();
    selectSingleCell(rowIndex, colIndex);
    isSelectingCells.value = true;
    if (showTranspose.value) transposeRowIndex.value = rowIndex;
    document.addEventListener("mouseup", finishCellSelection);
  }

  function extendCellSelection(rowIndex: number, colIndex: number) {
    if (!isSelectingCells.value || !selectionAnchor.value) return;
    selectionFocus.value = { rowIndex, colIndex };
  }

  function cellIsSelected(rowIndex: number, colIndex: number): boolean {
    return isCellInSelection(rowIndex, colIndex, selectedRange.value);
  }

  function selectedRangeStart(): CellPosition | null {
    const range = selectedRange.value;
    if (!range) return null;
    return { rowIndex: range.startRow, colIndex: range.startCol };
  }

  return {
    selectionAnchor,
    selectionFocus,
    isSelectingCells,
    selectedRange,
    selectedCells,
    selectedCellCount,
    hasCellSelection,
    clearCellSelection,
    selectSingleCell,
    selectRow,
    finishCellSelection,
    beginCellSelection,
    extendCellSelection,
    cellIsSelected,
    selectedRangeStart,
  };
}
