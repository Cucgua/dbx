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

  const selectedRowIds = ref<Set<number>>(new Set());
  const lastClickedRowIndex = ref<number | null>(null);
  const hasRowSelection = computed(() => selectedRowIds.value.size > 0);
  const selectedRowCount = computed(() => selectedRowIds.value.size);

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

  function clearRowSelection() {
    selectedRowIds.value = new Set();
    lastClickedRowIndex.value = null;
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

  function handleRowClick(rowIndex: number, rowId: number, event: MouseEvent) {
    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    clearCellSelection();

    if (isMeta) {
      const next = new Set(selectedRowIds.value);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      selectedRowIds.value = next;
      lastClickedRowIndex.value = rowIndex;
    } else if (isShift && lastClickedRowIndex.value !== null) {
      const start = Math.min(lastClickedRowIndex.value, rowIndex);
      const end = Math.max(lastClickedRowIndex.value, rowIndex);
      const next = new Set(selectedRowIds.value);
      for (let i = start; i <= end; i++) {
        const item = displayItems.value[i];
        if (item) next.add(item.id);
      }
      selectedRowIds.value = next;
    } else {
      selectedRowIds.value = new Set([rowId]);
      lastClickedRowIndex.value = rowIndex;
    }
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

  function handleDataCellMousedown(rowIndex: number, colIndex: number, rowId: number, event: MouseEvent) {
    if (event.button !== 0) return;
    if (editingCell.value) return;

    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    if (isMeta || isShift) {
      event.preventDefault();
      focusGridWithoutScrolling();
      handleRowClick(rowIndex, rowId, event);
      return;
    }

    clearRowSelection();
    beginCellSelection(rowIndex, colIndex, event);
  }

  function isRowSelected(rowId: number): boolean {
    return selectedRowIds.value.has(rowId);
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
    selectedRowIds,
    lastClickedRowIndex,
    hasRowSelection,
    selectedRowCount,
    clearRowSelection,
    handleRowClick,
    handleDataCellMousedown,
    isRowSelected,
  };
}
