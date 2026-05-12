import { ref, computed, type ComputedRef, type Ref } from "vue";
import { useElementSize } from "@vueuse/core";

type CellValue = string | number | boolean | null;

export const COL_MIN_WIDTH = 60;
export const COL_MAX_WIDTH = 400;
const COL_CHAR_WIDTH = 8;
const COL_HEADER_PADDING = 48;
const COL_CELL_PADDING = 28;
const COL_SAMPLE_ROWS = 50;
const ROW_NUM_WIDTH = 48;

function estimateTextWidth(text: string, padding: number): number {
  return text.length * COL_CHAR_WIDTH + padding;
}

export interface UseDataGridColumnResizeOptions {
  columns: ComputedRef<string[]>;
  rows: ComputedRef<CellValue[][]>;
  gridRef: Ref<HTMLDivElement | undefined>;
}

export function useDataGridColumnResize(options: UseDataGridColumnResizeOptions) {
  const { columns, rows, gridRef } = options;

  const columnWidths = ref<number[]>([]);
  const { width: gridWidth } = useElementSize(gridRef);
  let isResizing = false;

  function initColumnWidths() {
    if (columnWidths.value.length !== columns.value.length) {
      const rowData = rows.value;
      const sampleCount = Math.min(rowData.length, COL_SAMPLE_ROWS);
      columnWidths.value = columns.value.map((colName, colIdx) => {
        let maxWidth = estimateTextWidth(colName, COL_HEADER_PADDING);
        for (let i = 0; i < sampleCount; i++) {
          const val = rowData[i]?.[colIdx];
          if (val == null) continue;
          const text = typeof val === "object" ? JSON.stringify(val) : String(val);
          const displayLen = Math.min(text.length, 60);
          const w = displayLen * COL_CHAR_WIDTH + COL_CELL_PADDING;
          if (w > maxWidth) maxWidth = w;
        }
        return Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.round(maxWidth)));
      });
    }
  }

  function onResizeStart(colIdx: number, event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    const startX = event.clientX;
    const startWidth = columnWidths.value[colIdx];
    const onMove = (e: MouseEvent) => {
      columnWidths.value[colIdx] = Math.max(60, startWidth + e.clientX - startX);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      requestAnimationFrame(() => {
        isResizing = false;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function autoFitColumn(colIdx: number) {
    const colName = columns.value[colIdx];
    if (!colName) return;
    const rowData = rows.value;
    const sampleCount = Math.min(rowData.length, COL_SAMPLE_ROWS);
    let maxWidth = estimateTextWidth(colName, COL_HEADER_PADDING);
    for (let i = 0; i < sampleCount; i++) {
      const val = rowData[i]?.[colIdx];
      if (val == null) continue;
      const text = typeof val === "object" ? JSON.stringify(val) : String(val);
      const displayLen = Math.min(text.length, 60);
      const w = displayLen * COL_CHAR_WIDTH + COL_CELL_PADDING;
      if (w > maxWidth) maxWidth = w;
    }
    columnWidths.value[colIdx] = Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.round(maxWidth)));
  }

  const baseTotalWidth = computed(() => columnWidths.value.reduce((a, b) => a + b, 0));

  const renderedColumnWidths = computed(() => {
    const widths = columnWidths.value;
    if (widths.length === 0) return widths;

    const extraWidth = Math.max(0, gridWidth.value - ROW_NUM_WIDTH - baseTotalWidth.value);
    if (extraWidth === 0) return widths;

    const extraPerColumn = extraWidth / widths.length;
    return widths.map((width) => width + extraPerColumn);
  });

  const totalWidth = computed(() => renderedColumnWidths.value.reduce((a, b) => a + b, 0) + ROW_NUM_WIDTH);

  const columnVars = computed(() => {
    const vars: Record<string, string> = {};
    renderedColumnWidths.value.forEach((w, i) => {
      vars[`--col-w-${i}`] = `${w}px`;
    });
    vars["--row-num-w"] = `${ROW_NUM_WIDTH}px`;
    vars["--total-w"] = `${totalWidth.value}px`;
    return vars;
  });

  function getIsResizing() {
    return isResizing;
  }

  return {
    columnWidths,
    initColumnWidths,
    onResizeStart,
    autoFitColumn,
    renderedColumnWidths,
    totalWidth,
    columnVars,
    getIsResizing,
  };
}
