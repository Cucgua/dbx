import { uuid } from "@/lib/utils";

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

type AiWorkflowEventInputFor<T extends AiWorkflowEvent> = Omit<T, "id" | "ts"> & {
  id?: string;
  ts?: number;
};

export type AiWorkflowEventInput =
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "node.start" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "node.delta" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "node.update" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "tool.start" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "tool.end" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "evidence" }>>
  | AiWorkflowEventInputFor<Extract<AiWorkflowEvent, { type: "user.input.required" }>>;

export interface AiThoughtNodeState {
  id: string;
  parentId?: string;
  kind: AiWorkflowNodeKind;
  title: string;
  description?: string;
  status: AiWorkflowNodeStatus;
  defaultExpanded: boolean;
  content: string;
  toolName?: string;
  toolArguments?: string;
  summary?: string;
  requestKind?: "table" | "column" | "relation";
  children: AiThoughtNodeState[];
  createdAt: number;
  updatedAt: number;
}

export function createAiWorkflowEvent(input: AiWorkflowEventInput): AiWorkflowEvent {
  return {
    ...input,
    id: input.id || uuid(),
    ts: input.ts ?? Date.now(),
  } as AiWorkflowEvent;
}

export function applyAiWorkflowEvent(nodes: AiThoughtNodeState[], event: AiWorkflowEvent): AiThoughtNodeState[] {
  const existing = findThoughtNode(nodes, event.nodeId);
  const nextNode = eventToThoughtNode(event, existing);
  if (!nextNode) return cloneThoughtNodes(nodes);
  return upsertThoughtNode(cloneThoughtNodes(nodes), nextNode);
}

function eventToThoughtNode(event: AiWorkflowEvent, existing?: AiThoughtNodeState): AiThoughtNodeState | undefined {
  const base = existing || createDefaultThoughtNode(event);
  if (event.type === "node.start") {
    return {
      ...base,
      parentId: event.parentId,
      kind: event.kind,
      title: event.title,
      description: event.description,
      status: event.status || "loading",
      defaultExpanded: shouldExpandThoughtNode(event.status || "loading"),
      updatedAt: event.ts,
    };
  }
  if (event.type === "node.delta") {
    return {
      ...base,
      content: `${base.content}${event.delta}`,
      updatedAt: event.ts,
    };
  }
  if (event.type === "node.update") {
    return {
      ...base,
      title: event.title ?? base.title,
      description: event.description ?? base.description,
      status: event.status ?? base.status,
      defaultExpanded: event.status ? shouldExpandUpdatedThoughtNode(event.status, base) : base.defaultExpanded,
      updatedAt: event.ts,
    };
  }
  if (event.type === "tool.start") {
    return {
      ...base,
      parentId: event.parentId,
      kind: "tool",
      title: event.name,
      status: "loading",
      defaultExpanded: true,
      toolName: event.name,
      toolArguments: event.arguments,
      updatedAt: event.ts,
    };
  }
  if (event.type === "tool.end") {
    return {
      ...base,
      status: event.status,
      defaultExpanded: shouldExpandThoughtNode(event.status),
      summary: event.summary,
      updatedAt: event.ts,
    };
  }
  if (event.type === "evidence") {
    return {
      ...base,
      parentId: event.parentId,
      kind: "evidence",
      title: "Schema evidence",
      description: event.status,
      status: evidenceNodeStatus(event.status),
      defaultExpanded: shouldExpandThoughtNode(evidenceNodeStatus(event.status)),
      summary: event.summary,
      updatedAt: event.ts,
    };
  }
  if (event.type === "user.input.required") {
    return {
      ...base,
      parentId: event.parentId,
      kind: "user",
      title: event.title,
      description: event.description,
      status: "waiting",
      defaultExpanded: true,
      requestKind: event.requestKind,
      updatedAt: event.ts,
    };
  }
}

function evidenceNodeStatus(status: string): AiWorkflowNodeStatus {
  if (status === "error" || status === "not_found") return "error";
  if (status === "need_user_choice") return "waiting";
  return "success";
}

function createDefaultThoughtNode(event: AiWorkflowEvent): AiThoughtNodeState {
  return {
    id: event.nodeId,
    parentId: event.parentId,
    kind: "model",
    title: event.nodeId,
    status: "loading",
    defaultExpanded: true,
    content: "",
    children: [],
    createdAt: event.ts,
    updatedAt: event.ts,
  };
}

function shouldExpandThoughtNode(status: AiWorkflowNodeStatus): boolean {
  return status === "loading" || status === "waiting" || status === "error";
}

function shouldExpandUpdatedThoughtNode(status: AiWorkflowNodeStatus, existing: AiThoughtNodeState): boolean {
  if (status === "success" && (existing.kind === "model" || existing.kind === "agent") && (existing.content.trim() || existing.children.length)) {
    return existing.defaultExpanded;
  }
  return shouldExpandThoughtNode(status);
}

function upsertThoughtNode(nodes: AiThoughtNodeState[], node: AiThoughtNodeState): AiThoughtNodeState[] {
  const withoutNode = removeThoughtNode(nodes, node.id);
  const adoptedChildren = collectDetachedChildren(withoutNode, node.id);
  const nodeWithChildren = mergeThoughtNodeChildren(node, adoptedChildren);
  const withoutAdoptedChildren = adoptedChildren.reduce((current, child) => removeThoughtNode(current, child.id), withoutNode);
  if (nodeWithChildren.parentId) {
    const parent = findThoughtNode(withoutAdoptedChildren, nodeWithChildren.parentId);
    if (parent) {
      return mapThoughtNodes(withoutAdoptedChildren, (item) =>
        item.id === nodeWithChildren.parentId
          ? {
              ...item,
              children: [...item.children, nodeWithChildren],
              updatedAt: Math.max(item.updatedAt, nodeWithChildren.updatedAt),
            }
          : item,
      );
    }
  }
  return [...withoutAdoptedChildren, nodeWithChildren];
}

function collectDetachedChildren(nodes: AiThoughtNodeState[], parentId: string): AiThoughtNodeState[] {
  const children: AiThoughtNodeState[] = [];
  for (const node of nodes) {
    if (node.parentId === parentId) children.push(node);
    children.push(...collectDetachedChildren(node.children, parentId));
  }
  return children;
}

function mergeThoughtNodeChildren(node: AiThoughtNodeState, adoptedChildren: AiThoughtNodeState[]): AiThoughtNodeState {
  if (!adoptedChildren.length) return node;
  const existingIds = new Set(node.children.map((child) => child.id));
  const children = [...node.children];
  for (const child of adoptedChildren) {
    if (!existingIds.has(child.id)) children.push(child);
  }
  return {
    ...node,
    children,
  };
}

function removeThoughtNode(nodes: AiThoughtNodeState[], nodeId: string): AiThoughtNodeState[] {
  const result: AiThoughtNodeState[] = [];
  for (const node of nodes) {
    if (node.id === nodeId) continue;
    result.push({
      ...node,
      children: removeThoughtNode(node.children, nodeId),
    });
  }
  return result;
}

function findThoughtNode(nodes: AiThoughtNodeState[], nodeId: string): AiThoughtNodeState | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const child = findThoughtNode(node.children, nodeId);
    if (child) return child;
  }
  return undefined;
}

function mapThoughtNodes(nodes: AiThoughtNodeState[], mapper: (node: AiThoughtNodeState) => AiThoughtNodeState): AiThoughtNodeState[] {
  return nodes.map((node) =>
    mapper({
      ...node,
      children: mapThoughtNodes(node.children, mapper),
    }),
  );
}

function cloneThoughtNodes(nodes: AiThoughtNodeState[]): AiThoughtNodeState[] {
  return nodes.map((node) => ({
    ...node,
    children: cloneThoughtNodes(node.children),
  }));
}
