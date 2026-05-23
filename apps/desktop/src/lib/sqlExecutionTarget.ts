import * as api from "./api";

export type ExecuteMode = "all" | "current";

export function resolveExecutableSql(
  fullSql: string,
  selectedSql: string,
  options?: { mode?: ExecuteMode; cursorPos?: number },
): string {
  const trimmedSelection = selectedSql.trim();
  if (trimmedSelection) return trimmedSelection;

  if (options?.mode === "current" && options.cursorPos !== undefined) {
    return fullSql;
  }

  return fullSql;
}

export async function resolveExecutableSqlWithBackend(
  fullSql: string,
  selectedSql: string,
  options?: { mode?: ExecuteMode; cursorPos?: number },
): Promise<string> {
  const trimmedSelection = selectedSql.trim();
  if (trimmedSelection) return trimmedSelection;

  if (options?.mode === "current" && options.cursorPos !== undefined) {
    return await api.findStatementAtCursor(fullSql, options.cursorPos);
  }

  return fullSql;
}
