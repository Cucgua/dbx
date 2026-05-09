import type { DatabaseType, QueryResult } from "@/types/database";
import { quoteTableIdentifier } from "./tableSelectSql";
import { formatGridSqlLiteral } from "./dataGridSql";

export type DataCompareCellValue = QueryResult["rows"][number][number];

export interface DataCompareChangedCell {
  column: string;
  source: DataCompareCellValue;
  target: DataCompareCellValue;
}

export interface DataCompareRow {
  key: string;
  keyValues: Record<string, DataCompareCellValue>;
  values: Record<string, DataCompareCellValue>;
}

export interface DataCompareModifiedRow {
  key: string;
  keyValues: Record<string, DataCompareCellValue>;
  sourceValues: Record<string, DataCompareCellValue>;
  targetValues: Record<string, DataCompareCellValue>;
  changes: DataCompareChangedCell[];
}

export interface DataCompareResult {
  added: DataCompareRow[];
  removed: DataCompareRow[];
  modified: DataCompareModifiedRow[];
}

export interface CompareDataRowsOptions {
  columns: readonly string[];
  keyColumns: readonly string[];
  sourceRows: readonly (readonly DataCompareCellValue[])[];
  targetRows: readonly (readonly DataCompareCellValue[])[];
}

export interface GenerateDataSyncSqlOptions {
  tableName: string;
  schema?: string;
  columns: readonly string[];
  keyColumns: readonly string[];
  diff: DataCompareResult;
  databaseType?: DatabaseType;
}

function rowObject(
  columns: readonly string[],
  row: readonly DataCompareCellValue[],
): Record<string, DataCompareCellValue> {
  const item: Record<string, DataCompareCellValue> = {};
  columns.forEach((column, index) => {
    item[column] = row[index] ?? null;
  });
  return item;
}

function keyFor(row: Record<string, DataCompareCellValue>, keyColumns: readonly string[]): string {
  return keyColumns.map((column) => JSON.stringify(row[column] ?? null)).join("\u001f");
}

function keyValues(row: Record<string, DataCompareCellValue>, keyColumns: readonly string[]) {
  const values: Record<string, DataCompareCellValue> = {};
  keyColumns.forEach((column) => {
    values[column] = row[column] ?? null;
  });
  return values;
}

export function compareDataRows(options: CompareDataRowsOptions): DataCompareResult {
  if (options.keyColumns.length === 0) {
    throw new Error("At least one key column is required for data comparison");
  }

  const source = new Map<string, Record<string, DataCompareCellValue>>();
  const target = new Map<string, Record<string, DataCompareCellValue>>();
  options.sourceRows.forEach((row) => {
    const item = rowObject(options.columns, row);
    const key = keyFor(item, options.keyColumns);
    if (source.has(key)) throw new Error(`Duplicate source key: ${key}`);
    source.set(key, item);
  });
  options.targetRows.forEach((row) => {
    const item = rowObject(options.columns, row);
    const key = keyFor(item, options.keyColumns);
    if (target.has(key)) throw new Error(`Duplicate target key: ${key}`);
    target.set(key, item);
  });

  const added: DataCompareRow[] = [];
  const removed: DataCompareRow[] = [];
  const modified: DataCompareModifiedRow[] = [];

  for (const [key, sourceValues] of source) {
    const targetValues = target.get(key);
    if (!targetValues) {
      added.push({ key, keyValues: keyValues(sourceValues, options.keyColumns), values: sourceValues });
      continue;
    }

    const changes = options.columns
      .filter((column) => !options.keyColumns.includes(column))
      .filter((column) => sourceValues[column] !== targetValues[column])
      .map((column) => ({ column, source: sourceValues[column] ?? null, target: targetValues[column] ?? null }));

    if (changes.length > 0) {
      modified.push({
        key,
        keyValues: keyValues(sourceValues, options.keyColumns),
        sourceValues,
        targetValues,
        changes,
      });
    }
  }

  for (const [key, targetValues] of target) {
    if (!source.has(key)) {
      removed.push({ key, keyValues: keyValues(targetValues, options.keyColumns), values: targetValues });
    }
  }

  return { added, removed, modified };
}

function qualifiedTableName(schema: string | undefined, tableName: string, databaseType?: DatabaseType): string {
  const table = quoteTableIdentifier(databaseType, tableName);
  return schema ? `${quoteTableIdentifier(databaseType, schema)}.${table}` : table;
}

function whereByKey(
  keyValues: Record<string, DataCompareCellValue>,
  keyColumns: readonly string[],
  databaseType?: DatabaseType,
): string {
  return keyColumns
    .map(
      (column) =>
        `${quoteTableIdentifier(databaseType, column)} = ${formatGridSqlLiteral(keyValues[column], databaseType)}`,
    )
    .join(" AND ");
}

export function generateDataSyncStatements(options: GenerateDataSyncSqlOptions): string[] {
  const table = qualifiedTableName(options.schema, options.tableName, options.databaseType);
  const statements: string[] = [];

  for (const row of options.diff.added) {
    const columns = options.columns.map((column) => quoteTableIdentifier(options.databaseType, column)).join(", ");
    const values = options.columns
      .map((column) => formatGridSqlLiteral(row.values[column], options.databaseType))
      .join(", ");
    statements.push(`INSERT INTO ${table} (${columns}) VALUES (${values});`);
  }

  for (const row of options.diff.modified) {
    const assignments = row.changes
      .map(
        (change) =>
          `${quoteTableIdentifier(options.databaseType, change.column)} = ${formatGridSqlLiteral(change.source, options.databaseType)}`,
      )
      .join(", ");
    statements.push(
      `UPDATE ${table} SET ${assignments} WHERE ${whereByKey(row.keyValues, options.keyColumns, options.databaseType)};`,
    );
  }

  for (const row of options.diff.removed) {
    statements.push(
      `DELETE FROM ${table} WHERE ${whereByKey(row.keyValues, options.keyColumns, options.databaseType)};`,
    );
  }

  return statements;
}

export function generateDataSyncSql(options: GenerateDataSyncSqlOptions): string {
  return generateDataSyncStatements(options).join("\n");
}
