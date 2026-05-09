import type { ColumnInfo, IndexInfo, ForeignKeyInfo, TriggerInfo, DatabaseType } from "@/types/database";

export interface ColumnDiff {
  type: "added" | "removed" | "modified";
  name: string;
  source?: ColumnInfo;
  target?: ColumnInfo;
  changes?: string[];
}

export interface IndexDiff {
  type: "added" | "removed" | "modified";
  name: string;
  source?: IndexInfo;
  target?: IndexInfo;
  changes?: string[];
}

export interface ForeignKeyDiff {
  type: "added" | "removed" | "modified";
  name: string;
  source?: ForeignKeyInfo;
  target?: ForeignKeyInfo;
  changes?: string[];
}

export interface TriggerDiff {
  type: "added" | "removed" | "modified";
  name: string;
  source?: TriggerInfo;
  target?: TriggerInfo;
  changes?: string[];
}

export interface TableDiff {
  type: "added" | "removed" | "modified";
  objectType?: "table" | "view";
  name: string;
  columns?: ColumnDiff[];
  indexes?: IndexDiff[];
  foreignKeys?: ForeignKeyDiff[];
  triggers?: TriggerDiff[];
  ddl?: string;
}

export function diffColumns(source: ColumnInfo[], target: ColumnInfo[]): ColumnDiff[] {
  const diffs: ColumnDiff[] = [];
  const targetMap = new Map(target.map((c) => [c.name, c]));
  const sourceMap = new Map(source.map((c) => [c.name, c]));

  for (const sc of source) {
    const tc = targetMap.get(sc.name);
    if (!tc) {
      diffs.push({ type: "added", name: sc.name, source: sc });
    } else {
      const changes: string[] = [];
      if (sc.data_type.toLowerCase() !== tc.data_type.toLowerCase()) {
        changes.push(`type: ${tc.data_type} → ${sc.data_type}`);
      }
      if (sc.is_nullable !== tc.is_nullable) {
        changes.push(`nullable: ${tc.is_nullable ? "YES" : "NO"} → ${sc.is_nullable ? "YES" : "NO"}`);
      }
      if ((sc.column_default ?? "") !== (tc.column_default ?? "")) {
        changes.push(`default: ${tc.column_default ?? "NULL"} → ${sc.column_default ?? "NULL"}`);
      }
      if (changes.length > 0) {
        diffs.push({ type: "modified", name: sc.name, source: sc, target: tc, changes });
      }
    }
  }

  for (const tc of target) {
    if (!sourceMap.has(tc.name)) {
      diffs.push({ type: "removed", name: tc.name, target: tc });
    }
  }

  return diffs;
}

export function diffIndexes(source: IndexInfo[], target: IndexInfo[]): IndexDiff[] {
  const diffs: IndexDiff[] = [];
  const targetMap = new Map(target.map((i) => [i.name, i]));
  const sourceMap = new Map(source.map((i) => [i.name, i]));

  for (const si of source) {
    if (si.is_primary) continue;
    const ti = targetMap.get(si.name);
    if (!ti) {
      diffs.push({ type: "added", name: si.name, source: si });
      continue;
    }

    const changes: string[] = [];
    if (si.is_unique !== ti.is_unique) {
      changes.push(`unique: ${ti.is_unique ? "YES" : "NO"} → ${si.is_unique ? "YES" : "NO"}`);
    }
    if (si.columns.join(",") !== ti.columns.join(",")) {
      changes.push(`columns: ${ti.columns.join(", ")} → ${si.columns.join(", ")}`);
    }
    if ((si.index_type ?? "") !== (ti.index_type ?? "")) {
      changes.push(`type: ${ti.index_type ?? "default"} → ${si.index_type ?? "default"}`);
    }
    if ((si.filter ?? "") !== (ti.filter ?? "")) {
      changes.push(`filter: ${ti.filter ?? "none"} → ${si.filter ?? "none"}`);
    }
    if ((si.included_columns ?? []).join(",") !== (ti.included_columns ?? []).join(",")) {
      changes.push(
        `include: ${(ti.included_columns ?? []).join(", ") || "none"} → ${(si.included_columns ?? []).join(", ") || "none"}`,
      );
    }

    if (changes.length > 0) {
      diffs.push({ type: "modified", name: si.name, source: si, target: ti, changes });
    }
  }

  for (const ti of target) {
    if (ti.is_primary) continue;
    if (!sourceMap.has(ti.name)) {
      diffs.push({ type: "removed", name: ti.name, target: ti });
    }
  }

  return diffs;
}

export function diffForeignKeys(source: ForeignKeyInfo[], target: ForeignKeyInfo[]): ForeignKeyDiff[] {
  const diffs: ForeignKeyDiff[] = [];
  const targetMap = new Map(target.map((fk) => [fk.name, fk]));
  const sourceMap = new Map(source.map((fk) => [fk.name, fk]));

  for (const sfk of source) {
    const tfk = targetMap.get(sfk.name);
    if (!tfk) {
      diffs.push({ type: "added", name: sfk.name, source: sfk });
      continue;
    }

    const changes: string[] = [];
    if (sfk.column !== tfk.column) changes.push(`column: ${tfk.column} → ${sfk.column}`);
    if (sfk.ref_table !== tfk.ref_table) changes.push(`ref table: ${tfk.ref_table} → ${sfk.ref_table}`);
    if (sfk.ref_column !== tfk.ref_column) changes.push(`ref column: ${tfk.ref_column} → ${sfk.ref_column}`);

    if (changes.length > 0) {
      diffs.push({ type: "modified", name: sfk.name, source: sfk, target: tfk, changes });
    }
  }

  for (const tfk of target) {
    if (!sourceMap.has(tfk.name)) {
      diffs.push({ type: "removed", name: tfk.name, target: tfk });
    }
  }

  return diffs;
}

export function diffTriggers(source: TriggerInfo[], target: TriggerInfo[]): TriggerDiff[] {
  const diffs: TriggerDiff[] = [];
  const targetMap = new Map(target.map((trigger) => [trigger.name, trigger]));
  const sourceMap = new Map(source.map((trigger) => [trigger.name, trigger]));

  for (const sourceTrigger of source) {
    const targetTrigger = targetMap.get(sourceTrigger.name);
    if (!targetTrigger) {
      diffs.push({ type: "added", name: sourceTrigger.name, source: sourceTrigger });
      continue;
    }

    const changes: string[] = [];
    if (sourceTrigger.event !== targetTrigger.event) {
      changes.push(`event: ${targetTrigger.event} → ${sourceTrigger.event}`);
    }
    if (sourceTrigger.timing !== targetTrigger.timing) {
      changes.push(`timing: ${targetTrigger.timing} → ${sourceTrigger.timing}`);
    }

    if (changes.length > 0) {
      diffs.push({ type: "modified", name: sourceTrigger.name, source: sourceTrigger, target: targetTrigger, changes });
    }
  }

  for (const targetTrigger of target) {
    if (!sourceMap.has(targetTrigger.name)) {
      diffs.push({ type: "removed", name: targetTrigger.name, target: targetTrigger });
    }
  }

  return diffs;
}

export function diffTables(
  sourceTables: string[],
  targetTables: string[],
): { added: string[]; removed: string[]; common: string[] } {
  const targetSet = new Set(targetTables);
  const sourceSet = new Set(sourceTables);
  return {
    added: sourceTables.filter((t) => !targetSet.has(t)),
    removed: targetTables.filter((t) => !sourceSet.has(t)),
    common: sourceTables.filter((t) => targetSet.has(t)),
  };
}

function quoteId(name: string, dbType: DatabaseType): string {
  if (dbType === "mysql" || dbType === "doris" || dbType === "starrocks") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function columnDef(col: ColumnInfo, dbType: DatabaseType): string {
  let def = `${quoteId(col.name, dbType)} ${col.data_type}`;
  if (!col.is_nullable) def += " NOT NULL";
  if (col.column_default !== null && col.column_default !== undefined) {
    def += ` DEFAULT ${col.column_default}`;
  }
  return def;
}

function qualifiedName(name: string, dbType: DatabaseType, schema?: string): string {
  return schema ? `${quoteId(schema, dbType)}.${quoteId(name, dbType)}` : quoteId(name, dbType);
}

function dropIndexSql(tableName: string, indexName: string, dbType: DatabaseType, schema?: string): string {
  const qt = qualifiedName(tableName, dbType, schema);
  const qi = qualifiedName(indexName, dbType, schema);
  if (dbType === "mysql" || dbType === "doris" || dbType === "starrocks") {
    return `DROP INDEX ${quoteId(indexName, dbType)} ON ${qt};`;
  }
  return `DROP INDEX IF EXISTS ${qi};`;
}

function createIndexSql(tableName: string, idx: IndexInfo, dbType: DatabaseType, schema?: string): string {
  const qt = qualifiedName(tableName, dbType, schema);
  const cols = idx.columns.map((c) => quoteId(c, dbType)).join(", ");
  const unique = idx.is_unique ? "UNIQUE " : "";
  const idxType = idx.index_type ?? "";
  const usingClause = idxType && dbType === "postgres" ? ` USING ${idxType}` : "";
  const typePrefix = idxType && dbType === "sqlserver" ? `${idxType} ` : "";
  const incCols = idx.included_columns ?? [];
  const includeClause =
    incCols.length > 0 && (dbType === "postgres" || dbType === "sqlserver")
      ? ` INCLUDE (${incCols.map((c) => quoteId(c, dbType)).join(", ")})`
      : "";
  const supportsWhere = dbType === "postgres" || dbType === "sqlserver" || dbType === "sqlite";
  const filter = idx.filter && supportsWhere ? ` WHERE ${idx.filter}` : "";
  return `CREATE ${unique}${typePrefix}INDEX ${quoteId(idx.name, dbType)} ON ${qt}${usingClause} (${cols})${includeClause}${filter};`;
}

function dropForeignKeySql(tableName: string, fkName: string, dbType: DatabaseType, schema?: string): string {
  const qt = qualifiedName(tableName, dbType, schema);
  const qf = quoteId(fkName, dbType);
  if (dbType === "mysql" || dbType === "doris" || dbType === "starrocks") {
    return `ALTER TABLE ${qt} DROP FOREIGN KEY ${qf};`;
  }
  return `ALTER TABLE ${qt} DROP CONSTRAINT ${qf};`;
}

function addForeignKeySql(tableName: string, fk: ForeignKeyInfo, dbType: DatabaseType, schema?: string): string {
  const qt = qualifiedName(tableName, dbType, schema);
  return `ALTER TABLE ${qt} ADD CONSTRAINT ${quoteId(fk.name, dbType)} FOREIGN KEY (${quoteId(fk.column, dbType)}) REFERENCES ${quoteId(fk.ref_table, dbType)} (${quoteId(fk.ref_column, dbType)});`;
}

function dropObjectSql(diff: TableDiff, dbType: DatabaseType, schema?: string): string {
  const objectType = diff.objectType === "view" ? "VIEW" : "TABLE";
  return `DROP ${objectType} IF EXISTS ${qualifiedName(diff.name, dbType, schema)};`;
}

export function generateSyncSql(diffs: TableDiff[], dbType: DatabaseType, schema?: string): string {
  const lines: string[] = [];
  const isMySQL = dbType === "mysql" || dbType === "doris" || dbType === "starrocks";

  for (const diff of diffs) {
    const qt = qualifiedName(diff.name, dbType, schema);

    if (diff.type === "added" && diff.ddl) {
      lines.push(`-- Create ${diff.objectType ?? "table"}: ${diff.name}`);
      lines.push(diff.ddl + ";");
      lines.push("");
      continue;
    }

    if (diff.type === "added" && diff.objectType === "view") {
      lines.push(`-- View exists only in source: ${diff.name}`);
      lines.push("-- Source view definition is not available from this driver yet.");
      lines.push("");
      continue;
    }

    if (diff.type === "removed") {
      lines.push(`-- Drop ${diff.objectType ?? "table"}: ${diff.name}`);
      lines.push(dropObjectSql(diff, dbType, schema));
      lines.push("");
      continue;
    }

    if (diff.type === "modified") {
      const parts: string[] = [];

      if (diff.foreignKeys) {
        for (const fk of diff.foreignKeys) {
          if (fk.type === "removed" || fk.type === "modified") {
            lines.push(dropForeignKeySql(diff.name, fk.name, dbType, schema));
          }
        }
      }

      if (diff.columns) {
        for (const col of diff.columns) {
          if (col.type === "added" && col.source) {
            parts.push(`  ADD COLUMN ${columnDef(col.source, dbType)}`);
          } else if (col.type === "removed") {
            parts.push(`  DROP COLUMN ${quoteId(col.name, dbType)}`);
          } else if (col.type === "modified" && col.source) {
            if (isMySQL) {
              parts.push(`  MODIFY COLUMN ${columnDef(col.source, dbType)}`);
            } else {
              const qn = quoteId(col.name, dbType);
              if (col.changes?.some((c) => c.startsWith("type:"))) {
                parts.push(`  ALTER COLUMN ${qn} TYPE ${col.source.data_type}`);
              }
              if (col.changes?.some((c) => c.startsWith("nullable:"))) {
                parts.push(
                  col.source.is_nullable ? `  ALTER COLUMN ${qn} DROP NOT NULL` : `  ALTER COLUMN ${qn} SET NOT NULL`,
                );
              }
              if (col.changes?.some((c) => c.startsWith("default:"))) {
                if (col.source.column_default !== null && col.source.column_default !== undefined) {
                  parts.push(`  ALTER COLUMN ${qn} SET DEFAULT ${col.source.column_default}`);
                } else {
                  parts.push(`  ALTER COLUMN ${qn} DROP DEFAULT`);
                }
              }
            }
          }
        }
      }

      if (parts.length > 0) {
        lines.push(`-- Alter table: ${diff.name}`);
        if (isMySQL) {
          lines.push(`ALTER TABLE ${qt}`);
          lines.push(parts.join(",\n") + ";");
        } else {
          for (const part of parts) {
            lines.push(`ALTER TABLE ${qt}${part};`);
          }
        }
        lines.push("");
      }

      if (diff.indexes) {
        for (const idx of diff.indexes) {
          if (idx.type === "added" && idx.source) {
            lines.push(createIndexSql(diff.name, idx.source, dbType, schema));
          } else if (idx.type === "removed") {
            lines.push(dropIndexSql(diff.name, idx.name, dbType, schema));
          } else if (idx.type === "modified" && idx.source) {
            lines.push(dropIndexSql(diff.name, idx.name, dbType, schema));
            lines.push(createIndexSql(diff.name, idx.source, dbType, schema));
          }
        }
      }

      if (diff.foreignKeys) {
        for (const fk of diff.foreignKeys) {
          if (fk.type === "added" && fk.source) {
            lines.push(addForeignKeySql(diff.name, fk.source, dbType, schema));
          } else if (fk.type === "modified" && fk.source) {
            lines.push(addForeignKeySql(diff.name, fk.source, dbType, schema));
          }
        }
      }

      if (diff.triggers) {
        for (const trigger of diff.triggers) {
          lines.push(
            `-- Trigger ${trigger.type}: ${trigger.name} on ${diff.name}; review trigger definition manually.`,
          );
        }
      }

      if (diff.indexes || diff.foreignKeys || diff.triggers) {
        if (
          (diff.indexes?.length ?? 0) > 0 ||
          (diff.foreignKeys?.length ?? 0) > 0 ||
          (diff.triggers?.length ?? 0) > 0
        ) {
          lines.push("");
        }
      }

      if (dbType === "sqlite" && diff.foreignKeys?.length) {
        lines.push(`-- SQLite foreign key synchronization may require table rebuild for: ${diff.name}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n").trim();
}
