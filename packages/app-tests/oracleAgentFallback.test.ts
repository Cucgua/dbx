import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coreConnectionSource = readFileSync(new URL("../../crates/dbx-core/src/connection.rs", import.meta.url), "utf8");
const tauriConnectionSource = readFileSync(
  new URL("../../src-tauri/src/commands/connection.rs", import.meta.url),
  "utf8",
);

test("Oracle agent fallback helper is shared with Tauri connection commands", () => {
  assert.match(coreConnectionSource, /pub fn should_retry_oracle_with_10g_driver/);
  assert.match(tauriConnectionSource, /should_retry_oracle_with_10g_driver/);
});

test("connection test retries Oracle listener errors with the 10g profile", () => {
  assert.match(tauriConnectionSource, /async fn test_agent_connection/);
  assert.match(
    tauriConnectionSource,
    /call_daemon_method::<serde_json::Value>\([\s\S]*?AgentMethod::TestConnection[\s\S]*?should_retry_oracle_with_10g_driver/,
  );
  assert.match(tauriConnectionSource, /Some\("oracle-10g"\)/);
});

test("initial connect retries Oracle listener errors with the 10g profile", () => {
  assert.match(tauriConnectionSource, /async fn connect_agent_pool/);
  assert.match(
    tauriConnectionSource,
    /call_method::<serde_json::Value>\([\s\S]*?AgentMethod::Connect[\s\S]*?should_retry_oracle_with_10g_driver/,
  );
});
