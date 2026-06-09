import { layer, RectangleMarker, type BlockInfo, type EditorView } from "@codemirror/view";

const MIN_EMPTY_LINE_WIDTH = 14;
const END_OF_LINE_PADDING = 3;
const CONTIGUOUS_LINE_GAP = 1.5;
const CORNER_COVERAGE_GAP = 1;

type TrimmedSelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function layerBase(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function markerForLineRange(
  view: EditorView,
  from: number,
  to: number,
  lineFrom: number,
  lineTo: number,
  lineBlock: BlockInfo,
  includesLineBreak: boolean,
  base: { left: number; top: number },
): TrimmedSelectionRect | null {
  const start = view.coordsAtPos(from, 1);
  const end = from < to ? view.coordsAtPos(to, -1) : start;
  const lineStart = view.coordsAtPos(lineFrom, 1) ?? start;
  const lineEnd = view.coordsAtPos(lineTo, -1) ?? end;
  if (!start || !end || !lineStart || !lineEnd) return null;

  const left = from < to ? Math.min(start.left, end.left) : lineStart.left;
  let right = from < to ? Math.max(start.right, end.right) : left + MIN_EMPTY_LINE_WIDTH;
  if (includesLineBreak && to >= lineTo) {
    right = Math.max(right, lineEnd.right + END_OF_LINE_PADDING);
  }

  const top = view.documentTop + lineBlock.top;
  const bottom = top + lineBlock.height;

  return {
    left: left - base.left,
    top: top - base.top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function coversX(rect: TrimmedSelectionRect | undefined, x: number): boolean {
  if (!rect) return false;
  return rect.left <= x + CORNER_COVERAGE_GAP && rect.left + rect.width >= x - CORNER_COVERAGE_GAP;
}

function markerClass(rects: TrimmedSelectionRect[], index: number): string {
  const prev = rects[index - 1];
  const current = rects[index];
  const next = rects[index + 1];
  const touchesPrev = !!prev && Math.abs(prev.top + prev.height - current.top) <= CONTIGUOUS_LINE_GAP;
  const touchesNext = !!next && Math.abs(current.top + current.height - next.top) <= CONTIGUOUS_LINE_GAP;
  const left = current.left;
  const right = current.left + current.width;

  const classes = ["cm-trimmedSelection"];
  if (!touchesPrev || !coversX(prev, left)) classes.push("cm-trimmedSelection-topLeft");
  if (!touchesPrev || !coversX(prev, right)) classes.push("cm-trimmedSelection-topRight");
  if (!touchesNext || !coversX(next, left)) classes.push("cm-trimmedSelection-bottomLeft");
  if (!touchesNext || !coversX(next, right)) classes.push("cm-trimmedSelection-bottomRight");

  return classes.join(" ");
}

export function trimmedSelectionLayer() {
  return layer({
    above: false,
    class: "cm-trimmedSelectionLayer",
    markers(view) {
      const markers: InstanceType<typeof RectangleMarker>[] = [];
      const base = layerBase(view);

      for (const range of view.state.selection.ranges) {
        if (range.empty) continue;
        const rects: TrimmedSelectionRect[] = [];

        for (const visible of view.visibleRanges) {
          let pos = Math.max(range.from, visible.from, view.viewport.from);
          const endPos = Math.min(range.to, visible.to, view.viewport.to);

          while (pos < endPos) {
            const line = view.state.doc.lineAt(pos);
            const from = Math.max(pos, line.from);
            const to = Math.min(endPos, line.to);
            const lineBlock = view.lineBlockAt(line.from);
            const includesLineBreak = endPos > line.to && range.to > line.to;
            const rect = markerForLineRange(view, from, to, line.from, line.to, lineBlock, includesLineBreak, base);
            if (rect) rects.push(rect);

            const next = line.to + 1;
            if (next <= pos) break;
            pos = next;
          }
        }

        rects.sort((a, b) => a.top - b.top || a.left - b.left);
        rects.forEach((rect, index) => {
          markers.push(new RectangleMarker(markerClass(rects, index), rect.left, rect.top, rect.width, rect.height));
        });
      }

      return markers;
    },
    update(update) {
      return update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged;
    },
  });
}
