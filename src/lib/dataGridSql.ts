import type { DatabaseType } from "@/types/database";
import { qualifiedTableName, quoteTableIdentifier } from "./tableSelectSql.ts";

export type GridCellValue = string | number | boolean | null;

export interface DataGridTableMeta {
  schema?: string;
  tableName: string;
  primaryKeys: string[];
}

export interface DataGridSaveStatementOptions {
  databaseType?: DatabaseType;
  tableMeta: DataGridTableMeta;
  columns: string[];
  rows: GridCellValue[][];
  dirtyRows: Array<[number, Array<[number, GridCellValue]>]>;
  deletedRows: number[];
  newRows: GridCellValue[][];
}

export function buildDataGridSaveStatements(options: DataGridSaveStatementOptions): string[] {
  const table = qualifiedTableName({
    databaseType: options.databaseType,
    schema: options.tableMeta.schema,
    tableName: options.tableMeta.tableName,
  });
  const statements: string[] = [];

  for (const [rowIndex, changes] of options.dirtyRows) {
    const row = options.rows[rowIndex];
    if (!row) continue;
    const sets = changes
      .map(
        ([columnIndex, value]) =>
          `${quoteIdent(options.databaseType, options.columns[columnIndex])} = ${formatGridSqlLiteral(value, options.databaseType)}`,
      )
      .join(", ");
    const where = buildPrimaryKeyWhere(options.databaseType, options.tableMeta.primaryKeys, options.columns, row);
    statements.push(`UPDATE ${table} SET ${sets} WHERE ${where};`);
  }

  for (const rowIndex of options.deletedRows) {
    const row = options.rows[rowIndex];
    if (!row) continue;
    const where = buildPrimaryKeyWhere(options.databaseType, options.tableMeta.primaryKeys, options.columns, row);
    statements.push(`DELETE FROM ${table} WHERE ${where};`);
  }

  for (const row of options.newRows) {
    const columns = options.columns.map((column) => quoteIdent(options.databaseType, column)).join(", ");
    const values = row.map((v) => formatGridSqlLiteral(v, options.databaseType)).join(", ");
    statements.push(`INSERT INTO ${table} (${columns}) VALUES (${values});`);
  }

  return statements;
}

export function buildDataGridRollbackStatements(options: DataGridSaveStatementOptions): string[] {
  const table = qualifiedTableName({
    databaseType: options.databaseType,
    schema: options.tableMeta.schema,
    tableName: options.tableMeta.tableName,
  });
  const statements: string[] = [];

  for (const row of options.newRows) {
    const where = buildRowWhere(options.databaseType, options.columns, row);
    if (where) statements.push(`DELETE FROM ${table} WHERE ${where};`);
  }

  for (const rowIndex of options.deletedRows) {
    const row = options.rows[rowIndex];
    if (!row) continue;
    const columns = options.columns.map((column) => quoteIdent(options.databaseType, column)).join(", ");
    const values = row.map((v) => formatGridSqlLiteral(v, options.databaseType)).join(", ");
    statements.push(`INSERT INTO ${table} (${columns}) VALUES (${values});`);
  }

  for (const [rowIndex, changes] of options.dirtyRows) {
    const row = options.rows[rowIndex];
    if (!row) continue;
    const afterRow = [...row];
    for (const [columnIndex, value] of changes) {
      afterRow[columnIndex] = value;
    }
    const sets = changes
      .map(
        ([columnIndex]) =>
          `${quoteIdent(options.databaseType, options.columns[columnIndex])} = ${formatGridSqlLiteral(row[columnIndex], options.databaseType)}`,
      )
      .join(", ");
    const where = [
      buildPrimaryKeyWhere(options.databaseType, options.tableMeta.primaryKeys, options.columns, afterRow),
      ...changes.map(([columnIndex, value]) =>
        buildColumnPredicate(options.databaseType, options.columns[columnIndex], value),
      ),
    ]
      .filter(Boolean)
      .join(" AND ");
    statements.push(`UPDATE ${table} SET ${sets} WHERE ${where};`);
  }

  return statements;
}

export function formatGridSqlLiteral(value: GridCellValue, databaseType?: DatabaseType): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value);
  if (text === "") return databaseType === "sqlserver" ? "N''" : "''";
  const escaped = `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  return databaseType === "sqlserver" ? `N${escaped}` : escaped;
}

function buildPrimaryKeyWhere(
  databaseType: DatabaseType | undefined,
  primaryKeys: string[],
  columns: string[],
  row: GridCellValue[],
): string {
  return primaryKeys
    .map((primaryKey) => {
      const value = row[columns.indexOf(primaryKey)];
      return `${quoteIdent(databaseType, primaryKey)} = ${formatGridSqlLiteral(value, databaseType)}`;
    })
    .join(" AND ");
}

function buildRowWhere(databaseType: DatabaseType | undefined, columns: string[], row: GridCellValue[]): string {
  return columns.map((column, index) => buildColumnPredicate(databaseType, column, row[index])).join(" AND ");
}

function buildColumnPredicate(databaseType: DatabaseType | undefined, column: string, value: GridCellValue): string {
  const ident = quoteIdent(databaseType, column);
  if (value === null || value === undefined) return `${ident} IS NULL`;
  return `${ident} = ${formatGridSqlLiteral(value, databaseType)}`;
}

function quoteIdent(databaseType: DatabaseType | undefined, name: string): string {
  return quoteTableIdentifier(databaseType, name);
}
