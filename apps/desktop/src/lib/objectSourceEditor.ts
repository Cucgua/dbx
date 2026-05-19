import type { DatabaseType, ObjectSourceKind } from "@/types/database";

type BuildEditableObjectSourceSqlInput = {
  databaseType: DatabaseType;
  objectType: ObjectSourceKind;
  schema?: string | null;
  name: string;
  source: string;
};

type BuildRoutineRenameObjectSourceInput = BuildEditableObjectSourceSqlInput & {
  newName: string;
};

export type ObjectSourceSaveExecutionMode = "single" | "script";

const postgresLikeRoutineRenameTypes = new Set<DatabaseType>([
  "postgres",
  "redshift",
  "gaussdb",
  "kingbase",
  "highgo",
  "vastbase",
]);
const mysqlLikeRoutineRenameTypes = new Set<DatabaseType>(["mysql", "goldendb"]);
const oracleLikeRoutineRenameTypes = new Set<DatabaseType>(["oracle", "dameng"]);

function quotePostgresIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteMysqlIdentifier(value: string) {
  return `\`${value.replaceAll("`", "``")}\``;
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

function mysqlQualifiedName(schema: string | null | undefined, name: string) {
  return [schema, name]
    .filter(Boolean)
    .map((part) => quoteMysqlIdentifier(part as string))
    .join(".");
}

function unquotePostgresIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replaceAll('""', '"');
  return trimmed;
}

function splitQualifiedRoutineName(value: string) {
  const parts = value.match(/"(?:""|[^"])+"|[A-Za-z_][\w$]*/g) ?? [];
  return parts.map(unquotePostgresIdentifier);
}

function unquoteMysqlIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) return trimmed.slice(1, -1).replaceAll("``", "`");
  return trimmed;
}

function splitMysqlQualifiedRoutineName(value: string) {
  const parts = value.match(/`(?:``|[^`])+`|[A-Za-z_][\w$]*/g) ?? [];
  return parts.map(unquoteMysqlIdentifier);
}

function routineDeclaration(source: string) {
  const match = source.match(
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(FUNCTION|PROCEDURE)\s+((?:"(?:""|[^"])+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"(?:""|[^"])+"|[A-Za-z_][\w$]*))?)\s*(\([^]*?\))?/i,
  );
  if (!match) return null;
  const nameParts = splitQualifiedRoutineName(match[2]);
  const name = nameParts[nameParts.length - 1];
  if (!name) return null;
  return {
    kind: match[1].toUpperCase() as "FUNCTION" | "PROCEDURE",
    name,
    signature: match[3]?.trim() ?? "",
  };
}

function replaceSqlRoutineDeclarationName(source: string, schema: string | null | undefined, newName: string) {
  const match = source.match(
    /^(\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:FUNCTION|PROCEDURE)\s+)((?:"(?:""|[^"])+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"(?:""|[^"])+"|[A-Za-z_][\w$]*))?)/i,
  );
  if (!match) return null;
  const existingParts = splitQualifiedRoutineName(match[2]);
  const schemaName = schema || (existingParts.length > 1 ? existingParts[0] : null);
  const replacement = schemaName
    ? `${quotePostgresIdentifier(schemaName)}.${quotePostgresIdentifier(newName)}`
    : quotePostgresIdentifier(newName);
  return `${source.slice(0, match.index)}${match[1]}${replacement}${source.slice((match.index ?? 0) + match[0].length)}`;
}

function mysqlRoutineDeclaration(source: string) {
  const match = source.match(
    /^\s*CREATE\s+(?:DEFINER\s*=\s*(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s]+)\s*@\s*(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s]+)\s+)?(FUNCTION|PROCEDURE)\s+((?:`(?:``|[^`])+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`(?:``|[^`])+`|[A-Za-z_][\w$]*))?)/i,
  );
  if (!match) return null;
  const nameParts = splitMysqlQualifiedRoutineName(match[2]);
  const name = nameParts[nameParts.length - 1];
  if (!name) return null;
  return {
    kind: match[1].toUpperCase() as "FUNCTION" | "PROCEDURE",
    name,
  };
}

function replaceMysqlRoutineDeclarationName(source: string, newName: string) {
  const match = source.match(
    /^(\s*CREATE\s+(?:DEFINER\s*=\s*(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s]+)\s*@\s*(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s]+)\s+)?(?:FUNCTION|PROCEDURE)\s+)((?:`(?:``|[^`])+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`(?:``|[^`])+`|[A-Za-z_][\w$]*))?)/i,
  );
  if (!match) return null;
  return `${source.slice(0, match.index)}${match[1]}${quoteMysqlIdentifier(newName)}${source.slice((match.index ?? 0) + match[0].length)}`;
}

function routineNameChanged(sourceName: string, savedName: string) {
  return sourceName.toLowerCase() !== savedName.toLowerCase();
}

function buildRoutineRenameCleanup(input: BuildEditableObjectSourceSqlInput, source: string) {
  if (input.objectType !== "FUNCTION" && input.objectType !== "PROCEDURE") return null;

  if (mysqlLikeRoutineRenameTypes.has(input.databaseType)) {
    const declaration = mysqlRoutineDeclaration(source);
    if (!declaration || declaration.kind !== input.objectType) return null;
    if (!routineNameChanged(declaration.name, input.name)) return null;
    return `DROP ${input.objectType} IF EXISTS ${mysqlQualifiedName(input.schema, input.name)};`;
  }

  if (!postgresLikeRoutineRenameTypes.has(input.databaseType)) return null;

  const declaration = routineDeclaration(source);
  if (!declaration || declaration.kind !== input.objectType) return null;
  if (!routineNameChanged(declaration.name, input.name)) return null;

  return `DROP ${input.objectType} IF EXISTS ${postgresQualifiedName(input.schema, input.name)}${declaration.signature};`;
}

export function supportsSourceBackedRoutineRename(
  databaseType: DatabaseType | undefined,
  objectType: ObjectSourceKind,
): boolean {
  if (objectType !== "FUNCTION" && objectType !== "PROCEDURE") return false;
  if (!databaseType || databaseType === "sqlserver") return false;
  return (
    mysqlLikeRoutineRenameTypes.has(databaseType) ||
    postgresLikeRoutineRenameTypes.has(databaseType) ||
    oracleLikeRoutineRenameTypes.has(databaseType)
  );
}

export function buildRoutineRenameObjectSourceStatements(input: BuildRoutineRenameObjectSourceInput) {
  if (!supportsSourceBackedRoutineRename(input.databaseType, input.objectType)) {
    throw new Error(`Renaming ${input.objectType} from source is not supported for ${input.databaseType}.`);
  }

  const source = input.source.trim();
  const declaration = mysqlLikeRoutineRenameTypes.has(input.databaseType)
    ? mysqlRoutineDeclaration(source)
    : routineDeclaration(source);
  if (!declaration || declaration.kind !== input.objectType) {
    throw new Error(`Cannot find a CREATE ${input.objectType} declaration in the object source.`);
  }

  const renamedSource = mysqlLikeRoutineRenameTypes.has(input.databaseType)
    ? replaceMysqlRoutineDeclarationName(source, input.newName)
    : replaceSqlRoutineDeclarationName(source, input.schema, input.newName);
  if (!renamedSource) {
    throw new Error(`Cannot rewrite the ${input.objectType} name in the object source.`);
  }

  if (oracleLikeRoutineRenameTypes.has(input.databaseType)) {
    return [
      ensureSemicolon(renamedSource),
      `DROP ${input.objectType} ${postgresQualifiedName(input.schema, input.name)};`,
    ];
  }

  return buildExecutableObjectSourceStatements({
    databaseType: input.databaseType,
    objectType: input.objectType,
    schema: input.schema,
    name: input.name,
    source: renamedSource,
  });
}

export function buildExecutableObjectSourceStatements(input: BuildEditableObjectSourceSqlInput) {
  const source = input.source.trim();
  if (input.databaseType === "sqlserver") {
    return [source.replace(/^CREATE\s+(?:OR\s+ALTER\s+)?/i, "ALTER ")];
  }

  if ((input.databaseType === "postgres" || input.databaseType === "gaussdb") && input.objectType === "VIEW") {
    return [`CREATE OR REPLACE VIEW ${postgresQualifiedName(input.schema, input.name)} AS\n${ensureSemicolon(source)}`];
  }

  const createStatement = ensureSemicolon(source);
  const cleanup = buildRoutineRenameCleanup(input, source);
  return cleanup ? [createStatement, cleanup] : [createStatement];
}

export function buildExecutableObjectSourceSql(input: BuildEditableObjectSourceSqlInput) {
  return buildExecutableObjectSourceStatements(input).join("\n");
}

export function objectSourceSaveExecutionMode(_databaseType: DatabaseType): ObjectSourceSaveExecutionMode {
  return "single";
}
