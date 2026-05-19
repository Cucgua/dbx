import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildExecutableObjectSourceSql,
  buildExecutableObjectSourceStatements,
  buildRoutineRenameObjectSourceStatements,
  objectSourceSaveExecutionMode,
  supportsSourceBackedRoutineRename,
} from "../../apps/desktop/src/lib/objectSourceEditor.ts";

test("SQL Server edited source saves as ALTER", () => {
  const sql = buildExecutableObjectSourceSql({
    databaseType: "sqlserver",
    objectType: "PROCEDURE",
    schema: "dbo",
    name: "usp_demo",
    source: "CREATE PROCEDURE dbo.usp_demo AS SELECT 1;",
  });

  assert.equal(sql, "ALTER PROCEDURE dbo.usp_demo AS SELECT 1;");
});

test("SQL Server edited CREATE OR ALTER source saves as ALTER", () => {
  const sql = buildExecutableObjectSourceSql({
    databaseType: "sqlserver",
    objectType: "VIEW",
    schema: "dbo",
    name: "vw_demo",
    source: "CREATE OR ALTER VIEW dbo.vw_demo AS SELECT 1 AS id;",
  });

  assert.equal(sql, "ALTER VIEW dbo.vw_demo AS SELECT 1 AS id;");
});

test("SQL Server object source saves as a single batch", () => {
  assert.equal(objectSourceSaveExecutionMode("sqlserver"), "single");
});

test("Kingbase object source saves as a single statement", () => {
  assert.equal(objectSourceSaveExecutionMode("kingbase"), "single");
});

test("Postgres-family object source saves as a single statement", () => {
  assert.equal(objectSourceSaveExecutionMode("postgres"), "single");
  assert.equal(objectSourceSaveExecutionMode("gaussdb"), "single");
});

test("MySQL object source saves as a single statement", () => {
  assert.equal(objectSourceSaveExecutionMode("mysql"), "single");
});

test("Postgres view body opens as CREATE OR REPLACE VIEW", () => {
  const sql = buildExecutableObjectSourceSql({
    databaseType: "postgres",
    objectType: "VIEW",
    schema: "public",
    name: "active users",
    source: " SELECT id, name FROM users WHERE active ",
  });

  assert.equal(sql, 'CREATE OR REPLACE VIEW "public"."active users" AS\nSELECT id, name FROM users WHERE active;');
});

test("Kingbase function rename creates the renamed routine and then drops the original routine", () => {
  const statements = buildExecutableObjectSourceStatements({
    databaseType: "kingbase",
    objectType: "FUNCTION",
    schema: "DLJPM",
    name: "CONVERTSPECIALNAME",
    source:
      'CREATE OR REPLACE function "DLJPM"."CONVERTSPECIALNAME1" (SpName varchar2)\nRETURN VARCHAR2\nas\nbegin\nreturn SpName;\nend;',
  });

  assert.deepEqual(statements, [
    'CREATE OR REPLACE function "DLJPM"."CONVERTSPECIALNAME1" (SpName varchar2)\nRETURN VARCHAR2\nas\nbegin\nreturn SpName;\nend;',
    'DROP FUNCTION IF EXISTS "DLJPM"."CONVERTSPECIALNAME"(SpName varchar2);',
  ]);
});

test("Postgres procedure rename creates the renamed routine and then drops the original routine", () => {
  const statements = buildExecutableObjectSourceStatements({
    databaseType: "postgres",
    objectType: "PROCEDURE",
    schema: "public",
    name: "refresh_cache",
    source: 'CREATE OR REPLACE PROCEDURE "public"."refresh_cache_v2"(mode text)\nLANGUAGE SQL\nAS $$ SELECT 1 $$;',
  });

  assert.deepEqual(statements, [
    'CREATE OR REPLACE PROCEDURE "public"."refresh_cache_v2"(mode text)\nLANGUAGE SQL\nAS $$ SELECT 1 $$;',
    'DROP PROCEDURE IF EXISTS "public"."refresh_cache"(mode text);',
  ]);
});

test("object source SQL joins generated save statements for previews", () => {
  const sql = buildExecutableObjectSourceSql({
    databaseType: "postgres",
    objectType: "PROCEDURE",
    schema: "public",
    name: "refresh_cache",
    source: 'CREATE OR REPLACE PROCEDURE "public"."refresh_cache_v2"(mode text)\nLANGUAGE SQL\nAS $$ SELECT 1 $$;',
  });

  assert.equal(
    sql,
    'CREATE OR REPLACE PROCEDURE "public"."refresh_cache_v2"(mode text)\nLANGUAGE SQL\nAS $$ SELECT 1 $$;\nDROP PROCEDURE IF EXISTS "public"."refresh_cache"(mode text);',
  );
});

test("Oracle and Dameng object source saves as semicolon-terminated source", () => {
  assert.equal(
    buildExecutableObjectSourceSql({
      databaseType: "oracle",
      objectType: "VIEW",
      schema: "HR",
      name: "ACTIVE_USERS",
      source: "CREATE OR REPLACE VIEW HR.ACTIVE_USERS AS SELECT ID FROM USERS",
    }),
    "CREATE OR REPLACE VIEW HR.ACTIVE_USERS AS SELECT ID FROM USERS;",
  );

  assert.equal(
    buildExecutableObjectSourceSql({
      databaseType: "dameng",
      objectType: "PROCEDURE",
      schema: "SYSDBA",
      name: "REFRESH_CACHE",
      source: "CREATE OR REPLACE PROCEDURE SYSDBA.REFRESH_CACHE AS BEGIN SELECT 1; END;",
    }),
    "CREATE OR REPLACE PROCEDURE SYSDBA.REFRESH_CACHE AS BEGIN SELECT 1; END;",
  );
});

test("MySQL routine rename creates the renamed routine and drops the original routine", () => {
  const statements = buildExecutableObjectSourceStatements({
    databaseType: "mysql",
    objectType: "PROCEDURE",
    schema: "app",
    name: "refresh_cache",
    source: "CREATE DEFINER=`root`@`%` PROCEDURE `refresh_cache_v2`(IN mode_name varchar(20)) BEGIN SELECT 1; END",
  });

  assert.deepEqual(statements, [
    "CREATE DEFINER=`root`@`%` PROCEDURE `refresh_cache_v2`(IN mode_name varchar(20)) BEGIN SELECT 1; END;",
    "DROP PROCEDURE IF EXISTS `app`.`refresh_cache`;",
  ]);
});

test("Oracle-family routine rename rewrites source and drops the original routine", () => {
  assert.equal(supportsSourceBackedRoutineRename("dameng", "PROCEDURE"), true);
  assert.equal(supportsSourceBackedRoutineRename("oracle", "FUNCTION"), true);

  const statements = buildRoutineRenameObjectSourceStatements({
    databaseType: "dameng",
    objectType: "PROCEDURE",
    schema: "SYSDBA",
    name: "SP_TAB_BAKSET_REMOVE_BATCH",
    newName: "SP_TAB_BAKSET_REMOVE_BATCH_2",
    source:
      'CREATE OR REPLACE PROCEDURE "SYSDBA"."SP_TAB_BAKSET_REMOVE_BATCH" AS\nBEGIN\n  SELECT 1;\nEND;',
  });

  assert.deepEqual(statements, [
    'CREATE OR REPLACE PROCEDURE "SYSDBA"."SP_TAB_BAKSET_REMOVE_BATCH_2" AS\nBEGIN\n  SELECT 1;\nEND;',
    'DROP PROCEDURE "SYSDBA"."SP_TAB_BAKSET_REMOVE_BATCH";',
  ]);
});
