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
