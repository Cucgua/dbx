import type { TreeNode, TreeNodeType } from "@/types/database";

export interface FlatTreeNode {
  node: TreeNode;
  depth: number;
  id: string;
  type: TreeNodeType;
}

function walk(children: TreeNode[], depth: number, result: FlatTreeNode[]) {
  for (const node of children) {
    result.push({ node, depth, id: node.id, type: node.type });
    if (node.isExpanded && node.children) {
      walk(node.children, depth + 1, result);
    }
  }
}

export function flattenTree(nodes: TreeNode[]): FlatTreeNode[] {
  const result: FlatTreeNode[] = [];
  walk(nodes, 0, result);
  return result;
}

export function shouldVirtualizeFlatTree(count: number): boolean {
  return count >= 100;
}
