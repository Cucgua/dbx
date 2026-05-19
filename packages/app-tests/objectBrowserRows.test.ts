import { strict as assert } from "node:assert";
import test from "node:test";
import { buildObjectBrowserRows, filterObjectBrowserRows } from "../../apps/desktop/src/lib/objectBrowserRows.ts";

test("builds unique row ids for overloaded routines with the same visible name", () => {
  const rows = buildObjectBrowserRows({
    objects: [
      { name: "list_pipes", object_type: "FUNCTION", schema: "dbms_pipe" },
      { name: "list_pipes", object_type: "FUNCTION", schema: "dbms_pipe" },
      { name: "create_pipe", object_type: "FUNCTION", schema: "dbms_pipe" },
    ],
    database: "highgo",
    fallbackSchema: "dbms_pipe",
    needsSchema: true,
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["dbms_pipe:list_pipes:FUNCTION:0", "dbms_pipe:list_pipes:FUNCTION:1", "dbms_pipe:create_pipe:FUNCTION:0"],
  );
});

test("object browser search matches names, types, and comments but not schema names", () => {
  const rows = buildObjectBrowserRows({
    objects: [
      { name: "users", object_type: "TABLE", schema: "exam_hub", comment: "account records" },
      { name: "orders", object_type: "TABLE", schema: "sales", comment: "exam invoices" },
      { name: "refresh_exam_stats", object_type: "PROCEDURE", schema: "public" },
    ],
    database: "app",
    fallbackSchema: "public",
    needsSchema: true,
  });

  assert.deepEqual(
    filterObjectBrowserRows(rows, "exam").map((row) => row.name),
    ["orders", "refresh_exam_stats"],
  );
});
