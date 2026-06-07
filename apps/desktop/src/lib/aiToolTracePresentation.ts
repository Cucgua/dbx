export interface AiToolTraceChildSummary {
  total: number;
  success: number;
  error: number;
  running: number;
}

export type AiToolTracePresentationStatus = "running" | "success" | "error";

export interface AiToolTracePresentationItem {
  status: AiToolTracePresentationStatus;
}

export interface AiToolTraceChildPresentation<T> {
  summary: AiToolTraceChildSummary | null;
  visibleChildren: T[];
}

const CHILD_TRACE_COLLAPSE_THRESHOLD = 3;

export function buildAiToolTraceChildPresentation<T extends AiToolTracePresentationItem>(
  children: readonly T[],
  expanded = false,
): AiToolTraceChildPresentation<T> {
  if (children.length <= CHILD_TRACE_COLLAPSE_THRESHOLD) {
    return { summary: null, visibleChildren: [...children] };
  }

  const summary = children.reduce<AiToolTraceChildSummary>(
    (acc, child) => {
      acc.total += 1;
      if (child.status === "running") acc.running += 1;
      else acc[child.status] += 1;
      return acc;
    },
    { total: 0, success: 0, error: 0, running: 0 },
  );

  return {
    summary,
    visibleChildren: expanded ? [...children] : children.filter((child) => child.status === "running"),
  };
}
