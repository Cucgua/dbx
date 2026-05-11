import { strict as assert } from "node:assert";
import test from "node:test";
import { flattenTree, shouldVirtualizeFlatTree } from "../src/composables/useFlatTree.ts";
import type { TreeNode } from "../src/types/database.ts";

test("flattenTree preserves depth and node type for virtualized sidebar rows", () => {
  const nodes: TreeNode[] = [
    {
      id: "conn",
      label: "Connection",
      type: "connection",
      isExpanded: true,
      children: [
        { id: "conn:file", label: "Query.sql", type: "saved-sql-file" },
        {
          id: "conn:db",
          label: "db",
          type: "database",
          isExpanded: true,
          children: [{ id: "conn:db:table", label: "table", type: "table" }],
        },
      ],
    },
  ];

  const flat = flattenTree(nodes);

  assert.deepEqual(
    flat.map((item) => ({ id: item.id, depth: item.depth, type: item.type })),
    [
      { id: "conn", depth: 0, type: "connection" },
      { id: "conn:file", depth: 1, type: "saved-sql-file" },
      { id: "conn:db", depth: 1, type: "database" },
      { id: "conn:db:table", depth: 2, type: "table" },
    ],
  );
});

test("shouldVirtualizeFlatTree only virtualizes very large sidebar trees", () => {
  assert.equal(shouldVirtualizeFlatTree(99), false);
  assert.equal(shouldVirtualizeFlatTree(100), true);
});
