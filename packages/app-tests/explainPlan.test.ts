import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  flattenExplainPlanNodes,
  parseExplainResult,
  supportsExplainPlan,
} from "../../apps/desktop/src/lib/explainPlan.ts";

const explainPlanSource = readFileSync("apps/desktop/src/lib/explainPlan.ts", "utf8");
const queryStoreSource = readFileSync("apps/desktop/src/stores/queryStore.ts", "utf8");
const apiSource = readFileSync("apps/desktop/src/lib/api.ts", "utf8");
const tauriSource = readFileSync("apps/desktop/src/lib/tauri.ts", "utf8");
const httpSource = readFileSync("apps/desktop/src/lib/http.ts", "utf8");
const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const webMainSource = readFileSync("crates/dbx-web/src/main.rs", "utf8");
const rustSource = readFileSync("crates/dbx-core/src/query_execution_sql.rs", "utf8");

test("frontend explain SQL builder delegates executable SQL wrapping to backend API", () => {
  assert.match(explainPlanSource, /return api\.buildExplainSql\(\{ databaseType, sql \}\)/);
  assert.doesNotMatch(explainPlanSource, /EXPLAIN \(FORMAT JSON\)|EXPLAIN FORMAT=JSON|SAFE_EXPLAIN_RE|stripSqlComments/);
  assert.match(queryStoreSource, /await buildExplainSql\(databaseType, sql\)/);
});

test("reports explain support by database type", () => {
  assert.equal(supportsExplainPlan("postgres"), true);
  assert.equal(supportsExplainPlan("mysql"), true);
  assert.equal(supportsExplainPlan("sqlite"), false);
});

test("shared API exposes backend explain SQL builder", () => {
  assert.match(apiSource, /export const buildExplainSql = forward\("buildExplainSql"\)/);
  assert.match(tauriSource, /invoke\("build_explain_sql"/);
  assert.match(httpSource, /\/api\/query\/build-explain-sql/);
  assert.match(tauriLibSource, /commands::query::build_explain_sql/);
  assert.match(webMainSource, /\/query\/build-explain-sql/);
});

test("Rust query execution SQL exposes explain builder", () => {
  assert.match(rustSource, /pub fn build_explain_sql/);
  assert.match(rustSource, /EXPLAIN \(FORMAT JSON\)/);
  assert.match(rustSource, /EXPLAIN FORMAT=JSON/);
});

test("parses PostgreSQL FORMAT JSON output into plan nodes", () => {
  const plan = parseExplainResult("postgres", {
    columns: ["QUERY PLAN"],
    rows: [[[
      {
        Plan: {
          "Node Type": "Nested Loop",
          "Startup Cost": 0.42,
          "Total Cost": 42.9,
          "Plan Rows": 12,
          Plans: [
            {
              "Node Type": "Index Scan",
              "Relation Name": "users",
              "Index Name": "users_pkey",
              "Startup Cost": 0.28,
              "Total Cost": 8.3,
              "Plan Rows": 1,
            },
            {
              "Node Type": "Seq Scan",
              "Relation Name": "orders",
              "Filter": "(user_id = users.id)",
              "Total Cost": 31.2,
              "Plan Rows": 20,
            },
          ],
        },
      },
    ]]],
    affected_rows: 0,
    execution_time_ms: 3,
  });

  assert.equal(plan.nodes[0].title, "Nested Loop");
  assert.equal(plan.nodes[0].cost, "0.42..42.9");
  assert.equal(plan.nodes[0].rows, "12");
  assert.equal(plan.nodes[0].children[0].relation, "users");
  assert.equal(plan.nodes[0].children[0].index, "users_pkey");
  assert.equal(flattenExplainPlanNodes(plan.nodes).map((node) => node.nodeType).join(","), "Nested Loop,Index Scan,Seq Scan");
});

test("parses MySQL FORMAT=JSON output into plan nodes", () => {
  const plan = parseExplainResult("mysql", {
    columns: ["EXPLAIN"],
    rows: [[JSON.stringify({
      query_block: {
        select_id: 1,
        nested_loop: [
          {
            table: {
              table_name: "users",
              access_type: "ref",
              key: "idx_users_email",
              rows_examined_per_scan: 3,
              cost_info: { query_cost: "1.20" },
              attached_condition: "users.email is not null",
            },
          },
          {
            table: {
              table_name: "orders",
              access_type: "ALL",
              rows_examined_per_scan: 200,
              cost_info: { read_cost: "18.00" },
            },
          },
        ],
      },
    })]],
    affected_rows: 0,
    execution_time_ms: 2,
  });

  const flat = flattenExplainPlanNodes(plan.nodes);
  assert.equal(flat[0].nodeType, "query_block");
  assert.equal(flat[1].title, "ref on users");
  assert.equal(flat[1].index, "idx_users_email");
  assert.equal(flat[1].cost, "1.20");
  assert.equal(flat[2].rows, "200");
});
