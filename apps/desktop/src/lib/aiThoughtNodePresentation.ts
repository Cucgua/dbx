import {
  buildAiToolTraceChildPresentation,
  type AiToolTraceChildSummary,
  type AiToolTracePresentationStatus,
} from "@/lib/aiToolTracePresentation";
import type { AiThoughtNodeState, AiWorkflowNodeStatus } from "@/lib/aiWorkflowEvents";

export interface AiThoughtNodeChildPresentation {
  toolSummary: AiToolTraceChildSummary | null;
  visibleChildren: AiThoughtNodeState[];
}

export function buildAiThoughtNodeChildPresentation(
  children: readonly AiThoughtNodeState[],
  expanded = false,
): AiThoughtNodeChildPresentation {
  const toolChildren = children.filter((child) => child.kind === "tool");
  const toolPresentation = buildAiToolTraceChildPresentation(
    toolChildren.map((child) => ({
      child,
      status: thoughtStatusToToolPresentationStatus(child.status),
    })),
    expanded,
  );

  if (!toolPresentation.summary) {
    return { toolSummary: null, visibleChildren: [...children] };
  }

  const visibleToolIds = new Set(toolPresentation.visibleChildren.map((item) => item.child.id));
  return {
    toolSummary: toolPresentation.summary,
    visibleChildren: children.filter((child) => child.kind !== "tool" || visibleToolIds.has(child.id)),
  };
}

function thoughtStatusToToolPresentationStatus(status: AiWorkflowNodeStatus): AiToolTracePresentationStatus {
  if (status === "success") return "success";
  if (status === "error" || status === "abort") return "error";
  return "running";
}
