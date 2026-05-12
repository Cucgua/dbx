import { ref, type Ref, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import { useQueryStore } from "@/stores/queryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToast } from "@/composables/useToast";
import type { ConnectionConfig, QueryTab } from "@/types/database";

const DANGER_RE = /^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE|MERGE|REPLACE)\b/i;
const READ_RE = /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|MERGE|REPLACE|TRUNCATE)\b/i;
const SCHEMA_RE = /^\s*(CREATE|ALTER|DROP|RENAME)\b/i;

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

export function isDangerousSql(sql: string): boolean {
  const cleaned = stripSqlComments(sql);
  return cleaned.split(";").some((stmt) => DANGER_RE.test(stmt));
}

function primarySqlOperation(sql: string): string {
  const cleaned = stripSqlComments(sql);
  const statement = cleaned
    .split(";")
    .map((part) => part.trim())
    .find(Boolean);
  return statement?.match(/^([a-z]+)/i)?.[1]?.toUpperCase() || "SQL";
}

function activityKindForSql(sql: string): "query" | "data_change" | "schema_change" {
  const cleaned = stripSqlComments(sql);
  const statements = cleaned
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
  if (statements.some((stmt) => SCHEMA_RE.test(stmt))) return "schema_change";
  if (statements.some((stmt) => WRITE_RE.test(stmt))) return "data_change";
  if (statements.every((stmt) => READ_RE.test(stmt))) return "query";
  return "query";
}

export function useSqlExecution(deps: {
  activeTab: ComputedRef<QueryTab | undefined>;
  activeConnection: ComputedRef<ConnectionConfig | undefined>;
  executableSql: ComputedRef<string>;
  activeOutputView: Ref<"result" | "explain" | "chart">;
}) {
  const { t } = useI18n();
  const queryStore = useQueryStore();
  const historyStore = useHistoryStore();
  const connectionStore = useConnectionStore();
  const { toast } = useToast();

  const dangerSql = ref("");
  const pendingDangerSql = ref("");
  const showDangerDialog = ref(false);

  function tryExecute(sqlOverride?: string) {
    const tab = deps.activeTab.value;
    const sql = sqlOverride ?? deps.executableSql.value;
    if (!tab || !sql.trim()) return;
    if (isDangerousSql(sql)) {
      dangerSql.value = sql;
      pendingDangerSql.value = sql;
      showDangerDialog.value = true;
    } else {
      doExecute(sql);
    }
  }

  async function doExecute(sql = deps.executableSql.value) {
    const tab = deps.activeTab.value;
    if (!tab || !sql.trim()) return;
    deps.activeOutputView.value = "result";
    const connName = connectionStore.getConfig(tab.connectionId)?.name || "";
    const start = Date.now();
    await queryStore.executeCurrentSql(sql);
    const elapsed = Date.now() - start;
    const success = !tab.result?.columns.includes("Error");
    historyStore.add({
      connection_id: tab.connectionId,
      connection_name: connName,
      database: tab.database,
      sql,
      execution_time_ms: elapsed,
      success,
      error: success ? undefined : String(tab.result?.rows?.[0]?.[0] ?? ""),
      activity_kind: activityKindForSql(sql),
      operation: primarySqlOperation(sql),
      affected_rows: success ? tab.result?.affected_rows : undefined,
    });
  }

  function cancelActiveExecution() {
    const tab = deps.activeTab.value;
    if (!tab) return;
    if (tab.isExecuting) void queryStore.cancelTabExecution(tab.id);
    else if (tab.isExplaining) void queryStore.cancelTabExplain(tab.id);
  }

  function explainReasonMessage(reason: string): string {
    if (reason === "unsupported") return t("explain.unsupported");
    if (reason === "unsafe") return t("explain.unsafe");
    return t("explain.emptySql");
  }

  async function tryExplain(sqlOverride?: string) {
    const tab = deps.activeTab.value;
    const sql = sqlOverride ?? deps.executableSql.value;
    if (!tab || !sql.trim()) {
      toast(t("explain.emptySql"));
      return;
    }

    deps.activeOutputView.value = "explain";
    const result = await queryStore.explainTabSql(tab.id, sql, deps.activeConnection.value?.db_type);
    if (!result.ok) {
      toast(explainReasonMessage(result.reason), 5000);
      return;
    }

    const current = deps.activeTab.value;
    if (current?.explainError) toast(current.explainError, 5000);
  }

  function onDangerConfirm() {
    const sql = pendingDangerSql.value || deps.executableSql.value;
    pendingDangerSql.value = "";
    doExecute(sql);
  }

  return {
    dangerSql,
    pendingDangerSql,
    showDangerDialog,
    tryExecute,
    doExecute,
    cancelActiveExecution,
    tryExplain,
    onDangerConfirm,
  };
}
