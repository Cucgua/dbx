import type { ColumnInfo, DatabaseType } from "@/types/database";
import { buildDataGridColumnValueFilterCondition } from "@/lib/dataGridSql";
import { normalizeWhereInput } from "@/lib/tableSelectSql";

export function buildColumnValueFilterCondition(options: {
  databaseType?: DatabaseType;
  columnName: string;
  columnInfo?: Pick<ColumnInfo, "data_type">;
  rawValue: string;
}): Promise<string | undefined> {
  return buildDataGridColumnValueFilterCondition({
    databaseType: options.databaseType,
    columnName: options.columnName,
    columnInfo: options.columnInfo
      ? {
          name: options.columnName,
          data_type: options.columnInfo.data_type,
          is_nullable: true,
        }
      : undefined,
    rawValue: options.rawValue,
  });
}

export function appendColumnValueFilterCondition(
  whereInput: string | undefined,
  condition: string | undefined,
): string {
  if (!condition) return normalizeWhereInput(whereInput);
  const existing = normalizeWhereInput(whereInput);
  return existing ? `(${existing}) AND (${condition})` : condition;
}
