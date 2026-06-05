import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAiWorkflowEvent,
  createAiWorkflowEvent,
  type AiThoughtNodeState,
} from "../../apps/desktop/src/lib/aiWorkflowEvents";

test("builds nested thought nodes from workflow events", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "main",
      kind: "model",
      title: "主模型分析",
      status: "loading",
    }),
  );
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "research",
      parentId: "main",
      kind: "agent",
      title: "Schema Research",
      status: "loading",
    }),
  );

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "main");
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].children[0].id, "research");
});

test("represents the main assistant and SQL assistant subagent as separate nested nodes", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "main",
      kind: "agent",
      title: "主助手",
      status: "loading",
    }),
  );
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "sql-assistant",
      parentId: "main",
      kind: "agent",
      title: "SQL助手分析中",
      status: "loading",
    }),
  );

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].title, "主助手");
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].children[0].title, "SQL助手分析中");
});

test("appends streaming deltas to the target node", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "main",
      kind: "model",
      title: "主模型分析",
    }),
  );
  nodes = applyAiWorkflowEvent(nodes, createAiWorkflowEvent({ type: "node.delta", nodeId: "main", delta: "正在找表" }));
  nodes = applyAiWorkflowEvent(nodes, createAiWorkflowEvent({ type: "node.delta", nodeId: "main", delta: "和字段" }));

  assert.equal(nodes[0].content, "正在找表和字段");
});

test("updates tool status and summary", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "tool.start",
      nodeId: "tool-1",
      parentId: "research",
      name: "dbx_search_schema",
      arguments: '{"query":"评价 review"}',
    }),
  );
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "tool.end",
      nodeId: "tool-1",
      status: "success",
      summary: "找到 5 张表",
    }),
  );

  assert.equal(nodes[0].kind, "tool");
  assert.equal(nodes[0].status, "success");
  assert.equal(nodes[0].defaultExpanded, false);
  assert.equal(nodes[0].summary, "找到 5 张表");
});

test("keeps active or failed nodes expanded by default", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "main",
      kind: "model",
      title: "主模型分析",
      status: "loading",
    }),
  );
  assert.equal(nodes[0].defaultExpanded, true);

  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.update",
      nodeId: "main",
      status: "error",
      description: "工具调用失败",
    }),
  );
  assert.equal(nodes[0].defaultExpanded, true);
});

test("keeps completed assistant nodes with thinking content expanded", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "main",
      kind: "agent",
      title: "主助手",
      status: "loading",
    }),
  );
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.delta",
      nodeId: "main",
      delta: "正在调度 SQL 助手分析 schema。",
    }),
  );
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.update",
      nodeId: "main",
      status: "success",
      description: "回答生成完成",
    }),
  );

  assert.equal(nodes[0].status, "success");
  assert.equal(nodes[0].content, "正在调度 SQL 助手分析 schema。");
  assert.equal(nodes[0].defaultExpanded, true);
});

test("reattaches root nodes when parent arrives later", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "tool.start",
      nodeId: "tool-1",
      parentId: "research",
      name: "dbx_find_columns",
      arguments: '{"query":"score"}',
    }),
  );
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "tool-1");

  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "node.start",
      nodeId: "research",
      kind: "agent",
      title: "Schema Research",
    }),
  );

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "research");
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].children[0].id, "tool-1");
});

test("maps evidence requiring user choice to waiting status", () => {
  let nodes: AiThoughtNodeState[] = [];
  nodes = applyAiWorkflowEvent(
    nodes,
    createAiWorkflowEvent({
      type: "evidence",
      nodeId: "evidence-1",
      parentId: "research",
      status: "need_user_choice",
      summary: "Need table confirmation.",
    }),
  );

  assert.equal(nodes[0].status, "waiting");
  assert.equal(nodes[0].kind, "evidence");
});
