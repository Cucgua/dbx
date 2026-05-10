export type ExportCellValue = string | number | boolean | null;

export function formatCsv(columns: string[], rows: ExportCellValue[][]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = columns.map(esc).join(",");
  const body = rows.map((row) => row.map((c) => esc(c === null ? "" : String(c))).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function formatJson(columns: string[], rows: ExportCellValue[][]): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

export function formatSqlInsert(
  qualifiedName: string,
  columns: string[],
  rows: ExportCellValue[][],
  quoteIdent: (name: string) => string,
): string {
  const cols = columns.map((c) => quoteIdent(c)).join(", ");
  const lines = rows.map((row) => {
    const vals = row
      .map((v) => {
        if (v === null) return "NULL";
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      })
      .join(", ");
    return `INSERT INTO ${qualifiedName} (${cols}) VALUES (${vals});`;
  });
  return lines.join("\n");
}
