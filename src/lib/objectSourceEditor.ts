import type { DatabaseType, ObjectSourceKind } from "@/types/database";

type BuildEditableObjectSourceSqlInput = {
  databaseType: DatabaseType;
  objectType: ObjectSourceKind;
  schema?: string | null;
  name: string;
  source: string;
};

export type ObjectSourceSaveExecutionMode = "single" | "script";

function quotePostgresIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function ensureSemicolon(sql: string) {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function postgresQualifiedName(schema: string | null | undefined, name: string) {
  return [schema, name]
    .filter(Boolean)
    .map((part) => quotePostgresIdentifier(part as string))
    .join(".");
}

export function buildExecutableObjectSourceSql(input: BuildEditableObjectSourceSqlInput) {
  const source = input.source.trim();
  if (input.databaseType === "sqlserver") {
    return source.replace(/^CREATE\s+(?:OR\s+ALTER\s+)?/i, "ALTER ");
  }

  if ((input.databaseType === "postgres" || input.databaseType === "gaussdb") && input.objectType === "VIEW") {
    return `CREATE OR REPLACE VIEW ${postgresQualifiedName(input.schema, input.name)} AS\n${ensureSemicolon(source)}`;
  }

  return ensureSemicolon(source);
}

export function objectSourceSaveExecutionMode(databaseType: DatabaseType): ObjectSourceSaveExecutionMode {
  return databaseType === "sqlserver" ? "single" : "script";
}
