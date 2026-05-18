import type { DatabaseType } from "@/types/database";
import { quoteTableIdentifier } from "./tableSelectSql";

const MYSQL_COMPATIBLE_PROFILES = new Set([
  "mysql",
  "mariadb",
  "tidb",
  "oceanbase",
  "doris",
  "starrocks",
  "custom_mysql",
]);
const MYSQL_COMPATIBLE_TYPES = new Set<DatabaseType>(["mysql", "doris", "starrocks", "goldendb"]);

export interface CreateDatabaseSqlOptions {
  databaseType?: DatabaseType;
  driverProfile?: string | null;
  name: string;
  charset?: string;
  collation?: string;
}

export function supportsCreateDatabaseCharset(databaseType?: DatabaseType, driverProfile?: string | null): boolean {
  return (
    MYSQL_COMPATIBLE_TYPES.has(databaseType as DatabaseType) ||
    (!!driverProfile && MYSQL_COMPATIBLE_PROFILES.has(driverProfile))
  );
}

export function buildCreateDatabaseSql(options: CreateDatabaseSqlOptions): string {
  const name = quoteTableIdentifier(options.databaseType, options.name);
  const charset = cleanSqlOption(options.charset);
  const collation = cleanSqlOption(options.collation);
  if (!supportsCreateDatabaseCharset(options.databaseType, options.driverProfile) || !charset) {
    return `CREATE DATABASE ${name};`;
  }
  const collateClause = collation ? ` COLLATE ${collation}` : "";
  return `CREATE DATABASE ${name} CHARACTER SET ${charset}${collateClause};`;
}

function cleanSqlOption(value: string | undefined): string {
  return value?.trim().replace(/[;\s]+/g, "") ?? "";
}
