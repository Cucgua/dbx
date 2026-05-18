import type { DatabaseObjectType, DatabaseType } from "@/types/database";
import { isSchemaAware } from "@/lib/databaseCapabilities";
import { quoteTableIdentifier } from "@/lib/tableSelectSql";

export type RenameableObjectType = DatabaseObjectType;

export interface BuildRenameObjectSqlOptions {
  databaseType?: DatabaseType;
  objectType: RenameableObjectType;
  schema?: string | null;
  oldName: string;
  newName: string;
}

const postgresLikeRenameTypes = new Set<DatabaseType>([
  "postgres",
  "redshift",
  "gaussdb",
  "kingbase",
  "highgo",
  "vastbase",
]);

const oracleLikeRenameTypes = new Set<DatabaseType>(["oracle", "dameng"]);

function sqlServerString(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`;
}

function quoteRenameIdentifier(databaseType: DatabaseType | undefined, name: string): string {
  if (databaseType === "mysql" || databaseType === "goldendb") return `\`${name.replaceAll("`", "``")}\``;
  return quoteTableIdentifier(databaseType, name);
}

function qualifiedName(databaseType: DatabaseType | undefined, schema: string | null | undefined, name: string) {
  if (isSchemaAware(databaseType) && schema) {
    return `${quoteRenameIdentifier(databaseType, schema)}.${quoteRenameIdentifier(databaseType, name)}`;
  }
  return quoteRenameIdentifier(databaseType, name);
}

function sqlServerObjectName(schema: string | null | undefined, name: string) {
  return schema ? `${schema}.${name}` : name;
}

export function supportsObjectRename(
  databaseType: DatabaseType | undefined,
  objectType: RenameableObjectType,
): boolean {
  if (!databaseType) return false;
  if (databaseType === "sqlserver") return true;
  if (objectType === "PROCEDURE" || objectType === "FUNCTION") return false;
  if (databaseType === "sqlite") return objectType === "TABLE";
  if (databaseType === "mysql" || databaseType === "goldendb") return objectType === "TABLE" || objectType === "VIEW";
  if (postgresLikeRenameTypes.has(databaseType)) return objectType === "TABLE" || objectType === "VIEW";
  if (oracleLikeRenameTypes.has(databaseType)) return objectType === "TABLE" || objectType === "VIEW";
  return false;
}

export function buildRenameObjectSql(options: BuildRenameObjectSqlOptions): string {
  const { databaseType, objectType, schema, oldName, newName } = options;
  if (!supportsObjectRename(databaseType, objectType)) {
    throw new Error(`Renaming ${objectType} is not supported for ${databaseType ?? "this database"}.`);
  }

  if (databaseType === "sqlserver") {
    return `EXEC sp_rename ${sqlServerString(sqlServerObjectName(schema, oldName))}, ${sqlServerString(newName)}, N'OBJECT';`;
  }

  if (databaseType === "mysql" || databaseType === "goldendb") {
    return `RENAME TABLE ${qualifiedName(databaseType, schema, oldName)} TO ${qualifiedName(databaseType, schema, newName)};`;
  }

  if (databaseType === "sqlite") {
    return `ALTER TABLE ${qualifiedName(databaseType, schema, oldName)} RENAME TO ${quoteRenameIdentifier(databaseType, newName)};`;
  }

  if (
    postgresLikeRenameTypes.has(databaseType as DatabaseType) ||
    oracleLikeRenameTypes.has(databaseType as DatabaseType)
  ) {
    const keyword = objectType === "VIEW" ? "VIEW" : "TABLE";
    return `ALTER ${keyword} ${qualifiedName(databaseType, schema, oldName)} RENAME TO ${quoteRenameIdentifier(databaseType, newName)};`;
  }

  throw new Error(`Renaming ${objectType} is not supported for ${databaseType ?? "this database"}.`);
}
