import type { ObjectInfo } from "@/types/database";
import { normalizeDatabaseObjectName } from "@/lib/tableTree";

export type ObjectBrowserRow = {
  id: string;
  name: string;
  schema?: string;
  type: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION";
  comment?: string | null;
};

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
