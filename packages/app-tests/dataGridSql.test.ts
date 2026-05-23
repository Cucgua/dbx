import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeDataGridSaveError } from "../../apps/desktop/src/lib/dataGridSql.ts";

const dataGridSqlSource = readFileSync("apps/desktop/src/lib/dataGridSql.ts", "utf8");
const dataGridExportSource = readFileSync("apps/desktop/src/composables/useDataGridExport.ts", "utf8");
const columnFilterSource = readFileSync("apps/desktop/src/lib/dataGridColumnFilter.ts", "utf8");
const gridSource = readFileSync("apps/desktop/src/components/grid/DataGrid.vue", "utf8");
const rustSource = readFileSync("crates/dbx-core/src/data_grid_sql.rs", "utf8");

test("frontend data grid SQL helpers delegate executable SQL generation to backend APIs", () => {
  assert.match(dataGridSqlSource, /return api\.buildDataGridCopyUpdateStatements\(options\)/);
  assert.match(dataGridSqlSource, /return api\.buildDataGridCopyInsertStatement\(options\)/);
  assert.match(dataGridSqlSource, /return api\.buildDataGridContextFilterCondition\(options\)/);
  assert.match(dataGridSqlSource, /return api\.buildDataGridColumnValueFilterCondition\(options\)/);
  assert.match(dataGridSqlSource, /return api\.buildDataGridCountSql\(options\)/);
  assert.match(dataGridSqlSource, /return api\.buildHiveTablePropertiesSql\(options\)/);
  assert.doesNotMatch(dataGridSqlSource, /INSERT INTO|UPDATE .* SET|DELETE FROM|formatGridSqlLiteral|quoteTableIdentifier/);
});

test("data grid copy and filter callers await backend SQL helpers", () => {
  assert.match(dataGridExportSource, /await buildDataGridCopyInsertStatement\(/);
  assert.match(dataGridExportSource, /await buildDataGridCopyUpdateStatements\(/);
  assert.match(columnFilterSource, /return buildDataGridColumnValueFilterCondition\(/);
  assert.match(gridSource, /await buildDataGridContextFilterCondition\(/);
  assert.match(gridSource, /await buildHiveTablePropertiesSql\(/);
  assert.match(gridSource, /await buildDataGridCountSql\(/);
  assert.doesNotMatch(gridSource, /formatGridSqlLiteral|SHOW TBLPROPERTIES|SELECT COUNT\(\*\) AS cnt/);
});

test("Rust data grid SQL exposes copy and filter builders", () => {
  assert.match(rustSource, /pub fn build_data_grid_copy_update_statements/);
  assert.match(rustSource, /pub fn build_data_grid_copy_insert_statement/);
  assert.match(rustSource, /pub fn build_data_grid_context_filter_condition/);
  assert.match(rustSource, /pub fn build_data_grid_column_value_filter_condition/);
  assert.match(rustSource, /pub fn build_data_grid_count_sql/);
  assert.match(rustSource, /pub fn build_hive_table_properties_sql/);
});

test("normalizes Hive ACID update and delete errors", () => {
  const error = normalizeDataGridSaveError(
    "hive",
    "Statement 1 failed: Agent RPC error (-1): Error while compiling statement: FAILED: SemanticException [Error 10294]: Attempt to do update or delete using transaction manager that does not support these operations.. Previous 0 statement(s) may have been committed.",
  );

  assert.equal(
    error,
    "Hive UPDATE/DELETE are not enabled for this table or server. Add rows with INSERT, or enable ACID transactional tables in Hive before editing/deleting existing rows.",
  );
});
