import assert from "node:assert/strict";
import test from "node:test";
import { isDefaultDatabase, resolveDefaultDatabase } from "../src/lib/defaultDatabase.ts";

test("优先使用连接上已保存的默认数据库", () => {
  assert.equal(
    resolveDefaultDatabase({ db_type: "mysql", database: "app", default_database: "analytics" }, [
      "app",
      "analytics",
    ]),
    "analytics",
  );
});

test("兼容旧连接配置里的数据库字段作为默认库", () => {
  assert.equal(
    resolveDefaultDatabase({ db_type: "mysql", database: "analytics" }, ["app", "analytics"]),
    "analytics",
  );
  assert.equal(
    resolveDefaultDatabase({ db_type: "mysql", database: "analytics", default_database: null }, ["app"]),
    "analytics",
  );
});

test("默认数据库为空时回退到首个可选数据库", () => {
  assert.equal(resolveDefaultDatabase({ db_type: "mysql", database: undefined }, ["app", "analytics"]), "app");
});

test("没有默认数据库且无候选项时返回空字符串", () => {
  assert.equal(resolveDefaultDatabase({ db_type: "mysql", database: undefined }, []), "");
});

test("Oracle 不把连接 Service/SID 当成默认库", () => {
  assert.equal(resolveDefaultDatabase({ db_type: "oracle", database: "ORCL" }, ["MCHS"]), "MCHS");
  assert.equal(resolveDefaultDatabase({ db_type: "oracle", database: "ORCL" }, []), "");
});

test("判断当前数据库是否为默认数据库", () => {
  assert.equal(
    isDefaultDatabase({ db_type: "mysql", database: "app", default_database: "analytics" }, "analytics"),
    true,
  );
  assert.equal(
    isDefaultDatabase({ db_type: "mysql", database: "app", default_database: "analytics" }, "app"),
    false,
  );
  assert.equal(isDefaultDatabase({ db_type: "mysql", database: "analytics" }, "analytics"), true);
  assert.equal(isDefaultDatabase(undefined, "analytics"), false);
  assert.equal(isDefaultDatabase({ db_type: "mysql", database: "analytics" }, ""), false);
});

test("Oracle 默认库判断只认独立默认库字段", () => {
  assert.equal(isDefaultDatabase({ db_type: "oracle", database: "ORCL" }, "ORCL"), false);
  assert.equal(
    isDefaultDatabase({ db_type: "oracle", database: "ORCL", default_database: "MCHS" }, "MCHS"),
    true,
  );
});
