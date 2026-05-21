export type CellDetailTab = "details" | "valueEditor";
export type ValueEditorAction = "setNull" | "restoreOriginal";

export interface CellDetailPresentationOptions {
  isEditable: boolean;
}

export function defaultCellDetailTab(): CellDetailTab {
  return "details";
}

export function visibleCellDetailTabs(options: CellDetailPresentationOptions): CellDetailTab[] {
  const tabs: CellDetailTab[] = ["details"];
  if (options.isEditable) {
    tabs.push("valueEditor");
  }
  return tabs;
}

export function cellDetailEditorText(value: unknown): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function valueEditorActions(options: { canSetNull: boolean }): ValueEditorAction[] {
  return options.canSetNull ? ["setNull", "restoreOriginal"] : ["restoreOriginal"];
}
