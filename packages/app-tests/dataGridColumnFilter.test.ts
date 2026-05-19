import { strict as assert } from "node:assert";
import test from "node:test";
import {
  appendColumnValueFilterCondition,
  buildColumnValueFilterCondition,
} from "../../apps/desktop/src/lib/dataGridColumnFilter.ts";

test("builds a numeric server-side column filter from typed text", () => {
  const condition = buildColumnValueFilterCondition({
    databaseType: "mysql",
    columnName: "id",
    columnInfo: { name: "id", data_type: "int", is_nullable: false, is_primary_key: true },
    rawValue: "49436",
  });

  assert.equal(condition, "`id` = 49436");
});

test("quotes text server-side column filters and appends them to existing WHERE input", () => {
  const condition = buildColumnValueFilterCondition({
    databaseType: "postgres",
    columnName: "status",
    columnInfo: { name: "status", data_type: "varchar", is_nullable: true, is_primary_key: false },
    rawValue: "active",
  });

  assert.equal(condition, `"status" = 'active'`);
  assert.equal(appendColumnValueFilterCondition("deleted_at IS NULL", condition), `(deleted_at IS NULL) AND ("status" = 'active')`);
});

test("builds IS NULL for typed NULL filters", () => {
  const condition = buildColumnValueFilterCondition({
    databaseType: "sqlserver",
    columnName: "archived_at",
    rawValue: "NULL",
  });

  assert.equal(condition, "[archived_at] IS NULL");
});
