import type { ConnectionConfig } from "@/types/database";

type DefaultDatabaseConnection = Pick<ConnectionConfig, "database" | "default_database" | "db_type">;

function hasExplicitDefaultDatabase(connection: DefaultDatabaseConnection): boolean {
  return typeof connection.default_database === "string";
}

function connectionDatabaseCanBeDefault(connection: DefaultDatabaseConnection): boolean {
  return connection.db_type !== "oracle";
}

export function resolveDefaultDatabase(connection: DefaultDatabaseConnection, options: string[]): string {
  if (hasExplicitDefaultDatabase(connection)) {
    return connection.default_database || options[0] || "";
  }
  if (connectionDatabaseCanBeDefault(connection) && connection.database) {
    return connection.database;
  }
  return options[0] || "";
}

export function isDefaultDatabase(connection: DefaultDatabaseConnection | undefined, database: string): boolean {
  if (!connection || !database) return false;
  if (hasExplicitDefaultDatabase(connection)) {
    return connection.default_database === database;
  }
  return connectionDatabaseCanBeDefault(connection) && connection.database === database;
}
