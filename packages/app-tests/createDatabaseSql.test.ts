import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateDatabaseSql,
  buildDuckDbAttachDatabaseSql,
  duckDbAttachedDatabaseNameFromPath,
  uniqueDuckDbAttachedDatabaseName,
  supportsCreateDatabaseCharset,
} from "../../apps/desktop/src/lib/createDatabaseSql.ts";

test("builds MySQL create database SQL with charset and collation", () => {
  assert.equal(
    buildCreateDatabaseSql({
      databaseType: "mysql",
      driverProfile: "mysql",
      name: "app db",
      charset: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
    }),
    "CREATE DATABASE `app db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
  );
});

test("omits charset clauses for non-MySQL database types", () => {
  assert.equal(
    buildCreateDatabaseSql({
      databaseType: "postgres",
      name: "analytics",
      charset: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
    }),
    'CREATE DATABASE "analytics";',
  );
});

test("recognizes MySQL-compatible driver profiles", () => {
  assert.equal(supportsCreateDatabaseCharset("mysql", "oceanbase"), true);
  assert.equal(supportsCreateDatabaseCharset("mysql", "doris"), true);
  assert.equal(supportsCreateDatabaseCharset("postgres", undefined), false);
});

test("builds DuckDB attach SQL with escaped path and alias", () => {
  assert.equal(
    buildDuckDbAttachDatabaseSql("/Users/me/O'Reilly analytics.duckdb", "report db"),
    `ATTACH '/Users/me/O''Reilly analytics.duckdb' AS "report db";`,
  );
});

test("derives a stable DuckDB attached database name from a file path", () => {
  assert.equal(duckDbAttachedDatabaseNameFromPath("/Users/me/sales.duckdb"), "sales");
  assert.equal(duckDbAttachedDatabaseNameFromPath("C:\\data\\2026 report.db"), "2026_report");
  assert.equal(duckDbAttachedDatabaseNameFromPath("/tmp/.duckdb"), "duckdb_database");
});

test("deduplicates DuckDB attached database aliases", () => {
  assert.equal(uniqueDuckDbAttachedDatabaseName("analytics", ["main", "analytics"]), "analytics_2");
  assert.equal(uniqueDuckDbAttachedDatabaseName("analytics", ["analytics", "analytics_2"]), "analytics_3");
});
