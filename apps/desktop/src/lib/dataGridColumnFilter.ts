import type { ColumnInfo, DatabaseType } from "@/types/database";
import { formatGridSqlLiteral } from "@/lib/dataGridSql";
import { quoteTableIdentifier, normalizeWhereInput } from "@/lib/tableSelectSql";

export function buildColumnValueFilterCondition(options: {
  databaseType?: DatabaseType;
  columnName: string;
  columnInfo?: Pick<ColumnInfo, "data_type">;
  rawValue: string;
}): string | undefined {
  const text = options.rawValue.trim();
  if (!text) return undefined;

  const column = columnFilterRef(options.databaseType, options.columnName);
  if (/^null$/i.test(text)) return `${column} IS NULL`;
  return `${column} = ${formatGridSqlLiteral(parseTypedFilterValue(text, options.columnInfo), options.databaseType)}`;
}

export function appendColumnValueFilterCondition(
  whereInput: string | undefined,
  condition: string | undefined,
): string {
  if (!condition) return normalizeWhereInput(whereInput);
  const existing = normalizeWhereInput(whereInput);
  return existing ? `(${existing}) AND (${condition})` : condition;
}

function columnFilterRef(databaseType: DatabaseType | undefined, columnName: string): string {
  const quoted = quoteTableIdentifier(databaseType, columnName);
  return databaseType === "neo4j" ? `n.${quoted}` : quoted;
}

function parseTypedFilterValue(text: string, columnInfo: Pick<ColumnInfo, "data_type"> | undefined) {
  const unquoted = unwrapMatchingQuotes(text);
  const dataType = columnInfo?.data_type.toLowerCase() ?? "";
  if (isBooleanType(dataType) && /^(true|false)$/i.test(unquoted)) return /^true$/i.test(unquoted);
  if ((isNumericType(dataType) || !dataType) && isNumericLiteral(unquoted)) return Number(unquoted);
  return unquoted;
}

function unwrapMatchingQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) return text.slice(1, -1);
  return text;
}

function isNumericType(dataType: string): boolean {
  return /\b(int|integer|bigint|smallint|tinyint|mediumint|serial|number|numeric|decimal|float|double|real|money)\b/i.test(
    dataType,
  );
}

function isBooleanType(dataType: string): boolean {
  return /\b(bool|boolean|bit)\b/i.test(dataType);
}

function isNumericLiteral(text: string): boolean {
  return /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text));
}
