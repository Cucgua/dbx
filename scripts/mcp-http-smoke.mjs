#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const statusPath = process.env.DBX_MCP_STATUS || join(appData, "com.dbx.app", "mcp-http.json");
const status = JSON.parse(await readFile(statusPath, "utf8"));

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${status.token}`,
};

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "dbx-smoke", version: "0.1.0" },
  },
};

const response = await fetch(status.endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(initialize),
});

console.log(response.status);
console.log(await response.text());
