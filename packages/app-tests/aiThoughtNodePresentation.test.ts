import { strict as assert } from "node:assert";
import { test } from "vitest";
import { buildAiThoughtNodeChildPresentation } from "../../apps/desktop/src/lib/aiThoughtNodePresentation.ts";
import type {
  AiThoughtNodeState,
  AiWorkflowNodeKind,
  AiWorkflowNodeStatus,
} from "../../apps/desktop/src/lib/aiWorkflowEvents.ts";

function node(
  id: string,
  kind: AiWorkflowNodeKind = "tool",
  status: AiWorkflowNodeStatus = "success",
): AiThoughtNodeState {
  return {
    id,
    kind,
    title: id,
    status,
    defaultExpanded: false,
    content: "",
    children: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("keeps thought node tool children expanded until the threshold is exceeded", () => {
  const children = [node("tool-1"), node("tool-2"), node("tool-3")];

  assert.deepEqual(buildAiThoughtNodeChildPresentation(children), {
    toolSummary: null,
    visibleChildren: children,
  });
});

test("collapses completed thought node tool children and keeps running tools visible", () => {
  const children = [
    node("tool-1", "tool", "success"),
    node("tool-2", "tool", "error"),
    node("tool-3", "tool", "loading"),
    node("tool-4", "tool", "success"),
  ];

  assert.deepEqual(buildAiThoughtNodeChildPresentation(children), {
    toolSummary: {
      total: 4,
      success: 2,
      error: 1,
      running: 1,
    },
    visibleChildren: [children[2]],
  });
  assert.deepEqual(buildAiThoughtNodeChildPresentation(children, true), {
    toolSummary: {
      total: 4,
      success: 2,
      error: 1,
      running: 1,
    },
    visibleChildren: children,
  });
});

test("keeps non-tool children visible while collapsing crowded tool children", () => {
  const children = [
    node("tool-1", "tool", "success"),
    node("choice", "user", "waiting"),
    node("tool-2", "tool", "success"),
    node("tool-3", "tool", "success"),
    node("tool-4", "tool", "loading"),
  ];

  assert.deepEqual(buildAiThoughtNodeChildPresentation(children), {
    toolSummary: {
      total: 4,
      success: 3,
      error: 0,
      running: 1,
    },
    visibleChildren: [children[1], children[4]],
  });
});

test("shows non-tool children and summary only when crowded tool children are complete", () => {
  const children = [
    node("tool-1", "tool", "success"),
    node("choice", "user", "waiting"),
    node("tool-2", "tool", "success"),
    node("tool-3", "tool", "error"),
    node("tool-4", "tool", "success"),
  ];

  assert.deepEqual(buildAiThoughtNodeChildPresentation(children), {
    toolSummary: {
      total: 4,
      success: 3,
      error: 1,
      running: 0,
    },
    visibleChildren: [children[1]],
  });
});
