// Binary column types that should not be edited inline
export const BINARY_TYPES = new Set([
  "blob",
  "clob",
  "bytea",
  "varbinary",
  "binary",
  "image",
  "longblob",
  "mediumblob",
  "tinyblob",
  "blob sub_type 2004",
  "blob sub_type 2005",
]);

export function isBinaryType(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return BINARY_TYPES.has(lower);
}

export interface EditableQueryInfo {
  schema: string | undefined;
  tableName: string;
  selectStar: boolean;
  columns: string[]; // empty array if SELECT *
}

/**
 * Parse a SELECT statement to determine if it's editable.
 * Only simple single-table SELECT queries are considered editable:
 * - No JOIN, GROUP BY, HAVING, UNION, subqueries, CTEs, DISTINCT, aggregations
 * - Must have a single FROM clause with one table
 * - WHERE, ORDER BY, LIMIT are allowed
 */
export function analyzeEditableQuery(sql: string): EditableQueryInfo | null {
  const trimmed = sql.trim();

  // Strip trailing semicolons and whitespace
  const cleaned = trimmed.replace(/;+\s*$/, "").trim();

  // Must start with SELECT (case-insensitive)
  if (!/^SELECT\b/i.test(cleaned)) return null;

  // Reject CTEs (WITH clause before SELECT)
  if (/^\s*WITH\b/i.test(trimmed)) return null;

  // Remove inline comments and block comments
  const normalized = cleaned.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // Reject UNION, INTERSECT, EXCEPT
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(normalized)) return null;

  // --- Extract SELECT body (columns) ---
  // Match everything between SELECT and the first SQL clause keyword (FROM, WHERE, ORDER, etc.)
  const selectMatch = normalized.match(
    /^SELECT\s+(.+?)(?:\bFROM\b|\bWHERE\b|\bORDER\b|\bLIMIT\b|\bGROUP\b|\bHAVING\b|$)/is,
  );
  if (!selectMatch) return null;
  const selectBody = selectMatch[1].trim();

  // Reject DISTINCT
  if (/^\s*DISTINCT\b/i.test(selectBody)) return null;

  // Check if SELECT *
  const selectStar = /^\s*\*\s*$/.test(selectBody);
  const columns: string[] = [];
  if (!selectStar) {
    columns.push(...parseSelectColumns(selectBody));
  }

  // --- Extract FROM body ---
  const fromMatch = normalized.match(/\bFROM\s+(.+?)(?:\bWHERE\b|\bORDER\b|\bLIMIT\b|\bGROUP\b|\bHAVING\b|$)/is);
  if (!fromMatch) return null;
  const fromBody = fromMatch[1].trim();

  // Reject JOIN
  if (/\bJOIN\b/i.test(fromBody)) return null;

  // Reject GROUP BY, HAVING (already partially covered but double-check)
  if (/\b(GROUP\s+BY|HAVING)\b/i.test(fromBody)) return null;

  // Reject subqueries: if FROM body contains SELECT keyword
  if (/\bSELECT\b/i.test(fromBody)) return null;

  // Also reject if there's a SELECT anywhere after FROM (subquery in WHERE etc.)
  const fromIdx = normalized.toUpperCase().indexOf("FROM");
  if (fromIdx >= 0) {
    const afterFirstFrom = normalized.slice(fromIdx);
    // Count SELECT occurrences after FROM — should be 0 (the original SELECT is before FROM)
    const selectCount = (afterFirstFrom.match(/\bSELECT\b/g) || []).length;
    if (selectCount > 0) return null;
  }

  // --- Extract table name from FROM clause ---
  // Strip all quoting characters (backticks, double quotes, square brackets)
  const stripped = fromBody.replace(/[`"[\]]/g, "").trim();

  // Match: table OR schema.table
  const tableMatch = stripped.match(/^(\w+)(?:\.(\w+))?/);
  if (!tableMatch) return null;

  const schema = tableMatch[2] ? tableMatch[1] : undefined;
  const tableName = tableMatch[2] || tableMatch[1];

  return {
    schema,
    tableName,
    selectStar,
    columns,
  };
}

function parseSelectColumns(body: string): string[] {
  const cols: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      cols.push(extractColumnName(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    cols.push(extractColumnName(current.trim()));
  }
  return cols;
}

function extractColumnName(col: string): string {
  // Handle AS alias
  const asMatch = col.match(/\bAS\s+(\w+)/i);
  if (asMatch) return asMatch[1];

  // Strip quoting characters
  const stripped = col.replace(/[`"'[\]]/g, "");

  // Take last identifier (handles table.column -> column)
  const parts = stripped.split(".");
  return parts[parts.length - 1] || stripped;
}

/**
 * Check if all primary key columns are present in the result set columns.
 * Comparison is case-insensitive.
 */
export function allPrimaryKeysPresent(primaryKeys: string[], resultColumns: string[]): boolean {
  const colSet = new Set(resultColumns.map((c) => c.toLowerCase()));
  return primaryKeys.every((pk) => colSet.has(pk.toLowerCase()));
}
