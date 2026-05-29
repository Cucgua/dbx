import assert from "node:assert/strict";
import test from "node:test";
import type { Backend, ConnectionConfig } from "@dbx-app/node-core";
import { createDbxMcpServer } from "../src/index.js";

const connection: ConnectionConfig = {
  id: "1",
  name: "local",
  db_type: "postgres",
  host: "127.0.0.1",
  port: 5432,
  username: "app",
  password: "",
  database: "demo",
  ssh_enabled: false,
  ssl: false,
};

const backend: Backend = {
  loadConnections: async () => [connection],
  findConnection: async (name) => (name === "local" ? connection : undefined),
  addConnection: async () => connection,
  removeConnection: async () => true,
  listTables: async () => [{ name: "users", type: "BASE TABLE" }],
  describeTable: async () => [
    { name: "id", data_type: "integer", is_nullable: false, column_default: null, is_primary_key: true, comment: null },
  ],
  executeQuery: async () => ({ columns: ["total"], rows: [{ total: 1 }], row_count: 1 }),
};

test("creates an MCP server without starting stdio transport", () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  assert.equal(typeof server.connect, "function");
});

test("execute query scopes the connection to the requested database", async () => {
  let usedDatabase = "";
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async (config) => {
      usedDatabase = config.database || "";
      return { columns: ["total"], rows: [{ total: 1 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    database: "stores_demo",
    sql: "SELECT FIRST 1 tabname FROM systables",
  });

  assert.equal(usedDatabase, "stores_demo");
});

test("mongodb list tables returns collections from the selected database", async () => {
  let usedDatabase = "";
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb", database: "admin" };
  const scopedBackend: Backend = {
    ...backend,
    findConnection: async () => mongoConnection,
    listTables: async (config) => {
      usedDatabase = config.database || "";
      return [{ name: "projects", type: "COLLECTION" }];
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_name: "local",
    database: "pystrument",
  });

  assert.equal(usedDatabase, "pystrument");
  assert.match(result.content[0].text, /projects/);
  assert.match(result.content[0].text, /COLLECTION/);
});

test("mongodb describe table returns inferred document fields", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    findConnection: async () => mongoConnection,
    describeTable: async () => [
      { name: "_id", data_type: "object", is_nullable: false, column_default: null, is_primary_key: true, comment: null },
      { name: "name", data_type: "string", is_nullable: false, column_default: null, is_primary_key: false, comment: null },
    ],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_describe_table.handler({
    connection_name: "local",
    database: "pystrument",
    table: "projects",
  });

  assert.match(result.content[0].text, /_id \(PK\)/);
  assert.match(result.content[0].text, /name/);
});

test("mongodb execute query formats shell-style find results", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    findConnection: async () => mongoConnection,
    executeQuery: async () => ({ columns: ["_id", "name"], rows: [{ _id: "1", name: "demo" }], row_count: 1 }),
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    database: "pystrument",
    sql: "db.projects.find({}).limit(1)",
  });

  assert.match(result.content[0].text, /demo/);
  assert.match(result.content[0].text, /1 row\(s\)/);
});

test("mongodb execute-and-show blocks aggregate write stages before desktop bridge", async () => {
  const oldAllowWrites = process.env.DBX_MCP_ALLOW_WRITES;
  const oldAllowDangerous = process.env.DBX_MCP_ALLOW_DANGEROUS_SQL;
  delete process.env.DBX_MCP_ALLOW_WRITES;
  delete process.env.DBX_MCP_ALLOW_DANGEROUS_SQL;
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    findConnection: async () => mongoConnection,
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: false });

  try {
    const result = await (server as any)._registeredTools.dbx_execute_and_show.handler({
      connection_name: "local",
      database: "pystrument",
      sql: 'db.projects.aggregate([{"$out":"projects_dump"}])',
    });

    assert.match(result.content[0].text, /Query blocked:/);
    assert.match(result.content[0].text, /DBX_MCP_ALLOW_WRITES=1/);
  } finally {
    if (oldAllowWrites === undefined) delete process.env.DBX_MCP_ALLOW_WRITES;
    else process.env.DBX_MCP_ALLOW_WRITES = oldAllowWrites;
    if (oldAllowDangerous === undefined) delete process.env.DBX_MCP_ALLOW_DANGEROUS_SQL;
    else process.env.DBX_MCP_ALLOW_DANGEROUS_SQL = oldAllowDangerous;
  }
});
