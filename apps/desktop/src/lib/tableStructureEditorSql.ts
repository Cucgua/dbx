import type { ColumnInfo, DatabaseType, IndexInfo } from "../types/database.ts";
import { getTableStructureCapabilities, type TableStructureDialect } from "./tableStructureCapabilities.ts";

export interface EditableStructureColumn {
  id: string;
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string;
  comment: string;
  isPrimaryKey: boolean;
  original?: ColumnInfo;
  markedForDrop: boolean;
}

export interface EditableStructureIndex {
  id: string;
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  filter: string;
  indexType: string;
  includedColumns: string[];
  comment: string;
  original?: IndexInfo;
  markedForDrop: boolean;
}

export interface BuildTableStructureChangeSqlOptions {
  databaseType?: DatabaseType;
  schema?: string;
  tableName: string;
  columns: EditableStructureColumn[];
  indexes: EditableStructureIndex[];
}

export interface TableStructureChangeSql {
  statements: string[];
  warnings: string[];
}

type StructureSqlFlavor = DatabaseType | TableStructureDialect | undefined;

function quoteIdent(databaseType: StructureSqlFlavor, name: string): string {
  if (
    databaseType === "mysql" ||
    databaseType === "doris" ||
    databaseType === "starrocks" ||
    databaseType === "goldendb" ||
    databaseType === "sundb"
  )
    return `\`${name.replace(/`/g, "``")}\``;
  if (databaseType === "sqlserver") return `[${name.replace(/\]/g, "]]")}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

function isOracleLike(databaseType: StructureSqlFlavor): boolean {
  return databaseType === "oracle" || databaseType === "dameng" || databaseType === "oceanbase-oracle";
}

function qualifiedTable(databaseType: StructureSqlFlavor, schema: string | undefined, tableName: string): string {
  if (
    (databaseType === "postgres" ||
      isOracleLike(databaseType) ||
      databaseType === "sqlserver" ||
      databaseType === "h2") &&
    schema
  ) {
    return `${quoteIdent(databaseType, schema)}.${quoteIdent(databaseType, tableName)}`;
  }
  return quoteIdent(databaseType, tableName);
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeDefault(value: string | null | undefined): string {
  const trimmed = clean(value);
  return trimmed.toLowerCase() === "null" ? "" : trimmed;
}

function unwrapClickHouseNullableType(dataType: string): string {
  const match = dataType.trim().match(/^Nullable\s*\((.*)\)$/is);
  return match ? match[1].trim() : dataType.trim();
}

function clickHouseColumnType(column: EditableStructureColumn): string {
  const dataType = column.dataType.trim();
  if (column.isNullable) {
    return /^Nullable\s*\(/i.test(dataType) ? dataType : `Nullable(${dataType})`;
  }
  return unwrapClickHouseNullableType(dataType);
}

function columnDefinition(databaseType: StructureSqlFlavor, column: EditableStructureColumn): string {
  const dataType = databaseType === "clickhouse" ? clickHouseColumnType(column) : column.dataType.trim();
  const parts = [quoteIdent(databaseType, column.name), dataType];
  if (!column.isNullable && !isOracleLike(databaseType) && databaseType !== "clickhouse") parts.push("NOT NULL");
  const defaultValue = normalizeDefault(column.defaultValue);
  if (defaultValue) parts.push(`DEFAULT ${defaultValue}`);
  if (databaseType === "mysql" && clean(column.comment)) {
    parts.push(`COMMENT ${quoteString(clean(column.comment))}`);
  }
  return parts.join(" ");
}

function originalDefault(column: EditableStructureColumn): string {
  return normalizeDefault(column.original?.column_default);
}

function originalComment(column: EditableStructureColumn): string {
  return clean(column.original?.comment);
}

function hasExistingColumnAttributeChange(column: EditableStructureColumn): boolean {
  const original = column.original;
  if (!original) return false;
  return (
    column.name !== original.name ||
    column.dataType.trim() !== original.data_type.trim() ||
    column.isNullable !== original.is_nullable ||
    normalizeDefault(column.defaultValue) !== originalDefault(column) ||
    clean(column.comment) !== originalComment(column)
  );
}

function buildAddColumnSql(databaseType: StructureSqlFlavor, table: string, column: EditableStructureColumn): string[] {
  const addKeyword = databaseType === "sqlserver" ? "ADD" : "ADD COLUMN";
  const definition = columnDefinition(databaseType, column);
  const statements = isOracleLike(databaseType)
    ? [`ALTER TABLE ${table} ADD (${definition});`]
    : [`ALTER TABLE ${table} ${addKeyword} ${definition};`];
  if ((databaseType === "postgres" || isOracleLike(databaseType)) && clean(column.comment)) {
    statements.push(
      `COMMENT ON COLUMN ${table}.${quoteIdent(databaseType, column.name)} IS ${quoteString(clean(column.comment))};`,
    );
  }
  if (databaseType === "clickhouse" && clean(column.comment)) {
    statements.push(
      `ALTER TABLE ${table} COMMENT COLUMN ${quoteIdent(databaseType, column.name)} ${quoteString(clean(column.comment))};`,
    );
  }
  return statements;
}

function buildOracleLikeExistingColumnSql(
  databaseType: StructureSqlFlavor,
  table: string,
  column: EditableStructureColumn,
): string[] {
  const original = column.original;
  if (!original) return [];

  const statements: string[] = [];
  let currentName = original.name;
  if (column.name !== original.name) {
    statements.push(
      `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent(databaseType, original.name)} TO ${quoteIdent(databaseType, column.name)};`,
    );
    currentName = column.name;
  }
  if (column.dataType.trim() !== original.data_type.trim()) {
    statements.push(
      `ALTER TABLE ${table} MODIFY (${quoteIdent(databaseType, currentName)} ${column.dataType.trim()});`,
    );
  }
  if (column.isNullable !== original.is_nullable) {
    const nullability = column.isNullable ? "NULL" : "NOT NULL";
    statements.push(`ALTER TABLE ${table} MODIFY (${quoteIdent(databaseType, currentName)} ${nullability});`);
  }
  if (normalizeDefault(column.defaultValue) !== originalDefault(column)) {
    const defaultValue = normalizeDefault(column.defaultValue) || "NULL";
    statements.push(`ALTER TABLE ${table} MODIFY (${quoteIdent(databaseType, currentName)} DEFAULT ${defaultValue});`);
  }
  if (clean(column.comment) !== originalComment(column)) {
    const commentValue = clean(column.comment) ? quoteString(clean(column.comment)) : "NULL";
    statements.push(`COMMENT ON COLUMN ${table}.${quoteIdent(databaseType, currentName)} IS ${commentValue};`);
  }
  return statements;
}

function buildMysqlExistingColumnSql(table: string, column: EditableStructureColumn): string[] {
  const originalName = column.original?.name ?? column.name;
  const operation =
    column.name === originalName
      ? `MODIFY COLUMN ${columnDefinition("mysql", column)}`
      : `CHANGE COLUMN ${quoteIdent("mysql", originalName)} ${columnDefinition("mysql", column)}`;
  return [`ALTER TABLE ${table} ${operation};`];
}

function buildPostgresExistingColumnSql(table: string, column: EditableStructureColumn): string[] {
  const original = column.original;
  if (!original) return [];

  const statements: string[] = [];
  const currentName = column.name;
  if (column.name !== original.name) {
    statements.push(
      `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent("postgres", original.name)} TO ${quoteIdent("postgres", column.name)};`,
    );
  }
  if (column.dataType.trim() !== original.data_type.trim()) {
    statements.push(
      `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("postgres", currentName)} TYPE ${column.dataType.trim()};`,
    );
  }
  if (column.isNullable !== original.is_nullable) {
    const action = column.isNullable ? "DROP NOT NULL" : "SET NOT NULL";
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("postgres", currentName)} ${action};`);
  }
  if (normalizeDefault(column.defaultValue) !== originalDefault(column)) {
    const defaultValue = normalizeDefault(column.defaultValue);
    const action = defaultValue ? `SET DEFAULT ${defaultValue}` : "DROP DEFAULT";
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("postgres", currentName)} ${action};`);
  }
  if (clean(column.comment) !== originalComment(column)) {
    const commentValue = clean(column.comment) ? quoteString(clean(column.comment)) : "NULL";
    statements.push(`COMMENT ON COLUMN ${table}.${quoteIdent("postgres", currentName)} IS ${commentValue};`);
  }
  return statements;
}

function buildH2ExistingColumnSql(table: string, column: EditableStructureColumn): string[] {
  const original = column.original;
  if (!original) return [];

  const statements: string[] = [];
  let currentName = original.name;
  if (column.name !== original.name) {
    statements.push(
      `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("h2", original.name)} RENAME TO ${quoteIdent("h2", column.name)};`,
    );
    currentName = column.name;
  }
  if (column.dataType.trim() !== original.data_type.trim()) {
    statements.push(
      `ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("h2", currentName)} SET DATA TYPE ${column.dataType.trim()};`,
    );
  }
  if (column.isNullable !== original.is_nullable) {
    const action = column.isNullable ? "DROP NOT NULL" : "SET NOT NULL";
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("h2", currentName)} ${action};`);
  }
  if (normalizeDefault(column.defaultValue) !== originalDefault(column)) {
    const defaultValue = normalizeDefault(column.defaultValue);
    const action = defaultValue ? `SET DEFAULT ${defaultValue}` : "DROP DEFAULT";
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${quoteIdent("h2", currentName)} ${action};`);
  }
  if (clean(column.comment) !== originalComment(column)) {
    const commentValue = clean(column.comment) ? quoteString(clean(column.comment)) : "NULL";
    statements.push(`COMMENT ON COLUMN ${table}.${quoteIdent("h2", currentName)} IS ${commentValue};`);
  }
  return statements;
}

function buildClickHouseExistingColumnSql(table: string, column: EditableStructureColumn): string[] {
  const original = column.original;
  if (!original) return [];

  const statements: string[] = [];
  let currentName = original.name;
  if (column.name !== original.name) {
    statements.push(
      `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent("clickhouse", original.name)} TO ${quoteIdent("clickhouse", column.name)};`,
    );
    currentName = column.name;
  }
  if (
    clickHouseColumnType(column) !== original.data_type.trim() ||
    normalizeDefault(column.defaultValue) !== originalDefault(column)
  ) {
    const defaultValue = normalizeDefault(column.defaultValue);
    if (defaultValue) {
      statements.push(
        `ALTER TABLE ${table} MODIFY COLUMN ${quoteIdent("clickhouse", currentName)} ${clickHouseColumnType(column)} DEFAULT ${defaultValue};`,
      );
    } else if (originalDefault(column)) {
      statements.push(`ALTER TABLE ${table} MODIFY COLUMN ${quoteIdent("clickhouse", currentName)} REMOVE DEFAULT;`);
      if (clickHouseColumnType(column) !== original.data_type.trim()) {
        statements.push(
          `ALTER TABLE ${table} MODIFY COLUMN ${quoteIdent("clickhouse", currentName)} ${clickHouseColumnType(column)};`,
        );
      }
    } else {
      statements.push(
        `ALTER TABLE ${table} MODIFY COLUMN ${quoteIdent("clickhouse", currentName)} ${clickHouseColumnType(column)};`,
      );
    }
  }
  if (clean(column.comment) !== originalComment(column)) {
    statements.push(
      `ALTER TABLE ${table} COMMENT COLUMN ${quoteIdent("clickhouse", currentName)} ${quoteString(clean(column.comment))};`,
    );
  }
  return statements;
}

function buildSqliteExistingColumnSql(table: string, column: EditableStructureColumn, warnings: string[]): string[] {
  const original = column.original;
  if (!original) return [];

  const statements: string[] = [];
  const unsupportedChange =
    column.dataType.trim() !== original.data_type.trim() ||
    column.isNullable !== original.is_nullable ||
    normalizeDefault(column.defaultValue) !== originalDefault(column) ||
    clean(column.comment) !== originalComment(column);
  if (column.name !== original.name) {
    statements.push(
      `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent("sqlite", original.name)} TO ${quoteIdent("sqlite", column.name)};`,
    );
  }
  if (unsupportedChange) {
    warnings.push(`SQLite cannot safely alter existing column "${original.name}" without rebuilding the table.`);
  }
  return statements;
}

function buildColumnSql(options: BuildTableStructureChangeSqlOptions, warnings: string[]): string[] {
  const databaseType = options.databaseType;
  const capabilities = getTableStructureCapabilities(databaseType);
  const dialect = capabilities.dialect;
  const table = qualifiedTable(dialect, options.schema, options.tableName);
  const statements: string[] = [];
  const databaseLabel = databaseType ?? "this database";

  for (const column of options.columns) {
    if (column.markedForDrop) {
      if (!column.original) continue;
      if (!capabilities.dropColumn) {
        warnings.push(`Dropping columns is not supported for ${databaseLabel} from this editor.`);
        continue;
      }
      if (column.original.is_primary_key) {
        warnings.push(`Primary key column "${column.original.name}" cannot be dropped from this editor.`);
        continue;
      }
      statements.push(`ALTER TABLE ${table} DROP COLUMN ${quoteIdent(dialect, column.original.name)};`);
      continue;
    }

    if (!column.original) {
      if (!capabilities.addColumn) {
        warnings.push(`Adding columns is not supported for ${databaseLabel} from this editor.`);
        continue;
      }
      statements.push(...buildAddColumnSql(dialect, table, column));
      continue;
    }

    if (!hasExistingColumnAttributeChange(column)) continue;
    const original = column.original;
    const hasRename = column.name !== original.name;
    const hasAttributeChange =
      column.dataType.trim() !== original.data_type.trim() ||
      column.isNullable !== original.is_nullable ||
      normalizeDefault(column.defaultValue) !== originalDefault(column) ||
      clean(column.comment) !== originalComment(column);
    if (hasRename && !capabilities.renameColumn) {
      warnings.push(`Renaming columns is not supported for ${databaseLabel} from this editor.`);
    }
    if (hasAttributeChange && !capabilities.alterExistingColumn && dialect !== "sqlite") {
      warnings.push(`Editing existing columns is not supported for ${databaseLabel} yet.`);
    }
    if (
      (hasRename && !capabilities.renameColumn) ||
      (hasAttributeChange && !capabilities.alterExistingColumn && dialect !== "sqlite")
    ) {
      continue;
    }
    if (dialect === "mysql") {
      statements.push(...buildMysqlExistingColumnSql(table, column));
    } else if (dialect === "postgres") {
      statements.push(...buildPostgresExistingColumnSql(table, column));
    } else if (dialect === "oracle") {
      statements.push(...buildOracleLikeExistingColumnSql(dialect, table, column));
    } else if (dialect === "h2") {
      statements.push(...buildH2ExistingColumnSql(table, column));
    } else if (dialect === "clickhouse") {
      statements.push(...buildClickHouseExistingColumnSql(table, column));
    } else if (dialect === "sqlite") {
      statements.push(...buildSqliteExistingColumnSql(table, column, warnings));
    } else {
      warnings.push(`Editing existing columns is not supported for ${databaseLabel} yet.`);
    }
  }

  return statements;
}

function buildDropIndexSql(
  databaseType: StructureSqlFlavor,
  table: string,
  schema: string | undefined,
  indexName: string,
): string {
  if (databaseType === "mysql") return `DROP INDEX ${quoteIdent(databaseType, indexName)} ON ${table};`;
  if (databaseType === "sqlserver") return `DROP INDEX ${quoteIdent(databaseType, indexName)} ON ${table};`;
  if ((databaseType === "postgres" || isOracleLike(databaseType)) && schema) {
    return `DROP INDEX ${quoteIdent(databaseType, schema)}.${quoteIdent(databaseType, indexName)};`;
  }
  return `DROP INDEX ${quoteIdent(databaseType, indexName)};`;
}

function buildIndexSql(options: BuildTableStructureChangeSqlOptions, warnings: string[]): string[] {
  const databaseType = options.databaseType;
  const capabilities = getTableStructureCapabilities(databaseType);
  const dialect = capabilities.dialect;
  const table = qualifiedTable(dialect, options.schema, options.tableName);
  const statements: string[] = [];
  const databaseLabel = databaseType ?? "this database";

  for (const index of options.indexes) {
    if (index.markedForDrop) {
      if (!index.original) continue;
      if (!capabilities.dropIndex) {
        warnings.push(`Dropping indexes is not supported for ${databaseLabel} from this editor.`);
        continue;
      }
      if (index.original.is_primary) {
        warnings.push(`Primary index "${index.original.name}" cannot be dropped from this editor.`);
        continue;
      }
      statements.push(buildDropIndexSql(dialect, table, options.schema, index.original.name));
      continue;
    }

    if (index.original) continue;
    const name = clean(index.name);
    const columns = index.columns.map(clean).filter(Boolean);
    if (!name || columns.length === 0) continue;
    if (!capabilities.createIndex) {
      warnings.push(`Creating indexes is not supported for ${databaseLabel} from this editor.`);
      continue;
    }
    const unique = index.isUnique ? "UNIQUE " : "";
    const cols = columns.map((column) => quoteIdent(dialect, column)).join(", ");
    const idxType = clean(index.indexType);
    const usingClause = idxType && capabilities.indexType && dialect === "postgres" ? ` USING ${idxType}` : "";
    const typePrefix = idxType && capabilities.indexType && dialect === "sqlserver" ? `${idxType} ` : "";
    const incCols = index.includedColumns.map(clean).filter(Boolean);
    const includeClause =
      incCols.length > 0 && capabilities.indexInclude && (dialect === "postgres" || dialect === "sqlserver")
        ? ` INCLUDE (${incCols.map((c) => quoteIdent(dialect, c)).join(", ")})`
        : "";
    const filter = clean(index.filter);
    const supportsWhere =
      capabilities.indexFilter && (dialect === "postgres" || dialect === "sqlserver" || dialect === "sqlite");
    const whereClause = filter && supportsWhere ? ` WHERE ${filter}` : "";
    statements.push(
      `CREATE ${unique}${typePrefix}INDEX ${quoteIdent(dialect, name)} ON ${table}${usingClause} (${cols})${includeClause}${whereClause};`,
    );
    const comment = clean(index.comment);
    if (comment && capabilities.indexComment && dialect === "postgres") {
      statements.push(`COMMENT ON INDEX ${quoteIdent(dialect, name)} IS ${quoteString(comment)};`);
    }
  }

  return statements;
}

function validateDraft(options: BuildTableStructureChangeSqlOptions): string[] {
  const warnings: string[] = [];
  const activeColumns = options.columns.filter((column) => !column.markedForDrop);
  const names = new Set<string>();

  for (const column of activeColumns) {
    if (!clean(column.name)) warnings.push("Column name cannot be empty.");
    if (!clean(column.dataType)) warnings.push(`Column "${column.name || "(new)"}" type cannot be empty.`);
    const key = clean(column.name).toLowerCase();
    if (key && names.has(key)) warnings.push(`Column "${column.name}" is duplicated.`);
    if (key) names.add(key);
  }

  for (const index of options.indexes.filter((idx) => !idx.markedForDrop && !idx.original)) {
    if (!clean(index.name)) warnings.push("Index name cannot be empty.");
    if (index.columns.map(clean).filter(Boolean).length === 0) {
      warnings.push(`Index "${index.name || "(new)"}" needs at least one column.`);
    }
  }

  return warnings;
}

export function buildTableStructureChangeSql(options: BuildTableStructureChangeSqlOptions): TableStructureChangeSql {
  const warnings = validateDraft(options);
  const statements = [...buildColumnSql(options, warnings), ...buildIndexSql(options, warnings)];

  return { statements, warnings };
}

export function buildCreateTableSql(options: BuildTableStructureChangeSqlOptions): TableStructureChangeSql {
  const warnings: string[] = [];

  if (!clean(options.tableName)) {
    warnings.push("Table name is required.");
  }

  const activeColumns = options.columns.filter((c) => !c.markedForDrop);
  if (activeColumns.length === 0) {
    warnings.push("At least one column is required.");
  }

  const names = new Set<string>();
  for (const col of activeColumns) {
    if (!clean(col.name)) warnings.push("Column name cannot be empty.");
    if (!clean(col.dataType)) warnings.push(`Column "${col.name || "(new)"}" type cannot be empty.`);
    const key = clean(col.name).toLowerCase();
    if (key && names.has(key)) warnings.push(`Column "${col.name}" is duplicated.`);
    if (key) names.add(key);
  }

  if (warnings.length > 0) return { statements: [], warnings };

  const databaseType = options.databaseType;
  const capabilities = getTableStructureCapabilities(databaseType);
  const dialect = capabilities.dialect;
  const table = qualifiedTable(dialect, options.schema, options.tableName);
  const statements: string[] = [];

  const pkColumns = activeColumns.filter((c) => c.isPrimaryKey);
  const colDefs = activeColumns.map((col) => {
    const dataType = dialect === "clickhouse" ? clickHouseColumnType(col) : col.dataType.trim();
    const parts = [quoteIdent(dialect, col.name), dataType];
    if (!col.isNullable && !col.isPrimaryKey && dialect !== "clickhouse") parts.push("NOT NULL");
    const defaultValue = normalizeDefault(col.defaultValue);
    if (defaultValue) parts.push(`DEFAULT ${defaultValue}`);
    if (dialect === "mysql" && capabilities.comment && clean(col.comment)) {
      parts.push(`COMMENT ${quoteString(clean(col.comment))}`);
    }
    return parts.join(" ");
  });

  if (pkColumns.length > 0) {
    const pkList = pkColumns.map((c) => quoteIdent(dialect, c.name)).join(", ");
    colDefs.push(`PRIMARY KEY (${pkList})`);
  }

  statements.push(`CREATE TABLE ${table} (\n  ${colDefs.join(",\n  ")}\n);`);

  if (capabilities.comment && (dialect === "postgres" || dialect === "oracle" || dialect === "h2")) {
    for (const col of activeColumns) {
      if (clean(col.comment)) {
        statements.push(
          `COMMENT ON COLUMN ${table}.${quoteIdent(dialect, col.name)} IS ${quoteString(clean(col.comment))};`,
        );
      }
    }
  }
  if (capabilities.comment && dialect === "clickhouse") {
    for (const col of activeColumns) {
      if (clean(col.comment)) {
        statements.push(
          `ALTER TABLE ${table} COMMENT COLUMN ${quoteIdent(dialect, col.name)} ${quoteString(clean(col.comment))};`,
        );
      }
    }
  }

  for (const index of options.indexes.filter((idx) => !idx.markedForDrop && !idx.isPrimary)) {
    const name = clean(index.name);
    const columns = index.columns.map(clean).filter(Boolean);
    if (!name || columns.length === 0) continue;
    if (!capabilities.createIndex) {
      warnings.push(`Creating indexes is not supported for ${databaseType ?? "this database"} from this editor.`);
      continue;
    }
    const unique = index.isUnique ? "UNIQUE " : "";
    const cols = columns.map((c) => quoteIdent(dialect, c)).join(", ");
    const idxType = clean(index.indexType);
    const usingClause = idxType && capabilities.indexType && dialect === "postgres" ? ` USING ${idxType}` : "";
    const typePrefix = idxType && capabilities.indexType && dialect === "sqlserver" ? `${idxType} ` : "";
    statements.push(
      `CREATE ${unique}${typePrefix}INDEX ${quoteIdent(dialect, name)} ON ${table}${usingClause} (${cols});`,
    );
  }

  return { statements, warnings };
}
