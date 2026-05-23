import type { ObjectInfo } from "@/types/database";
import { normalizeDatabaseObjectName } from "@/lib/tableTree";

export type ObjectBrowserRow = {
  id: string;
  name: string;
  schema?: string;
  type: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION";
  comment?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ObjectBrowserSortKey = "name" | "type" | "created_at" | "updated_at" | "comment";
export type ObjectBrowserSortDirection = "asc" | "desc";

export function normalizeObjectBrowserType(type: string): ObjectBrowserRow["type"] {
  const value = type.toUpperCase();
  if (value.includes("VIEW")) return "VIEW";
  if (value.includes("PROC")) return "PROCEDURE";
  if (value.includes("FUNC")) return "FUNCTION";
  return "TABLE";
}

export function buildObjectBrowserRows(options: {
  objects: ObjectInfo[];
  database: string;
  fallbackSchema: string;
  needsSchema: boolean;
}): ObjectBrowserRow[] {
  const seen = new Map<string, number>();
  return options.objects.flatMap((object) => {
    const name = normalizeDatabaseObjectName(object.name);
    if (!name) return [];
    const objectSchema = object.schema ? normalizeDatabaseObjectName(object.schema) : undefined;
    const schema = objectSchema || (options.needsSchema ? options.fallbackSchema : undefined);
    const type = normalizeObjectBrowserType(object.object_type);
    const baseId = `${schema || options.fallbackSchema || options.database}:${name}:${type}`;
    const index = seen.get(baseId) ?? 0;
    seen.set(baseId, index + 1);
    return [
      {
        id: `${baseId}:${index}`,
        name,
        schema,
        type,
        comment: object.comment,
        created_at: object.created_at,
        updated_at: object.updated_at,
      },
    ];
  });
}

export function filterObjectBrowserRows(rows: ObjectBrowserRow[], query: string): ObjectBrowserRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.name, row.type, row.comment].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)),
  );
}

export function sortObjectBrowserRows(
  rows: ObjectBrowserRow[],
  key: ObjectBrowserSortKey,
  direction: ObjectBrowserSortDirection,
): ObjectBrowserRow[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const compared = compareObjectBrowserValue(left[key], right[key], key, direction);
    if (compared !== 0) return compared * multiplier;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function initialObjectBrowserSortDirection(key: ObjectBrowserSortKey): ObjectBrowserSortDirection {
  return key === "created_at" || key === "updated_at" ? "desc" : "asc";
}

export function formatObjectBrowserTimestamp(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return "";
  return text
    .replace("T", " ")
    .replace(/\.\d+(?=$|[+-]\d{2}(?::?\d{2})?$)/, "")
    .replace(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/, "");
}

function compareObjectBrowserValue(
  left: string | null | undefined,
  right: string | null | undefined,
  key: ObjectBrowserSortKey,
  direction: ObjectBrowserSortDirection,
): number {
  const leftText = normalizeSortValue(left);
  const rightText = normalizeSortValue(right);
  if (!leftText && !rightText) return 0;
  if (!leftText) return direction === "asc" ? 1 : -1;
  if (!rightText) return direction === "asc" ? -1 : 1;
  if (key === "created_at" || key === "updated_at") return leftText.localeCompare(rightText);
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeSortValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
