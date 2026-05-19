import type { DatabaseInfo, TreeNode } from "@/types/database";
import { DEFAULT_DATABASE_TREE_LABEL } from "./treeNodeContext";

export function buildDatabaseTreeNodes(
  connectionId: string,
  databases: DatabaseInfo[],
  options: { includeDefaultWhenEmpty?: boolean } = {},
): TreeNode[] {
  const nodes = databases.flatMap((db) => {
    const name = db.name.trim();
    if (!name) return [];
    return [
      {
        id: `${connectionId}:${name}`,
        label: name,
        type: "database" as const,
        connectionId,
        database: name,
        isExpanded: false,
        children: [],
      },
    ];
  });

  if (nodes.length > 0 || !options.includeDefaultWhenEmpty) return nodes;

  return [
    {
      id: `${connectionId}:`,
      label: DEFAULT_DATABASE_TREE_LABEL,
      type: "database" as const,
      connectionId,
      database: "",
      isExpanded: false,
      children: [],
    },
  ];
}
