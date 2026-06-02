# DBX Dynamic Agent ThoughtChain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade DBX AI from batch-like tool trace display to a dynamic agent event loop with real-time ThoughtChain UI, live sub-agent actions, and evidence-gated SQL generation.

**Architecture:** Do not introduce LangGraph for this phase because DBX's SQL assistant flow is dynamic rather than a fixed DAG. Add a DBX-owned `AiWorkflowEvent` protocol, convert main-agent and Schema Research sub-agent activity into live events, render those events through a Vue ThoughtChain component, and add evidence gates so the main model must continue searching or ask the user when schema evidence is insufficient.

**Tech Stack:** Vue 3, TypeScript, existing DBX AI tool loop in `apps/desktop/src/lib/ai.ts`, existing Tauri AI APIs, existing shadcn/reka/lucide/Tailwind UI stack. No LangGraph, no React Ant Design X dependency.

---

## Background

Current user-facing problems:

- Main model reasoning in function-calling mode appears after a raw response returns instead of streaming continuously.
- `dbx_schema_research_task` only exposes internal tool calls when the whole subtask finishes, so the user cannot see what the sub-agent is doing in real time.
- After Schema Research returns `partial` evidence, the main model may generate a final answer too early instead of continuing to search or asking the user.
- The current timeline UI is growing inside `AiAssistant.vue` and cannot cleanly represent nested agent/tool/user-confirmation states.

Important scope decision:

- Do not introduce LangGraph in this phase. The main chat flow is a dynamic agent/tool loop, not a stable fixed graph.
- Do not directly introduce Ant Design X ThoughtChain because DBX is Vue and Ant Design X ThoughtChain is React-oriented. Use it as an interaction reference only.
- Build a DBX-native event protocol and Vue ThoughtChain UI. This keeps the route open for LangGraph later if fixed long-running workflows such as schema enrichment need checkpoint/resume.

## File Map

- Create `apps/desktop/src/lib/aiWorkflowEvents.ts`
  - Defines `AiWorkflowEvent`, node statuses, node kinds, event helper builders, event-to-tree reducer.
  - Owns conversion from runtime events to UI state.

- Create `apps/desktop/src/components/ai/AiThoughtChain.vue`
  - Renders a tree of thought/action nodes.
  - Supports loading/success/error/waiting states, nested nodes, collapsible content, tool arguments, summaries, and streaming text.

- Create `apps/desktop/src/components/ai/AiThoughtNode.vue`
  - Small recursive node component used by `AiThoughtChain.vue`.
  - Keeps `AiAssistant.vue` from becoming larger.

- Modify `apps/desktop/src/lib/tauri.ts`
  - Add persisted conversation-compatible workflow event types if they need to cross the API boundary.
  - Keep existing `AiToolTrace` and `AiTimelineItem` for backward compatibility.

- Modify `apps/desktop/src/lib/api.ts`
  - Re-export new event types if the UI imports AI API types through this module.

- Modify `apps/desktop/src/lib/ai.ts`
  - Replace scattered callbacks with `onEvent` while preserving compatibility wrappers during migration.
  - Emit events from main tool loop, Schema Research subtask, low-level tool execution, evidence packaging, and user-choice boundaries.
  - Add evidence-gate behavior after `dbx_schema_research_task` results.

- Modify `apps/desktop/src/components/editor/AiAssistant.vue`
  - Replace inline timeline rendering with `AiThoughtChain`.
  - Convert new `AiWorkflowEvent` stream into message-local thought tree state.
  - Preserve old `reasoning/toolTraces/timeline` rendering for saved conversations that do not have workflow events.

- Modify `apps/desktop/src/i18n/locales/zh-CN.ts`
  - Add ThoughtChain labels and node status text.

- Modify `apps/desktop/src/i18n/locales/en.ts`
  - Add English labels.

- Modify `apps/desktop/src/i18n/locales/es.ts`
  - Add Spanish labels, matching existing locale style.

- Create `packages/app-tests/aiWorkflowEvents.test.ts`
  - Tests event-to-tree reducer, nested child attachment, status updates, streaming deltas, and legacy-safe behavior.

- Modify `packages/app-tests/aiSchemaTools.test.ts`
  - Add evidence-gate contract tests if existing AI schema tool tests already cover tool contracts.

## Event Protocol

The new event protocol is UI-oriented and independent of any orchestration framework.

```ts
export type AiWorkflowNodeKind = "model" | "agent" | "tool" | "user" | "evidence" | "final";

export type AiWorkflowNodeStatus = "loading" | "success" | "error" | "waiting" | "abort";

export interface AiWorkflowBaseEvent {
  id: string;
  ts: number;
  nodeId: string;
  parentId?: string;
}

export type AiWorkflowEvent =
  | (AiWorkflowBaseEvent & {
      type: "node.start";
      kind: AiWorkflowNodeKind;
      title: string;
      description?: string;
      status?: AiWorkflowNodeStatus;
    })
  | (AiWorkflowBaseEvent & {
      type: "node.delta";
      delta: string;
    })
  | (AiWorkflowBaseEvent & {
      type: "node.update";
      title?: string;
      description?: string;
      status?: AiWorkflowNodeStatus;
    })
  | (AiWorkflowBaseEvent & {
      type: "tool.start";
      name: string;
      arguments: string;
    })
  | (AiWorkflowBaseEvent & {
      type: "tool.end";
      status: "success" | "error";
      summary?: string;
    })
  | (AiWorkflowBaseEvent & {
      type: "evidence";
      status: string;
      summary: string;
    })
  | (AiWorkflowBaseEvent & {
      type: "user.input.required";
      requestKind: "table" | "column" | "relation";
      title: string;
      description?: string;
    });

export interface AiThoughtNodeState {
  id: string;
  parentId?: string;
  kind: AiWorkflowNodeKind;
  title: string;
  description?: string;
  status: AiWorkflowNodeStatus;
  content: string;
  toolName?: string;
  toolArguments?: string;
  summary?: string;
  requestKind?: "table" | "column" | "relation";
  children: AiThoughtNodeState[];
  createdAt: number;
  updatedAt: number;
}
```

## Evidence Gate Rules

After any `dbx_schema_research_task` result, the main loop must not blindly accept insufficient evidence.

Rules:

- `status === "sufficient"`:
  - Allow final SQL composition.
  - Final SQL may use only verified columns from evidence or columns verified later by `dbx_get_column_details` / `dbx_load_table_schema`.

- `status === "partial"`:
  - Main model must continue with a narrower schema research task, direct schema tool call, or user confirmation.
  - If the next assistant message contains final SQL without another tool call or user question, inject a follow-up instruction requiring another search or clarification.

- `status === "need_user_choice"`:
  - Main model must call `dbx_request_table_choice`, `dbx_request_column_choice`, or `dbx_request_relation`.
  - If it does not, the runtime should ask the user with the strongest uncertainty from the Schema Research result.

- `status === "not_found"` or `status === "error"`:
  - Do not generate invented SQL.
  - Return a concise explanation of missing schema evidence or ask the user to specify a table/field.

- Any unverified field:
  - Cannot be used in final SQL until the runtime verifies it with `dbx_get_column_details` or `dbx_load_table_schema`.

## Task 1: Add Workflow Event Types And Reducer

**Files:**

- Create: `apps/desktop/src/lib/aiWorkflowEvents.ts`
- Create: `packages/app-tests/aiWorkflowEvents.test.ts`

- [ ] Step 1: Create failing reducer tests.

Add tests covering these cases:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAiWorkflowEvent,
  createAiWorkflowEvent,
  type AiThoughtNodeState,
} from "../../apps/desktop/src/lib/aiWorkflowEvents.ts";

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
      arguments: "{\"query\":\"评价 review\"}",
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
  assert.equal(nodes[0].summary, "找到 5 张表");
});
```

- [ ] Step 2: Run the failing test in host environment.

Run from Windows host PowerShell, not WSL:

```powershell
pnpm exec tsx --test packages/app-tests/aiWorkflowEvents.test.ts
```

Expected before implementation: import or function-not-found failure.

- [ ] Step 3: Implement `aiWorkflowEvents.ts`.

Implementation requirements:

- `createAiWorkflowEvent(input)` fills `id` with `uuid()` and `ts` with `Date.now()` when not provided.
- `applyAiWorkflowEvent(nodes, event)` returns a new array and does not mutate existing nodes.
- Unknown parent IDs should attach the node as a root node. This avoids losing events when parent events arrive late.
- Repeated `node.start` for the same `nodeId` should update the existing node, not duplicate it.
- `node.delta` appends to `content`.
- `tool.start` creates a node with `kind: "tool"`, `status: "loading"`, `toolName`, `toolArguments`.
- `tool.end` updates the matching node status and summary.
- `user.input.required` creates or updates a waiting user node.

- [ ] Step 4: Run reducer test again.

Run:

```powershell
pnpm exec tsx --test packages/app-tests/aiWorkflowEvents.test.ts
```

Expected: all tests pass.

## Task 2: Add Vue ThoughtChain Components

**Files:**

- Create: `apps/desktop/src/components/ai/AiThoughtChain.vue`
- Create: `apps/desktop/src/components/ai/AiThoughtNode.vue`
- Modify: `apps/desktop/src/i18n/locales/zh-CN.ts`
- Modify: `apps/desktop/src/i18n/locales/en.ts`
- Modify: `apps/desktop/src/i18n/locales/es.ts`

- [ ] Step 1: Create `AiThoughtNode.vue`.

Component contract:

```ts
interface Props {
  node: AiThoughtNodeState;
  depth?: number;
}
```

Rendering requirements:

- Show icon by `node.kind`:
  - `model`: `Bot`
  - `agent`: `Wand2`
  - `tool`: `Wrench`
  - `user`: `MessageSquarePlus`
  - `evidence`: `ShieldCheck`
  - `final`: `Check`
- Show status by `node.status`:
  - `loading`: spinner
  - `success`: green check
  - `error`: amber warning
  - `waiting`: highlighted waiting state
  - `abort`: muted stop state
- Render `node.title`, `node.description`, `node.content`, `node.toolArguments`, `node.summary`.
- Tool arguments should be collapsed by default when longer than 240 characters.
- Child nodes render recursively with a left border and indentation.

- [ ] Step 2: Create `AiThoughtChain.vue`.

Component contract:

```ts
interface Props {
  nodes: AiThoughtNodeState[];
  compact?: boolean;
}
```

Rendering requirements:

- Render root nodes in order.
- Show nothing if `nodes.length === 0`.
- Keep cards compact; this is an operational tool, not a landing page.
- Use existing Tailwind/shadcn visual language.

- [ ] Step 3: Add i18n labels.

Add keys under `ai`:

```ts
thoughtChain: "执行过程",
thoughtNodeLoading: "进行中",
thoughtNodeSuccess: "完成",
thoughtNodeError: "失败",
thoughtNodeWaiting: "等待用户",
thoughtNodeAbort: "已停止",
thoughtToolArguments: "参数",
thoughtToolSummary: "结果",
thoughtCollapse: "收起",
thoughtExpand: "展开",
```

Translate consistently in `en.ts` and `es.ts`.

- [ ] Step 4: Run type check.

Run from Windows host PowerShell:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 3: Wire ThoughtChain Into AiAssistant With Legacy Compatibility

**Files:**

- Modify: `apps/desktop/src/components/editor/AiAssistant.vue`
- Modify: `apps/desktop/src/lib/tauri.ts` if persisted message shape needs event fields.
- Modify: `apps/desktop/src/lib/api.ts` if type exports need updating.

- [ ] Step 1: Extend assistant message state.

Add to local `ChatMessage`:

```ts
workflowEvents?: AiWorkflowEvent[];
thoughtNodes?: AiThoughtNodeState[];
```

Keep existing fields:

```ts
reasoning?: string;
toolTraces?: AiToolTrace[];
timeline?: AiTimelineItem[];
```

Do not remove legacy timeline because saved conversations may still contain it.

- [ ] Step 2: Add event append helper.

Add helper:

```ts
function appendAssistantWorkflowEvent(assistantIdx: number, event: AiWorkflowEvent) {
  const msg = messages.value[assistantIdx];
  if (!msg) return;
  msg.workflowEvents = [...(msg.workflowEvents || []), event];
  msg.thoughtNodes = applyAiWorkflowEvent(msg.thoughtNodes || [], event);
  msg.isThinking = event.type !== "node.update" || event.status === "loading" || event.status === "waiting";
  scrollToBottom();
}
```

- [ ] Step 3: Render `AiThoughtChain`.

Replace the inline timeline block with:

```vue
<AiThoughtChain v-if="msg.thoughtNodes?.length" :nodes="msg.thoughtNodes" />
<LegacyAiTimeline
  v-else-if="msg.timeline?.length || msg.reasoning || msg.toolTraces?.length || msg.isThinking"
  ...
/>
```

If creating `LegacyAiTimeline.vue` is too large for this phase, keep the old inline block under the `v-else-if`. Do not remove legacy rendering.

- [ ] Step 4: Persist workflow events.

When saving conversations, include:

```ts
...(m.workflowEvents?.length ? { workflowEvents: m.workflowEvents } : {}),
```

When loading conversations:

- If `workflowEvents` exists, rebuild `thoughtNodes` by replaying `applyAiWorkflowEvent`.
- Else fall back to `buildLegacyTimeline(m.reasoning, m.toolTraces)`.

- [ ] Step 5: Run type check.

Run:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 4: Convert Main AI Loop To Workflow Events

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `apps/desktop/src/components/editor/AiAssistant.vue`

- [ ] Step 1: Add `AiWorkflowEventHandler`.

In `ai.ts`:

```ts
export type AiWorkflowEventHandler = (event: AiWorkflowEvent) => void;
```

Update `runAiStream` to accept `onEvent?: AiWorkflowEventHandler`.

Keep the old callback parameters for one migration pass, or wrap them inside `onEvent` to minimize churn.

- [ ] Step 2: Emit main model node events.

At the start of `runAiStream`, emit:

```ts
const mainNodeId = uuid();
onEvent?.(createAiWorkflowEvent({
  type: "node.start",
  nodeId: mainNodeId,
  kind: "model",
  title: isZh ? "主模型分析" : "Main model reasoning",
  status: "loading",
}));
```

When normal streaming emits content/reasoning:

- `chunk.reasoning_delta` should emit `node.delta` on `mainNodeId`.
- `chunk.delta` remains final answer delta and should still append to assistant content.

- [ ] Step 3: Emit main tool loop events.

Inside `runAiToolLoop`, emit:

- Before raw chat request:

```ts
node.update(mainNodeId, "主模型正在决定下一步", "loading")
```

- For every tool call:

```ts
tool.start(toolNodeId, mainNodeId, call.name, formatSchemaToolArguments(call))
```

- On completion:

```ts
tool.end(toolNodeId, status, summary)
```

Keep old `onToolTrace` callback until `AiAssistant.vue` no longer depends on it.

- [ ] Step 4: Wire `AiAssistant.vue`.

Pass:

```ts
(event) => appendAssistantWorkflowEvent(assistantIdx, event)
```

to `runAiStream`.

- [ ] Step 5: Run type check.

Run:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 5: Make Schema Research Subtask Emit Real-Time Child Events

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `apps/desktop/src/components/editor/AiAssistant.vue` only if event mapping needs UI changes.

- [ ] Step 1: Pass event handler and parent node into `executeSchemaResearchTaskTool`.

Add optional runtime metadata:

```ts
interface AiSchemaToolRuntimeHooks {
  onEvent?: AiWorkflowEventHandler;
  parentNodeId?: string;
}
```

Thread this through:

- `runAiToolLoop`
- `executeAiSchemaToolCall`
- `executeSchemaResearchTaskTool`
- `runSchemaResearchSubtask`

- [ ] Step 2: Emit sub-agent node start.

When `dbx_schema_research_task` starts:

```ts
const researchNodeId = uuid();
onEvent?.(createAiWorkflowEvent({
  type: "node.start",
  nodeId: researchNodeId,
  parentId: parentNodeId,
  kind: "agent",
  title: isZh ? "Schema Research 子任务" : "Schema Research subtask",
  description: String(args.task || ""),
  status: "loading",
}));
```

- [ ] Step 3: Emit sub-agent thinking/status events.

Before each subtask raw chat round:

```ts
node.update(researchNodeId, description: `第 ${round + 1} 轮分析`, status: "loading")
```

If `rawMessage.reasoning_content` exists, emit `node.delta` for the research node.

- [ ] Step 4: Emit internal low-level tool events immediately.

For each subtask tool call:

- Emit `tool.start` before `executeAiSchemaToolCall`.
- Emit `tool.end` immediately after output returns.
- Keep `internalToolTraces` for backwards compatibility, but UI should rely on live workflow events.

- [ ] Step 5: Emit evidence event.

After parsing `SchemaResearchTaskResult`:

```ts
onEvent?.(createAiWorkflowEvent({
  type: "evidence",
  nodeId: `${researchNodeId}:evidence`,
  parentId: researchNodeId,
  status: result.status,
  summary: result.summary,
}));
```

Then mark research node:

- `success` for `sufficient`
- `waiting` for `need_user_choice`
- `error` for `error`
- `success` with partial description for `partial/not_found`

- [ ] Step 6: Run type check.

Run:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 6: Add Evidence Gate And Follow-Up Enforcement

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `packages/app-tests/aiSchemaTools.test.ts` or create `packages/app-tests/aiEvidenceGate.test.ts`

- [ ] Step 1: Extract evidence gate function.

Create:

```ts
export function evaluateSchemaResearchGate(result: SchemaResearchTaskResult): {
  canComposeSql: boolean;
  mustAskUser: boolean;
  mustContinueResearch: boolean;
  reason: string;
}
```

Rules:

- `sufficient` -> `canComposeSql: true`
- `need_user_choice` -> `mustAskUser: true`
- `partial` -> `mustContinueResearch: true`
- `not_found` / `error` -> no SQL composition
- Any table column with `verified === false` and usage not `unknown` -> continue research unless user confirmation is required.

- [ ] Step 2: Add tests.

Test cases:

```ts
test("sufficient verified evidence can compose sql", () => { ... });
test("partial evidence must continue research", () => { ... });
test("need_user_choice evidence must ask user", () => { ... });
test("unverified selected fields block sql composition", () => { ... });
```

- [ ] Step 3: Enforce gate in main tool loop.

When `executeSchemaResearchTaskTool` returns:

- Compute gate result.
- Emit an evidence gate node event.
- If gate says continue or ask user, append a synthetic tool result instruction for the main model:

```text
Schema evidence is not sufficient for final SQL. You must either call another schema tool/subtask or ask the user for confirmation. Do not produce final SQL yet.
```

- If the next raw assistant response has no tool calls and contains SQL, block it and run one more round with a stricter instruction.

- [ ] Step 4: Budget safety.

If all tool budgets are exhausted:

- Do not force infinite retries.
- Return a final clarification response explaining which schema facts are missing.

- [ ] Step 5: Run tests and type check.

Run from Windows host PowerShell:

```powershell
pnpm exec tsx --test packages/app-tests/aiEvidenceGate.test.ts
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: tests pass and type check passes.

## Task 7: Make User Confirmation Nodes Visible And Stateful

**Files:**

- Modify: `apps/desktop/src/components/editor/AiAssistant.vue`
- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `apps/desktop/src/components/ai/AiThoughtChain.vue`
- Modify: `apps/desktop/src/components/ai/AiThoughtNode.vue`

- [ ] Step 1: Emit user waiting event when a choice request opens.

For table choice:

```ts
user.input.required(nodeId, requestKind: "table", title: "请选择目标表")
```

For column choice:

```ts
user.input.required(nodeId, requestKind: "column", title: "请选择字段")
```

For relation choice:

```ts
user.input.required(nodeId, requestKind: "relation", title: "请确认表关联关系")
```

- [ ] Step 2: Update event when user confirms/skips.

On confirm:

```ts
node.update(nodeId, status: "success", description: "用户已确认")
```

On skip/cancel:

```ts
node.update(nodeId, status: "abort", description: "用户已跳过")
```

- [ ] Step 3: Keep existing form UX.

Do not replace the existing table/column/relation form controls in this task. The ThoughtChain only reflects state; the existing confirmation forms still collect input.

- [ ] Step 4: Run type check.

Run:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 8: Cleanup Legacy Trace Path Without Breaking Old Conversations

**Files:**

- Modify: `apps/desktop/src/components/editor/AiAssistant.vue`
- Modify: `apps/desktop/src/lib/tauri.ts`
- Modify: `apps/desktop/src/lib/api.ts`

- [ ] Step 1: Keep legacy data structures.

Do not delete:

- `AiToolTrace`
- `AiTimelineItem`
- `reasoning`
- `toolTraces`
- `timeline`

These are needed for saved conversations.

- [ ] Step 2: Prefer workflow events for new messages.

New assistant messages should use:

- `workflowEvents`
- `thoughtNodes`

Legacy timeline should only render when no workflow nodes exist.

- [ ] Step 3: Remove duplicate live display paths.

After workflow events are wired, avoid rendering the same tool both as:

- new ThoughtChain node
- old timeline tool trace

Keep old `onToolTrace` only if needed for persistence compatibility. Prefer emitting both from a single event adapter.

- [ ] Step 4: Run type check.

Run:

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

## Task 9: Verification And Host-Side Validation

**Files:**

- No source edits unless checks find failures.

- [ ] Step 1: Whitespace check.

Run in WSL is acceptable for this read-only Git check:

```bash
git diff --check
```

Expected: no whitespace errors. CRLF warnings are acceptable in this Windows working tree.

- [ ] Step 2: Frontend type check in Windows host PowerShell.

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
```

Expected: pass.

- [ ] Step 3: Targeted app tests in Windows host PowerShell.

```powershell
pnpm exec tsx --test packages/app-tests/aiWorkflowEvents.test.ts packages/app-tests/aiEvidenceGate.test.ts packages/app-tests/schemaResearch.test.ts packages/app-tests/aiSchemaTools.test.ts
```

Expected: pass.

- [ ] Step 4: Full frontend test suite in Windows host PowerShell.

```powershell
pnpm test
```

Expected: pass.

- [ ] Step 5: Frontend build in Windows host PowerShell.

```powershell
pnpm build
```

Expected: pass. Existing Vite chunk warnings are acceptable if unchanged.

- [ ] Step 6: Rust checks in Windows host VS Developer PowerShell.

Only run if Rust/Tauri type definitions or commands changed:

```powershell
cargo fmt --check --all
cargo check --workspace --locked
```

Expected: pass.

Do not use WSL `/mnt/d` for Rust build verification because this repo has already shown `kuzu`/`libduckdb-sys` build and I/O issues under mounted Windows paths.

- [ ] Step 7: Manual desktop smoke.

Run `pnpm dev:tauri` in Windows host environment and verify:

- Ask a schema-heavy SQL question.
- Main ThoughtChain node appears immediately.
- `dbx_schema_research_task` appears as a running tool.
- Schema Research child node appears while it is running.
- Low-level tools appear before the subtask finishes.
- Evidence node appears with `sufficient`, `partial`, or `need_user_choice`.
- If relation/table/column is uncertain, user confirmation UI appears and ThoughtChain shows waiting state.
- Final SQL is not produced when evidence is explicitly insufficient unless the assistant asks for clarification.

## Acceptance Criteria

- The assistant view no longer waits until the end of `dbx_schema_research_task` to show child tool activity.
- New messages render through `AiThoughtChain`.
- Legacy saved conversations still render through existing timeline fallback.
- Main model and sub-agent actions are visible as nested live nodes.
- Evidence gate prevents final SQL generation from insufficient schema evidence.
- User table/column/relation confirmation appears as waiting nodes.
- No LangGraph dependency is added.
- No Ant Design X React dependency is added.
- Host-side type check and targeted tests pass.

## Deferred Work

- Token-level streaming for function-calling raw chat. This requires backend/provider support for streaming tool-call rounds, not just UI work.
- LangGraph for fixed long-running workflows such as schema enrichment with checkpoint/resume.
- Visual polish beyond the first DBX ThoughtChain component.
- Persisted workflow replay across app restarts with resumable execution. This phase only preserves display history.

## Self-Review

- Spec coverage:
  - Real-time sub-agent visibility: Task 5.
  - Main model event visibility: Task 4.
  - ThoughtChain UI: Task 2 and Task 3.
  - Evidence gate / reasonable follow-up: Task 6.
  - User confirmation state: Task 7.
  - Legacy compatibility: Task 3 and Task 8.
  - No LangGraph / no Ant Design X: Architecture, Acceptance Criteria.

- Placeholder scan:
  - No `TBD` / `TODO` placeholders.
  - Each task names exact files and expected commands.

- Type consistency:
  - Event type names are consistently `AiWorkflowEvent`, `AiThoughtNodeState`, `AiWorkflowNodeKind`, `AiWorkflowNodeStatus`.
  - UI component names are consistently `AiThoughtChain.vue` and `AiThoughtNode.vue`.
