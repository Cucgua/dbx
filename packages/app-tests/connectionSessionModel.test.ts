import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const connectionSource = readFileSync("crates/dbx-core/src/connection.rs", "utf8");
const querySource = readFileSync("crates/dbx-core/src/query.rs", "utf8");
const queryStoreSource = readFileSync("apps/desktop/src/stores/queryStore.ts", "utf8");
const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriApiSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpApiSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const tauriCommandSource = readFileSync("src-tauri/src/commands/query.rs", "utf8");
const webRouteSource = readFileSync("crates/dbx-web/src/routes/query.rs", "utf8");
const mysqlSource = readFileSync("crates/dbx-core/src/db/mysql.rs", "utf8");
const postgresSource = readFileSync("crates/dbx-core/src/db/postgres.rs", "utf8");

test("query tabs pass a stable client session id to backend execution", () => {
  assert.match(queryStoreSource, /clientSessionId: tab\.id/);
  assert.match(queryStoreSource, /closeQuerySession\(tab\.connectionId, tab\.database, sessionId, tab\.id\)/);
  assert.match(apiSource, /closeClientConnectionSession = forward\("closeClientConnectionSession"\)/);
  assert.match(tauriApiSource, /clientSessionId\?: string/);
  assert.match(httpApiSource, /clientSessionId\?: string/);
  assert.match(tauriCommandSource, /client_session_id: Option<String>/);
  assert.match(webRouteSource, /pub client_session_id: Option<String>/);
});

test("backend scopes query pools by client session and can close them", () => {
  assert.match(connectionSource, /get_or_create_pool_for_session/);
  assert.match(connectionSource, /session_scoped_pool_key/);
  assert.match(connectionSource, /close_client_session_pool/);
  assert.match(querySource, /client_session_id: Option<String>/);
  assert.match(querySource, /get_or_create_pool_for_session\(connection_id, Some\(database\), options\.client_session_id\.as_deref\(\)\)/);
  assert.match(querySource, /close_query_session\([\s\S]*client_session_id: Option<&str>/);
  assert.match(querySource, /execute_sql_statement_with_options\([\s\S]*options\.clone\(\)/);
});

test("native SQL query sessions use a single physical connection", () => {
  assert.match(mysqlSource, /PoolConstraints::new\(1, 1\)/);
  assert.match(postgresSource, /\.max_size\(1\)/);
});
