import { strict as assert } from "node:assert";
import test from "node:test";
import { buildAiToolTraceChildPresentation } from "../../apps/desktop/src/lib/aiToolTracePresentation.ts";
import type { AiToolTrace } from "../../apps/desktop/src/lib/api.ts";

function trace(id: string, status: AiToolTrace["status"] = "success"): AiToolTrace {
  return {
    id,
    name: `dbx_tool_${id}`,
    arguments: `{"id":"${id}"}`,
    status,
    summary: `summary ${id}`,
  };
}

test("keeps child tool traces expanded until the threshold is exceeded", () => {
  const traces = [trace("1"), trace("2"), trace("3")];

  assert.deepEqual(buildAiToolTraceChildPresentation(traces), {
    summary: null,
    visibleChildren: traces,
  });
});

test("collapses completed child tool traces after the threshold and keeps running traces visible", () => {
  const traces = [trace("1"), trace("2", "error"), trace("3", "running"), trace("4")];

  assert.deepEqual(buildAiToolTraceChildPresentation(traces), {
    summary: {
      total: 4,
      success: 2,
      error: 1,
      running: 1,
    },
    visibleChildren: [traces[2]],
  });
  assert.deepEqual(buildAiToolTraceChildPresentation(traces, true), {
    summary: {
      total: 4,
      success: 2,
      error: 1,
      running: 1,
    },
    visibleChildren: traces,
  });
});

test("updates the collapsed summary as running child tool traces complete", () => {
  const traces = [trace("1"), trace("2"), trace("3", "running"), trace("4", "running"), trace("5", "error")];

  assert.deepEqual(buildAiToolTraceChildPresentation(traces), {
    summary: {
      total: 5,
      success: 2,
      error: 1,
      running: 2,
    },
    visibleChildren: [traces[2], traces[3]],
  });
});

test("shows only the collapsed summary when no child tool traces are running", () => {
  const traces = [trace("1"), trace("2"), trace("3", "error"), trace("4")];

  assert.deepEqual(buildAiToolTraceChildPresentation(traces), {
    summary: {
      total: 4,
      success: 3,
      error: 1,
      running: 0,
    },
    visibleChildren: [],
  });
});
