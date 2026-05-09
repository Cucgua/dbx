import type { QueryTab } from "@/types/database";

export interface SavedOpenTab {
  id: string;
  title: string;
  connectionId: string;
  database: string;
  schema?: string;
  sql: string;
  pinned?: boolean;
  mode?: QueryTab["mode"];
  tableMeta?: QueryTab["tableMeta"];
}

export interface RestoredOpenTabs {
  tabs: QueryTab[];
  activeTabId: string | null;
}

export function serializeOpenTabs(tabs: QueryTab[]): SavedOpenTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    connectionId: tab.connectionId,
    database: tab.database,
    schema: tab.schema,
    sql: tab.sql,
    pinned: tab.pinned,
    mode: tab.mode,
    tableMeta: tab.tableMeta,
  }));
}

function isSavedOpenTab(value: unknown): value is SavedOpenTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.id === "string" &&
    typeof tab.title === "string" &&
    typeof tab.connectionId === "string" &&
    typeof tab.database === "string" &&
    typeof tab.sql === "string"
  );
}

export function restoreOpenTabsState(
  rawTabs: string | null,
  rawActiveTabId: string | null,
  options: { queryOnly?: boolean } = {},
): RestoredOpenTabs {
  if (!rawTabs) return { tabs: [], activeTabId: null };

  try {
    const parsed = JSON.parse(rawTabs);
    if (!Array.isArray(parsed)) return { tabs: [], activeTabId: null };

    const saved = parsed.filter(isSavedOpenTab);
    const filtered = options.queryOnly ? saved.filter((tab) => (tab.mode ?? "query") === "query") : saved;
    const tabs: QueryTab[] = filtered.map((tab) => ({
      ...tab,
      mode: tab.mode ?? "query",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
    }));
    const activeTabId = rawActiveTabId || null;

    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id || null,
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}
