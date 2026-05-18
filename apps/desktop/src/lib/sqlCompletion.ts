const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "ASC",
  "DESC",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "DISTINCT",
  "UNION",
  "ALL",
  "EXISTS",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "IF",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "IIF",
  "CHOOSE",
  "COALESCE",
  "CAST",
  "ALTER",
  "DROP",
  "ADD",
  "COLUMN",
  "INDEX",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "DEFAULT",
  "CHECK",
  "UNIQUE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "EXPLAIN",
  "ANALYZE",
  "WITH",
  "RECURSIVE",
  "OVER",
  "PARTITION BY",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "FIRST_VALUE",
  "LAST_VALUE",
  "NTILE",
  "CROSS",
  "APPLY",
  "CROSS APPLY",
  "OUTER APPLY",
  "ISJSON",
  "JSON_ARRAY",
  "JSON_ARRAYAGG",
  "JSON_ARRAY_APPEND",
  "JSON_ARRAY_INSERT",
  "JSON_CONTAINS",
  "JSON_CONTAINS_PATH",
  "JSON_DEPTH",
  "JSON_EXTRACT",
  "JSON_INSERT",
  "JSON_KEYS",
  "JSON_LENGTH",
  "JSON_MERGE_PATCH",
  "JSON_MERGE_PRESERVE",
  "JSON_MODIFY",
  "JSON_OBJECT",
  "JSON_OBJECTAGG",
  "JSON_OVERLAPS",
  "JSON_PATH_EXISTS",
  "JSON_PRETTY",
  "JSON_QUERY",
  "JSON_QUOTE",
  "JSON_REMOVE",
  "JSON_REPLACE",
  "JSON_SCHEMA_VALID",
  "JSON_SEARCH",
  "JSON_SET",
  "JSON_STORAGE_FREE",
  "JSON_STORAGE_SIZE",
  "JSON_TABLE",
  "JSON_TYPE",
  "JSON_UNQUOTE",
  "JSON_VALID",
  "JSON_VALUE",
  "OPENJSON",
  "OPENXML",
  "OPENROWSET",
  "FULL",
  "NATURAL",
  "USING",
  "LATERAL",
  "UNNEST",
  "FILTER",
  "EXCLUDE",
  "REPLACE",
  "QUALIFY",
  "PIVOT",
  "UNPIVOT",
  "ASOF",
  "POSITIONAL",
  "ANTI",
  "SEMI",
  "SAMPLE",
  "TABLESAMPLE",
  "STRUCT",
  "MAP",
  "LIST",
  "ARRAY",
  "LAMBDA",
  "LIST_TRANSFORM",
  "READ_CSV",
  "READ_PARQUET",
  "READ_JSON",
  "COPY",
  "EXPORT",
  "IMPORT",
  "DESCRIBE",
  "SHOW",
  "SUMMARIZE",
  "PRAGMA",
  "BIGINT",
  "BINARY",
  "BIT",
  "CHAR",
  "DATE",
  "DATETIME",
  "DATETIME2",
  "DATETIMEOFFSET",
  "DECIMAL",
  "FLOAT",
  "IMAGE",
  "INT",
  "MONEY",
  "NCHAR",
  "NTEXT",
  "NUMERIC",
  "NVARCHAR",
  "REAL",
  "SMALLDATETIME",
  "SMALLINT",
  "SMALLMONEY",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "TINYINT",
  "UNIQUEIDENTIFIER",
  "VARBINARY",
  "VARCHAR",
  "XML",
  // Common built-in functions
  "ABS",
  "CEIL",
  "CEILING",
  "FLOOR",
  "ROUND",
  "MOD",
  "POWER",
  "SQRT",
  "SIGN",
  "TRUNCATE",
  "CONCAT",
  "CONCAT_WS",
  "LENGTH",
  "CHAR_LENGTH",
  "UPPER",
  "LOWER",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "SUBSTRING",
  "SUBSTR",
  "INSTR",
  "LOCATE",
  "LPAD",
  "RPAD",
  "REVERSE",
  "REPEAT",
  "SPACE",
  "FORMAT",
  "HEX",
  "UNHEX",
  "NOW",
  "CURDATE",
  "CURTIME",
  "DATE_ADD",
  "DATE_SUB",
  "DATE_FORMAT",
  "DATEDIFF",
  "TIMESTAMPDIFF",
  "EXTRACT",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "DAYOFWEEK",
  "DAYOFYEAR",
  "LAST_DAY",
  "STR_TO_DATE",
  "CONVERT",
  "IFNULL",
  "NULLIF",
  "GREATEST",
  "LEAST",
  "GROUP_CONCAT",
  "FIND_IN_SET",
  "FIELD",
  "ELT",
  "REGEXP",
  "REGEXP_LIKE",
  "REGEXP_REPLACE",
  "REGEXP_SUBSTR",
  "UUID",
  "MD5",
  "SHA1",
  "SHA2",
  "CRC32",
];

const TABLE_TRIGGER_KEYWORDS = new Set(["from", "join", "update", "into", "table", "describe", "explain", "apply"]);
const JOIN_MODIFIERS = new Set(["left", "right", "inner", "outer", "cross", "full", "natural"]);
const MAX_TABLE_COMPLETION_ITEMS = 200;

const SQL_SNIPPETS: Array<{ label: string; prefix: string; apply: string; detail: string }> = [
  {
    label: "select *",
    prefix: "sel",
    apply: "SELECT *\nFROM ${table}\nLIMIT 100;",
    detail: "SELECT template",
  },
  {
    label: "insert into",
    prefix: "ins",
    apply: "INSERT INTO ${table} (${columns})\nVALUES (${values});",
    detail: "INSERT template",
  },
  {
    label: "update set",
    prefix: "upd",
    apply: "UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};",
    detail: "UPDATE template",
  },
  {
    label: "common table expression",
    prefix: "cte",
    apply: "WITH ${name} AS (\n  SELECT ${columns}\n  FROM ${table}\n)\nSELECT *\nFROM ${name};",
    detail: "CTE template",
  },
  {
    label: "join",
    prefix: "join",
    apply: "JOIN ${table} ON ${left_column} = ${right_column}",
    detail: "JOIN template",
  },
];

const SQL_FUNCTION_SIGNATURES = new Map<string, string[]>([
  ["COUNT", ["expression"]],
  ["SUM", ["expression"]],
  ["AVG", ["expression"]],
  ["MIN", ["expression"]],
  ["MAX", ["expression"]],
  ["DATE_FORMAT", ["date", "format"]],
  ["DATEDIFF", ["date1", "date2"]],
  ["TIMESTAMPDIFF", ["unit", "datetime_expr1", "datetime_expr2"]],
  ["DATE_ADD", ["date", "interval"]],
  ["DATE_SUB", ["date", "interval"]],
  ["SUBSTRING", ["string", "start", "length"]],
  ["SUBSTR", ["string", "start", "length"]],
  ["CONCAT", ["value", "...values"]],
  ["COALESCE", ["value", "...values"]],
  ["CAST", ["expression", "type"]],
  ["ROUND", ["number", "decimals"]],
  ["IFNULL", ["expression", "fallback"]],
  ["NULLIF", ["expression1", "expression2"]],
]);

export interface SqlCompletionTable {
  name: string;
  schema?: string;
  type?: "table" | "view";
}

export interface SqlCompletionColumn {
  name: string;
  table: string;
  schema?: string;
  dataType?: string;
}

export interface SqlCompletionItem {
  label: string;
  type: "keyword" | "table" | "column" | "snippet";
  detail?: string;
  apply?: string;
  boost: number;
}

export interface SqlCompletionReferencedTable {
  name: string;
  schema?: string;
  alias?: string;
}

export interface SqlCompletionContext {
  prefix: string;
  qualifier?: string;
  suggestTables: boolean;
  suggestColumns: boolean;
  suggestKeywords: boolean;
  suggestJoinConditions: boolean;
  prioritizeSelectAliases: boolean;
  selectAliases: string[];
  referencedTables: SqlCompletionReferencedTable[];
}

export interface SqlFunctionSignatureHelp {
  name: string;
  signature: string;
  activeParameter: number;
  parameters: string[];
}

export function buildSqlCompletionItems(
  sql: string,
  cursor: number,
  input: {
    tables: SqlCompletionTable[];
    columnsByTable: Map<string, SqlCompletionColumn[]>;
  },
): SqlCompletionItem[] {
  const context = getSqlCompletionContext(sql, cursor);
  return buildSqlCompletionItemsFromContext(context, input);
}

export function buildSqlCompletionItemsFromContext(
  context: SqlCompletionContext,
  input: {
    tables: SqlCompletionTable[];
    columnsByTable: Map<string, SqlCompletionColumn[]>;
  },
): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];

  items.push(...buildSnippetItems(context.prefix));
  items.push(...buildFunctionSnippetItems(context.prefix));

  if (context.prioritizeSelectAliases) {
    items.push(...buildSelectAliasItems(context));
  }

  if (context.suggestJoinConditions) {
    items.push(...buildJoinConditionItems(context, input.columnsByTable));
  }

  // Always suggest keywords (regardless of qualifier)
  if (context.suggestKeywords) {
    items.push(...buildKeywordItems(context.prefix));
  }

  if (context.suggestColumns) {
    items.push(...buildColumnItems(context, input.columnsByTable));
  }

  if (context.suggestTables) {
    items.push(...buildTableItems(context.prefix, input.tables));
  }

  return dedupeAndSort(items);
}

export function shouldAutoOpenSqlCompletion(sql: string, cursor: number): boolean {
  const previousChar = sql[cursor - 1];
  if (!previousChar) return false;
  if (/\bon\s+$/i.test(sql.slice(0, cursor))) return true;
  return /[\w$.]/.test(previousChar);
}

export function getSqlFunctionSignatureHelp(sql: string, cursor: number): SqlFunctionSignatureHelp | null {
  const beforeCursor = sql.slice(0, cursor);
  const openParenIndex = findActiveFunctionOpenParen(beforeCursor);
  if (openParenIndex == null) return null;

  const beforeParen = beforeCursor.slice(0, openParenIndex).trimEnd();
  const name = /([A-Za-z_][\w$]*)$/.exec(beforeParen)?.[1]?.toUpperCase();
  if (!name) return null;

  const parameters = SQL_FUNCTION_SIGNATURES.get(name);
  if (!parameters) return null;

  const activeParameter = countTopLevelCommas(beforeCursor.slice(openParenIndex + 1));
  return {
    name,
    signature: `${name}(${parameters.join(", ")})`,
    activeParameter: Math.min(activeParameter, Math.max(0, parameters.length - 1)),
    parameters,
  };
}

/**
 * Find the start position of the SQL statement containing the cursor.
 * Respects semicolons and string literals.
 */
function extractStatementStart(sql: string, cursor: number): number {
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
      if (i < cursor) {
        start = i + 1;
        while (start < sql.length && /\s/.test(sql[start])) start++;
      }
    }
  }
  return start;
}

/**
 * Extract the full SQL statement that contains the cursor position.
 * Respects semicolons and string literals.
 */
function extractStatementAt(sql: string, cursor: number): string {
  const start = extractStatementStart(sql, cursor);
  let end = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (ch === ";" && !inSingleQuote && !inDoubleQuote && i >= cursor) {
      end = i;
      break;
    }
  }
  return sql.slice(start, end).trim();
}

export function getSqlCompletionContext(sql: string, cursor: number): SqlCompletionContext {
  // Extract the full statement at cursor position for referenced tables
  const fullStatement = extractStatementAt(sql, cursor);

  // Content before cursor within the current statement
  const stmtStart = extractStatementStart(sql, cursor);
  const beforeCursor = sql.slice(stmtStart, cursor);

  const dottedMatch = /([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)?$/.exec(beforeCursor);
  const plainMatch = /([A-Za-z_][\w$]*)$/.exec(beforeCursor);
  const prefix = dottedMatch?.[2] ?? plainMatch?.[1] ?? "";
  const qualifier = dottedMatch?.[1];
  const bareStart = qualifier
    ? beforeCursor.length - prefix.length
    : beforeCursor.length - (plainMatch?.[1]?.length ?? 0);
  const beforeToken = beforeCursor.slice(0, Math.max(0, bareStart)).trimEnd();
  const lastWord = /([A-Za-z_][\w$]*)$/.exec(beforeToken)?.[1]?.toLowerCase() ?? "";

  const referencedTables = extractReferencedTables(fullStatement);

  const afterTableTrigger =
    TABLE_TRIGGER_KEYWORDS.has(lastWord) ||
    (JOIN_MODIFIERS.has(lastWord) && isFollowedByJoin(beforeToken)) ||
    isInTableListContext(beforeToken);

  // Check if we're in a context where columns are expected
  const inColumnContext = isInColumnContext(beforeCursor);
  const inJoinConditionContext = isInJoinConditionContext(beforeCursor);
  const prioritizeSelectAliases = isInOrderOrGroupByContext(beforeCursor);

  return {
    prefix,
    qualifier,
    // Suggest tables ONLY after FROM/JOIN/UPDATE/INTO/etc keywords
    suggestTables: afterTableTrigger,
    // Suggest columns when:
    // 1. There's a table qualifier (table.column)
    // 2. We're in a column context (WHERE, ON, SELECT, etc.) AND there are referenced tables
    suggestColumns: !!qualifier || (inColumnContext && referencedTables.length > 0),
    // Always suggest keywords
    suggestKeywords: true,
    suggestJoinConditions: inJoinConditionContext && referencedTables.length >= 2,
    prioritizeSelectAliases,
    selectAliases: prioritizeSelectAliases ? extractSelectAliases(fullStatement) : [],
    referencedTables,
  };
}

/**
 * Check if the content before cursor is in a column-expected context.
 */
function isInColumnContext(beforeCursor: string): boolean {
  if (!beforeCursor) return false;

  // Strip string literals
  const cleaned = beforeCursor.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, "''");

  // Get all words/tokens
  const lastWords = cleaned.trimEnd().split(/\s+/);

  // Check the last 3 words for column-context keywords
  for (let i = lastWords.length - 1; i >= Math.max(0, lastWords.length - 3); i--) {
    const word = lastWords[i]?.toLowerCase().replace(/[^a-z0-9.]/g, "") ?? "";
    // Operators that indicate column context
    if (/^[=<>!+\-*/(,]$/.test(word)) return true;
    // Keywords that directly precede column expressions
    if (["where", "on", "having", "set", "and", "or", "not", "is", "like", "in", "between", "select"].includes(word)) {
      return true;
    }
    // "ORDER BY" / "GROUP BY" — when we see "by", check the word before it
    if (word === "by" && i > 0) {
      const prevWord = lastWords[i - 1]?.toLowerCase() ?? "";
      if (["order", "group"].includes(prevWord)) return true;
    }
  }

  return false;
}

function isInJoinConditionContext(beforeCursor: string): boolean {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, "''")
    .toLowerCase();
  const lastJoinIndex = cleaned.lastIndexOf(" join ");
  const currentJoinSegment = lastJoinIndex >= 0 ? cleaned.slice(lastJoinIndex) : cleaned;
  if (!/\bon\b/.test(currentJoinSegment)) return false;
  return /\b(?:on|and)\s+[a-z0-9_$]*$/i.test(currentJoinSegment);
}

function isInOrderOrGroupByContext(beforeCursor: string): boolean {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .toLowerCase();
  const lastOrderBy = cleaned.lastIndexOf("order by");
  const lastGroupBy = cleaned.lastIndexOf("group by");
  const lastContext = Math.max(lastOrderBy, lastGroupBy);
  if (lastContext < 0) return false;

  const segment = cleaned.slice(lastContext);
  return !/\b(?:where|having|limit|offset|union|intersect|except|join|from)\b/.test(segment);
}

function extractReferencedTables(sql: string): SqlCompletionReferencedTable[] {
  // Keywords that should NOT be treated as table aliases
  const ALIAS_BLACKLIST = new Set([
    "where",
    "group",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "intersect",
    "except",
    "and",
    "or",
    "not",
    "is",
    "like",
    "in",
    "between",
    "exists",
    "select",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "apply",
    "full",
    "natural",
    "on",
    "as",
    "set",
    "insert",
    "update",
    "delete",
    "create",
    "drop",
    "alter",
    "into",
    "values",
    "returning",
    "for",
    "window",
    "partition",
    "over",
    "with",
    "recursive",
    "lateral",
    "when",
    "then",
    "else",
    "end",
    "case",
    "cast",
    "coalesce",
    "null",
    "true",
    "false",
    "distinct",
    "all",
    "primary",
    "key",
    "foreign",
    "references",
    "constraint",
    "default",
    "check",
    "unique",
    "index",
    "table",
    "view",
    "database",
    "schema",
    "describe",
    "explain",
    "analyze",
    "pivot",
    "unpivot",
    "asof",
    "positional",
    "anti",
    "semi",
    "sample",
    "filter",
    "qualify",
    "offset",
    "fetch",
    "next",
    "rows",
    "only",
    "preceding",
    "following",
    "current",
    "unbounded",
    "asc",
    "desc",
    "nulls",
    "first",
    "last",
    "ignore",
    "respect",
  ]);

  const pattern =
    /\b(?:from|join|update|into|apply)\s+((?:"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*))?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  const referenced: SqlCompletionReferencedTable[] = [];
  for (const match of sql.matchAll(pattern)) {
    const rawName = match[1];
    const alias = match[2];
    const [first, second] = splitQualifiedName(rawName);
    if (!first) continue;
    // Filter out SQL keywords that accidentally matched as aliases
    const cleanAlias = alias && !ALIAS_BLACKLIST.has(alias.toLowerCase()) ? alias : undefined;
    const table = second ? { schema: first, name: second, alias: cleanAlias } : { name: first, alias: cleanAlias };
    referenced.push(table);
  }
  return referenced;
}

function extractSelectAliases(sql: string): string[] {
  const selectList = extractSelectList(sql);
  if (!selectList) return [];

  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const expression of splitTopLevel(selectList, ",")) {
    const alias = extractSelectAlias(expression);
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }

  return aliases;
}

function extractSelectList(sql: string): string | null {
  const lower = sql.toLowerCase();
  const selectIndex = lower.search(/\bselect\b/);
  if (selectIndex < 0) return null;

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = selectIndex + "select".length; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      lower.slice(i, i + "from".length) === "from" &&
      !isIdentifierPart(sql[i - 1]) &&
      !isIdentifierPart(sql[i + "from".length])
    ) {
      return sql.slice(selectIndex + "select".length, i).trim();
    }
  }

  return null;
}

function extractSelectAlias(expression: string): string | null {
  const trimmed = expression.trim();
  const explicitAlias = /\bas\s+([A-Za-z_][\w$]*)$/i.exec(trimmed)?.[1];
  if (explicitAlias) return explicitAlias;

  const implicitAlias = /(?:^|[\s)])([A-Za-z_][\w$]*)$/.exec(trimmed)?.[1];
  if (!implicitAlias) return null;
  const expressionWithoutAlias = trimmed.slice(0, trimmed.length - implicitAlias.length).trimEnd();
  if (!expressionWithoutAlias || /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?$/.test(trimmed)) return null;
  return implicitAlias;
}

function isIdentifierPart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function splitQualifiedName(input: string): [string | undefined, string | undefined] {
  const parts = input
    .split(".")
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [parts[0], undefined];
}

function unquoteIdentifier(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("`") && value.endsWith("`"))) {
    return value.slice(1, -1);
  }
  return value;
}

function buildTableItems(prefix: string, tables: SqlCompletionTable[]): SqlCompletionItem[] {
  return tables
    .filter((table) => matchesPrefix(table.name, prefix))
    .slice(0, MAX_TABLE_COMPLETION_ITEMS)
    .map((table) => ({
      label: table.name,
      type: "table" as const,
      detail: table.schema ? `${table.schema}.${table.name}` : table.type,
      boost: computeBoost(table.name, prefix) + 1000,
    }));
}

function isFollowedByJoin(beforeToken: string): boolean {
  const words = beforeToken.trimEnd().split(/\s+/);
  const second = words[words.length - 2]?.toLowerCase();
  return second === "join" || JOIN_MODIFIERS.has(second ?? "");
}

function isInTableListContext(beforeToken: string): boolean {
  return /,\s*$/.test(beforeToken) && /\b(?:from|join|update|into)\b/i.test(beforeToken);
}

function buildColumnItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
): SqlCompletionItem[] {
  // Collect all columns from the map (all tables have been fetched)
  const allColumns: Array<SqlCompletionColumn & { key: string }> = [];
  for (const [key, cols] of columnsByTable.entries()) {
    for (const col of cols) {
      allColumns.push({ ...col, key });
    }
  }

  // If there's a qualifier (e.g., c.card_name), filter to tables matching the qualifier
  let relevantCols = allColumns;
  if (context.qualifier) {
    const q = context.qualifier;
    const qLower = q.toLowerCase();
    // Find tables whose name OR alias matches the qualifier
    const relatedTables = context.referencedTables.filter(
      (table) =>
        table.alias === q ||
        table.alias?.toLowerCase() === qLower ||
        table.name === q ||
        table.name.toLowerCase() === qLower,
    );
    // Build a set of actual table names to filter by
    const tableNameSet = new Set(relatedTables.map((t) => t.name.toLowerCase()));
    // Also build all possible key formats for columnsByTable matching
    const tableKeys = new Set<string>();
    for (const table of relatedTables) {
      tableKeys.add(table.name);
      if (table.schema) {
        tableKeys.add(`${table.schema}.${table.name}`);
      }
    }
    // Filter columns by matching the column's table name or the map key
    relevantCols = allColumns.filter((c) => tableNameSet.has(c.table.toLowerCase()) || tableKeys.has(c.key));
  }

  // Deduplicate columns by name
  const seen = new Set<string>();
  const uniqueColumns = relevantCols.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  return uniqueColumns
    .filter((column) => matchesPrefix(column.name, context.prefix))
    .map((column) => ({
      label: column.name,
      type: "column" as const,
      detail: column.schema ? `${column.schema}.${column.table}` : column.table,
      boost: computeBoost(column.name, context.prefix),
    }));
}

function buildJoinConditionItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
): SqlCompletionItem[] {
  const refs = context.referencedTables;
  if (refs.length < 2) return [];

  const latest = refs[refs.length - 1];
  const previousRefs = refs.slice(0, -1);
  const items: SqlCompletionItem[] = [];

  for (const previous of previousRefs) {
    const previousColumns = columnsForReferencedTable(previous, columnsByTable);
    const latestColumns = columnsForReferencedTable(latest, columnsByTable);
    items.push(...buildJoinConditionItemsForPair(previous, previousColumns, latest, latestColumns, context.prefix));
  }

  return items;
}

function columnsForReferencedTable(
  table: SqlCompletionReferencedTable,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
): SqlCompletionColumn[] {
  const keys = table.schema ? [`${table.schema}.${table.name}`, table.name] : [table.name];
  for (const key of keys) {
    const columns = columnsByTable.get(key);
    if (columns) return columns;
  }
  return [];
}

function buildJoinConditionItemsForPair(
  left: SqlCompletionReferencedTable,
  leftColumns: SqlCompletionColumn[],
  right: SqlCompletionReferencedTable,
  rightColumns: SqlCompletionColumn[],
  prefix: string,
): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];
  const leftRef = left.alias || left.name;
  const rightRef = right.alias || right.name;
  const leftTableKey = singularTableName(left.name);
  const rightTableKey = singularTableName(right.name);

  for (const leftColumn of leftColumns) {
    for (const rightColumn of rightColumns) {
      const leftName = leftColumn.name.toLowerCase();
      const rightName = rightColumn.name.toLowerCase();
      const leftLabel = `${leftRef}.${leftColumn.name}`;
      const rightLabel = `${rightRef}.${rightColumn.name}`;
      let boost = 0;

      if (leftName === "id" && rightName === `${leftTableKey}_id`) {
        boost = 2300;
      } else if (rightName === "id" && leftName === `${rightTableKey}_id`) {
        boost = 2300;
      } else if (leftName !== "id" && leftName === rightName) {
        boost = 1700;
      }

      if (!boost) continue;
      const label = `${leftLabel} = ${rightLabel}`;
      if (prefix && !matchesPrefix(label, prefix)) continue;
      items.push({
        label,
        type: "snippet",
        detail: "JOIN condition",
        apply: label,
        boost,
      });
    }
  }

  return items;
}

function singularTableName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 3) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("s") && lower.length > 1) return lower.slice(0, -1);
  return lower;
}

function buildSnippetItems(prefix: string): SqlCompletionItem[] {
  if (!prefix) return [];
  return SQL_SNIPPETS.filter(
    (snippet) => matchesPrefix(snippet.prefix, prefix) || matchesPrefix(snippet.label, prefix),
  ).map((snippet) => ({
    label: snippet.label,
    type: "snippet" as const,
    detail: snippet.detail,
    apply: snippet.apply,
    boost: computeBoost(snippet.prefix, prefix) - 1100,
  }));
}

function buildFunctionSnippetItems(prefix: string): SqlCompletionItem[] {
  return [...SQL_FUNCTION_SIGNATURES.entries()]
    .filter(([name]) => matchesPrefix(name, prefix))
    .map(([name, parameters]) => ({
      label: name,
      type: "snippet" as const,
      detail: "function",
      apply: `${name}(${parameters.map((parameter) => `\${${parameter}}`).join(", ")})`,
      boost: computeBoost(name, prefix) + 300,
    }));
}

function buildSelectAliasItems(context: SqlCompletionContext): SqlCompletionItem[] {
  return context.selectAliases
    .filter((alias) => matchesPrefix(alias, context.prefix))
    .map((alias, index) => ({
      label: alias,
      type: "column" as const,
      detail: "SELECT alias",
      boost: computeBoost(alias, context.prefix) + 3500 - index,
    }));
}

function buildKeywordItems(prefix: string): SqlCompletionItem[] {
  return SQL_KEYWORDS.filter((keyword) => !SQL_FUNCTION_SIGNATURES.has(keyword) && matchesPrefix(keyword, prefix)).map(
    (keyword) => ({
      label: keyword,
      type: "keyword" as const,
      boost: computeBoost(keyword, prefix),
    }),
  );
}

function matchesPrefix(candidate: string, prefix: string): boolean {
  if (!prefix) return true;
  return candidate.toLowerCase().includes(prefix.toLowerCase());
}

function computeBoost(candidate: string, prefix: string): number {
  if (!prefix) return 1;
  const candidateLower = candidate.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (candidateLower === prefixLower) return 3000 - candidate.length;
  if (candidateLower.startsWith(prefixLower)) return 2000 - candidate.length;
  return 100 - candidate.length;
}

function dedupeAndSort(items: SqlCompletionItem[]): SqlCompletionItem[] {
  const seen = new Set<string>();
  return items
    .sort((left, right) => right.boost - left.boost)
    .filter((item) => {
      const key = `${item.type}:${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function findActiveFunctionOpenParen(sqlBeforeCursor: string): number | null {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = sqlBeforeCursor.length - 1; i >= 0; i--) {
    const ch = sqlBeforeCursor[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth === 0) return i;
      depth--;
    }
  }

  return null;
}

function countTopLevelCommas(text: string): number {
  let count = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) count++;
  }

  return count;
}
