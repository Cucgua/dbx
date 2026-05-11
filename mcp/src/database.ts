import type { ConnectionConfig } from "./connections.js";
import { createServer, connect as netConnect, type Server, type Socket } from "node:net";

export interface TableInfo {
  name: string;
  type: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  comment: string | null;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

const MAX_ROWS = 100;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const QUERY_TIMEOUT_MS = 30_000;

interface PoolEntry {
  type: "pg" | "mysql";
  pool: unknown;
  timer: ReturnType<typeof setTimeout>;
}

const pools = new Map<string, PoolEntry>();
const proxyTunnels = new Map<string, { server: Server; port: number }>();

function poolKey(config: ConnectionConfig): string {
  return `${config.id}:${config.database || ""}`;
}

function evictPool(key: string, entry: PoolEntry) {
  pools.delete(key);
  if (entry.type === "pg") {
    (entry.pool as import("pg").Pool).end().catch(() => {});
  } else {
    (entry.pool as import("mysql2/promise").Pool).end().catch(() => {});
  }
}

function resetIdleTimer(key: string, entry: PoolEntry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => evictPool(key, entry), IDLE_TIMEOUT_MS);
}

async function getPgPool(config: ConnectionConfig): Promise<import("pg").Pool> {
  const key = poolKey(config);
  const existing = pools.get(key);
  if (existing?.type === "pg") {
    resetIdleTimer(key, existing);
    return existing.pool as import("pg").Pool;
  }

  const pg = await import("pg");
  const endpoint = await connectionEndpoint(config);
  const pool = new pg.default.Pool({
    connectionString: buildConnectionUrl(config, endpoint),
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", () => {});
  const entry: PoolEntry = { type: "pg", pool, timer: setTimeout(() => {}, 0) };
  pools.set(key, entry);
  resetIdleTimer(key, entry);
  return pool;
}

async function getMysqlPool(config: ConnectionConfig): Promise<import("mysql2/promise").Pool> {
  const key = poolKey(config);
  const existing = pools.get(key);
  if (existing?.type === "mysql") {
    resetIdleTimer(key, existing);
    return existing.pool as import("mysql2/promise").Pool;
  }

  const mysql = await import("mysql2/promise");
  const endpoint = await connectionEndpoint(config);
  const pool = mysql.default.createPool({
    uri: buildConnectionUrl(config, endpoint),
    connectionLimit: 3,
    idleTimeout: 30_000,
    connectTimeout: 10_000,
  });
  const entry: PoolEntry = { type: "mysql", pool, timer: setTimeout(() => {}, 0) };
  pools.set(key, entry);
  resetIdleTimer(key, entry);
  return pool;
}

async function connectionEndpoint(config: ConnectionConfig): Promise<{ host: string; port: number }> {
  if (!config.proxy_enabled || !config.proxy_host) return { host: config.host, port: config.port };
  const existing = proxyTunnels.get(config.id);
  if (existing) return { host: "127.0.0.1", port: existing.port };

  const server = createServer((inbound) => {
    connectViaProxy(config)
      .then((outbound) => {
        inbound.pipe(outbound);
        outbound.pipe(inbound);
      })
      .catch(() => inbound.destroy());
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Failed to bind proxy tunnel"));
    });
  });
  proxyTunnels.set(config.id, { server, port });
  return { host: "127.0.0.1", port };
}

function buildConnectionUrl(config: ConnectionConfig, endpoint: { host: string; port: number }): string {
  const db = config.database || "";
  const params = config.url_params || "";
  const suffix = params ? `?${params}` : "";
  if (isMysqlType(config.db_type)) {
    return `mysql://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${endpoint.host}:${endpoint.port}/${db}${suffix}`;
  }
  return `postgres://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${endpoint.host}:${endpoint.port}/${db}${suffix}`;
}

function connectViaProxy(config: ConnectionConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(config.proxy_port || 1080, config.proxy_host || "127.0.0.1");
    socket.once("error", reject);
    socket.once("connect", () => {
      if ((config.proxy_type || "socks5") === "http") {
        httpConnect(socket, config, resolve, reject);
      } else {
        socks5Connect(socket, config, resolve, reject);
      }
    });
  });
}

function httpConnect(socket: Socket, config: ConnectionConfig, resolve: (socket: Socket) => void, reject: (err: Error) => void) {
  const target = `${config.host}:${config.port}`;
  const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`];
  if (config.proxy_username || config.proxy_password) {
    const token = Buffer.from(`${config.proxy_username || ""}:${config.proxy_password || ""}`).toString("base64");
    lines.push(`Proxy-Authorization: Basic ${token}`);
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  let buffer = Buffer.alloc(0);
  socket.on("data", function onData(chunk: Buffer) {
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    socket.off("data", onData);
    const head = buffer.subarray(0, end).toString("utf8");
    if (!/^HTTP\/1\.[01] 200\b/.test(head)) {
      reject(new Error(`HTTP proxy CONNECT failed: ${head.split("\r\n")[0] || "invalid response"}`));
      socket.destroy();
      return;
    }
    const rest = buffer.subarray(end + 4);
    if (rest.length) socket.unshift(rest);
    resolve(socket);
  });
}

function socks5Connect(socket: Socket, config: ConnectionConfig, resolve: (socket: Socket) => void, reject: (err: Error) => void) {
  const wantsAuth = !!(config.proxy_username || config.proxy_password);
  socket.write(Buffer.from(wantsAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
  socket.once("data", (method) => {
    if (method.length < 2 || method[0] !== 0x05) {
      reject(new Error("Invalid SOCKS greeting"));
      socket.destroy();
      return;
    }
    if (method[1] === 0x02) {
      const user = Buffer.from(config.proxy_username || "");
      const pass = Buffer.from(config.proxy_password || "");
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      socket.once("data", (auth) => {
        if (auth.length < 2 || auth[1] !== 0x00) {
          reject(new Error("SOCKS proxy authentication failed"));
          socket.destroy();
          return;
        }
        sendSocksConnect(socket, config, resolve, reject);
      });
    } else if (method[1] === 0x00) {
      sendSocksConnect(socket, config, resolve, reject);
    } else {
      reject(new Error("SOCKS proxy rejected authentication methods"));
      socket.destroy();
    }
  });
}

function sendSocksConnect(socket: Socket, config: ConnectionConfig, resolve: (socket: Socket) => void, reject: (err: Error) => void) {
  const host = Buffer.from(config.host);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, portBytes(config.port)]));
  socket.once("data", (res) => {
    if (res.length < 4 || res[0] !== 0x05 || res[1] !== 0x00) {
      reject(new Error(`SOCKS proxy connect failed with code ${res[1] ?? "unknown"}`));
      socket.destroy();
      return;
    }
    resolve(socket);
  });
}

function portBytes(port: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(port);
  return buf;
}

function isMysqlType(dbType: string): boolean {
  return dbType === "mysql" || dbType === "doris" || dbType === "starrocks";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function queryWithRetry(config: ConnectionConfig, fn: () => Promise<QueryResult>): Promise<QueryResult> {
  try {
    return await withTimeout(fn(), QUERY_TIMEOUT_MS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const retriable = /terminating connection|Connection lost|ECONNRESET|EPIPE|connection refused/i.test(msg);
    if (retriable) {
      const key = poolKey(config);
      const entry = pools.get(key);
      if (entry) evictPool(key, entry);
      return withTimeout(fn(), QUERY_TIMEOUT_MS);
    }
    throw e;
  }
}

async function pgQuery(config: ConnectionConfig, sql: string, params?: unknown[]): Promise<QueryResult> {
  return queryWithRetry(config, async () => {
    const pool = await getPgPool(config);
    const result = await pool.query(sql, params);
    const rows = (result.rows || []).slice(0, MAX_ROWS);
    return { columns: result.fields?.map((f) => f.name) ?? [], rows, row_count: rows.length };
  });
}

async function mysqlQuery(config: ConnectionConfig, sql: string, params?: unknown[]): Promise<QueryResult> {
  return queryWithRetry(config, async () => {
    const pool = await getMysqlPool(config);
    const [results, fields] = await pool.query(sql, params);
    const rows = (Array.isArray(results) ? results : []).slice(0, MAX_ROWS) as Record<string, unknown>[];
    return { columns: (fields as Array<{ name: string }>)?.map((f) => f.name) ?? [], rows, row_count: rows.length };
  });
}

async function query(config: ConnectionConfig, sql: string, params?: unknown[]): Promise<QueryResult> {
  if (isMysqlType(config.db_type)) return mysqlQuery(config, sql, params);
  return pgQuery(config, sql, params);
}

export async function executeQuery(config: ConnectionConfig, sql: string): Promise<QueryResult> {
  return query(config, sql);
}

export async function listTables(config: ConnectionConfig, schema?: string): Promise<TableInfo[]> {
  let result: QueryResult;
  if (isMysqlType(config.db_type)) {
    result = await query(config, `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
  } else {
    result = await query(
      config,
      `SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schema || "public"],
    );
  }
  return result.rows.map((r) => ({ name: String(r.name || r.NAME), type: String(r.type || r.TYPE || "TABLE") }));
}

export async function describeTable(config: ConnectionConfig, table: string, schema?: string): Promise<ColumnInfo[]> {
  let result: QueryResult;
  if (isMysqlType(config.db_type)) {
    result = await query(
      config,
      `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS data_type, c.IS_NULLABLE = 'YES' AS is_nullable, c.COLUMN_DEFAULT AS column_default, c.COLUMN_KEY = 'PRI' AS is_primary_key, c.COLUMN_COMMENT AS comment FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ? ORDER BY c.ORDINAL_POSITION`,
      [table],
    );
  } else {
    result = await query(
      config,
      `SELECT c.column_name AS name, c.data_type, c.is_nullable = 'YES' AS is_nullable, c.column_default, CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END AS is_primary_key, col_description(cls.oid, c.ordinal_position) AS comment FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage kcu ON kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name LEFT JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.constraint_type = 'PRIMARY KEY' LEFT JOIN pg_class cls ON cls.relname = c.table_name AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema) WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`,
      [schema || "public", table],
    );
  }
  return result.rows.map((r) => ({
    name: String(r.name || ""),
    data_type: String(r.data_type || ""),
    is_nullable: Boolean(r.is_nullable),
    column_default: r.column_default != null ? String(r.column_default) : null,
    is_primary_key: Boolean(r.is_primary_key),
    comment: r.comment != null ? String(r.comment) : null,
  }));
}
