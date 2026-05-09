import test from "node:test";
import assert from "node:assert/strict";
import { buildSqlServerDatabaseTreeNodes } from "../src/lib/sqlServerTree.ts";
import type { TableInfo } from "../src/types/database.ts";

function table(name: string, tableType = "BASE TABLE"): TableInfo {
  return {
    name,
    table_type: tableType,
  };
}

test("SQL Server database tree flattens dbo tables and keeps non-default schemas", () => {
  const nodes = buildSqlServerDatabaseTreeNodes(
    "conn",
    "app",
    ["dbo", "sales"],
    [table("customers"), table("customer_view", "VIEW")],
  );

  assert.deepEqual(
    nodes.map((node) => ({ id: node.id, label: node.label, type: node.type, schema: node.schema })),
    [
      { id: "conn:app:dbo:customers", label: "customers", type: "table", schema: "dbo" },
      { id: "conn:app:dbo:customer_view", label: "customer_view", type: "view", schema: "dbo" },
      { id: "conn:app:sales", label: "sales", type: "schema", schema: "sales" },
    ],
  );
});

test("SQL Server database tree hides default schema node when dbo has no tables", () => {
  const nodes = buildSqlServerDatabaseTreeNodes("conn", "app", ["dbo", "archive"], []);

  assert.deepEqual(
    nodes.map((node) => ({ id: node.id, label: node.label, type: node.type, schema: node.schema })),
    [{ id: "conn:app:archive", label: "archive", type: "schema", schema: "archive" }],
  );
});
