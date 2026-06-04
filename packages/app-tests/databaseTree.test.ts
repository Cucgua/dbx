import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatabaseTreeNodes,
  buildDuckDbConnectionTreeNodes,
  shouldIncludeDefaultDatabaseNode,
} from "../../apps/desktop/src/lib/databaseTree.ts";

test("设置默认库后侧边栏数据库树仍保留全部数据库", () => {
  const nodes = buildDatabaseTreeNodes("conn-1", [{ name: "campaign_data" }, { name: "cms" }, { name: "mk_campaign" }]);

  assert.deepEqual(
    nodes.map((node) => node.database),
    ["campaign_data", "cms", "mk_campaign"],
  );
  assert.equal(nodes.find((node) => node.database === "mk_campaign")?.id, "conn-1:mk_campaign");
});

test("catalogless database metadata gets a visible default node", () => {
  const nodes = buildDatabaseTreeNodes("conn-1", [{ name: "   " }], { includeDefaultWhenEmpty: true });

  assert.deepEqual(nodes, [
    {
      id: "conn-1:",
      label: "tree.defaultDatabase",
      type: "database",
      connectionId: "conn-1",
      database: "",
      isExpanded: false,
      children: [],
    },
  ]);
});

test("tree schema mode can show a default node when no catalog is returned", () => {
  const nodes = buildDatabaseTreeNodes("conn-1", [], { includeDefaultWhenEmpty: true });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].database, "");
  assert.equal(nodes[0].label, "tree.defaultDatabase");
});

test("MySQL-compatible catalogless services can opt into the default database node", () => {
  assert.equal(shouldIncludeDefaultDatabaseNode({ db_type: "mysql" }, [{ name: "" }]), true);
  assert.equal(shouldIncludeDefaultDatabaseNode({ db_type: "mysql" }, [{ name: "app" }]), false);
  assert.equal(shouldIncludeDefaultDatabaseNode({ db_type: "postgres" }, [{ name: "" }]), false);
});

test("DuckDB shows primary catalog schemas directly under the connection", () => {
  const nodes = buildDuckDbConnectionTreeNodes(
    "conn-1",
    [{ name: "main" }, { name: "attached_reports" }],
    ["main", "mysql", "prod_sales"],
  );

  assert.deepEqual(
    nodes.map((node) => [node.type, node.label, node.database, node.schema]),
    [
      ["schema", "main", "main", "main"],
      ["schema", "mysql", "main", "mysql"],
      ["schema", "prod_sales", "main", "prod_sales"],
      ["database", "attached_reports", "attached_reports", undefined],
    ],
  );
  assert.equal(nodes.find((node) => node.label === "mysql")?.id, "conn-1:main:mysql");
});
