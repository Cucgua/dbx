<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Clock, Copy, Database, RotateCcw, Search, Trash2, X } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useHistoryStore } from "@/stores/historyStore";
import { useToast } from "@/composables/useToast";
import { shouldClearHistory, shouldDeleteHistoryEntry } from "@/lib/historyActions";
import type { HistoryEntry } from "@/lib/api";
import * as api from "@/lib/api";

const { t } = useI18n();
const { toast } = useToast();
const store = useHistoryStore();

const emit = defineEmits<{
  restore: [sql: string, entry: HistoryEntry];
  close: [];
}>();

type HistoryFilter = "all" | "query" | "data_change" | "schema_change" | "failed";

const searchText = ref("");
const activeFilter = ref<HistoryFilter>("all");
const selectedEntry = ref<HistoryEntry | null>(null);
const isRollingBack = ref(false);

const filters: HistoryFilter[] = ["all", "query", "data_change", "schema_change", "failed"];

const filtered = computed(() => {
  const q = searchText.value.toLowerCase();
  return store.entries.filter((entry) => {
    if (activeFilter.value === "failed" && entry.success) return false;
    if (activeFilter.value !== "all" && activeFilter.value !== "failed" && activityKind(entry) !== activeFilter.value) {
      return false;
    }
    if (!q) return true;
    return [entry.sql, entry.connection_name, entry.database, entry.operation, entry.target]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
});

function activityKind(entry: HistoryEntry) {
  return entry.activity_kind || "query";
}

function restore(entry: HistoryEntry) {
  emit("restore", entry.sql, entry);
  selectedEntry.value = null;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  toast(t("grid.copied"));
}

function confirmDeleteEntry(id: string) {
  if (shouldDeleteHistoryEntry(() => window.confirm(t("history.confirmDelete")))) {
    store.remove(id);
  }
}

function confirmClearHistory() {
  if (shouldClearHistory(store.entries.length, () => window.confirm(t("history.confirmClear")))) {
    store.clear();
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function truncateSql(sql: string): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 120 ? line.slice(0, 120) + "..." : line;
}

function entryTitle(entry: HistoryEntry) {
  return entry.target || entry.operation || truncateSql(entry.sql);
}

function entrySubtitle(entry: HistoryEntry) {
  if (activityKind(entry) === "query") return truncateSql(entry.sql);
  return truncateSql(entry.sql || entry.target || entry.operation || "");
}

function filterLabel(filter: HistoryFilter) {
  return t(`history.filters.${filter}`);
}

function kindLabel(entry: HistoryEntry) {
  return t(`history.kinds.${activityKind(entry)}`);
}

function kindShortLabel(entry: HistoryEntry) {
  return t(`history.kindShort.${activityKind(entry)}`);
}

function detailsRows(entry: HistoryEntry) {
  const rows = [
    [t("history.detail.kind"), kindLabel(entry)],
    [t("history.detail.operation"), entry.operation || "-"],
    [t("history.detail.connection"), entry.connection_name || "-"],
    [t("history.detail.database"), entry.database || "-"],
    [t("history.detail.target"), entry.target || "-"],
    [t("history.detail.time"), formatFullTime(entry.executed_at)],
    [t("history.detail.duration"), `${entry.execution_time_ms}ms`],
    [t("history.detail.affectedRows"), entry.affected_rows ?? "-"],
    [t("history.detail.status"), entry.success ? t("history.success") : t("history.failed")],
  ];
  if (entry.error) rows.push([t("history.detail.error"), entry.error]);
  return rows;
}

async function rollback(entry: HistoryEntry) {
  if (!entry.connection_id || !entry.database || !entry.rollback_sql || isRollingBack.value) return;
  if (!window.confirm(t("history.rollbackConfirm"))) return;

  isRollingBack.value = true;
  const start = Date.now();
  try {
    const result = await api.executeScript(entry.connection_id, entry.database, entry.rollback_sql);
    await store.add({
      connection_id: entry.connection_id,
      connection_name: entry.connection_name,
      database: entry.database,
      sql: entry.rollback_sql,
      execution_time_ms: Date.now() - start,
      success: true,
      activity_kind: "data_change",
      operation: "ROLLBACK",
      target: entry.target,
      affected_rows: result.affected_rows,
      details_json: JSON.stringify({ rollback_of: entry.id }),
    });
    toast(t("history.rollbackSuccess"));
    selectedEntry.value = null;
  } catch (e: any) {
    toast(t("history.rollbackFailed", { message: e?.message || String(e) }), 5000);
  } finally {
    isRollingBack.value = false;
  }
}

onMounted(() => store.load());
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden border-l">
    <div class="h-9 flex items-center gap-1 px-2 border-b shrink-0 bg-muted/20">
      <Clock class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span class="text-xs font-medium">{{ t("history.title") }}</span>
      <span class="flex-1" />
      <Button v-if="store.entries.length > 0" variant="ghost" size="icon" class="h-5 w-5" @click="confirmClearHistory">
        <Trash2 class="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" class="h-5 w-5" @click="emit('close')">
        <X class="h-3 w-3" />
      </Button>
    </div>

    <div class="border-b shrink-0">
      <div class="flex items-center gap-1 px-2 py-1">
        <Search class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          v-model="searchText"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="flex-1 h-5 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
          :placeholder="t('history.search')"
        />
      </div>
      <div class="flex gap-1 overflow-x-auto px-2 pb-2">
        <button
          v-for="filter in filters"
          :key="filter"
          type="button"
          class="h-6 shrink-0 rounded border px-2 text-xs"
          :class="activeFilter === filter ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'"
          @click="activeFilter = filter"
        >
          {{ filterLabel(filter) }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <ContextMenu v-for="entry in filtered" :key="entry.id">
        <ContextMenuTrigger as-child>
          <div
            class="px-3 py-2 border-b border-border/50 cursor-pointer hover:bg-accent/50 text-xs"
            @click="selectedEntry = entry"
          >
            <div class="flex items-center gap-1 mb-0.5">
              <span
                class="inline-flex h-5 w-9 shrink-0 items-center justify-center rounded border px-1 text-[10px] leading-none text-muted-foreground"
              >
                {{ kindShortLabel(entry) }}
              </span>
              <span class="font-medium truncate">{{ entryTitle(entry) }}</span>
              <span class="ml-auto text-muted-foreground shrink-0">{{ formatTime(entry.executed_at) }}</span>
            </div>
            <div class="font-mono text-muted-foreground truncate">{{ entrySubtitle(entry) }}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="inline-flex items-center gap-1 text-muted-foreground">
                <Database class="h-3 w-3" />
                {{ entry.connection_name }}<template v-if="entry.database"> / {{ entry.database }}</template>
              </span>
              <span :class="entry.success ? 'text-green-500' : 'text-red-500'">
                {{ entry.success ? `${entry.execution_time_ms}ms` : t("history.failed") }}
              </span>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-44">
          <ContextMenuItem @click="selectedEntry = entry">{{ t("history.viewDetails") }}</ContextMenuItem>
          <ContextMenuItem @click="restore(entry)">{{ t("history.restore") }}</ContextMenuItem>
          <ContextMenuItem @click="copyText(entry.sql)">{{ t("history.copy") }}</ContextMenuItem>
          <ContextMenuItem v-if="entry.rollback_sql" @click="rollback(entry)">{{
            t("history.rollback")
          }}</ContextMenuItem>
          <ContextMenuItem class="text-destructive" @click="confirmDeleteEntry(entry.id)">{{
            t("history.delete")
          }}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div v-if="filtered.length === 0" class="px-3 py-8 text-center text-muted-foreground text-xs">
        {{ t("history.empty") }}
      </div>
    </div>

    <Dialog :open="!!selectedEntry" @update:open="(value) => !value && (selectedEntry = null)">
      <DialogContent class="sm:max-w-2xl duration-75" @interact-outside="selectedEntry = null">
        <DialogHeader>
          <DialogTitle>{{ selectedEntry ? entryTitle(selectedEntry) : t("history.viewDetails") }}</DialogTitle>
        </DialogHeader>
        <div v-if="selectedEntry" class="space-y-4">
          <div class="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
            <template v-for="[label, value] in detailsRows(selectedEntry)" :key="label">
              <div class="text-muted-foreground">{{ label }}</div>
              <div class="min-w-0 break-words">{{ value }}</div>
            </template>
          </div>
          <div>
            <div class="mb-1 flex items-center justify-between">
              <div class="text-sm font-medium">SQL</div>
              <Button variant="ghost" size="sm" class="h-7" @click="copyText(selectedEntry.sql)">
                <Copy class="h-3.5 w-3.5" />
                {{ t("history.copy") }}
              </Button>
            </div>
            <pre
              class="max-h-48 overflow-auto rounded border bg-muted/30 p-3 text-xs"
            ><code>{{ selectedEntry.sql }}</code></pre>
          </div>
          <div v-if="selectedEntry.rollback_sql">
            <div class="mb-1 flex items-center justify-between">
              <div class="text-sm font-medium">{{ t("history.rollbackSql") }}</div>
              <Button variant="ghost" size="sm" class="h-7" @click="copyText(selectedEntry.rollback_sql || '')">
                <Copy class="h-3.5 w-3.5" />
                {{ t("history.copy") }}
              </Button>
            </div>
            <pre
              class="max-h-40 overflow-auto rounded border bg-muted/30 p-3 text-xs"
            ><code>{{ selectedEntry.rollback_sql }}</code></pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="selectedEntry && restore(selectedEntry)">{{ t("history.restore") }}</Button>
          <Button
            v-if="selectedEntry?.rollback_sql"
            :disabled="isRollingBack || !selectedEntry.connection_id"
            @click="rollback(selectedEntry)"
          >
            <RotateCcw class="h-4 w-4" />
            {{ isRollingBack ? t("common.loading") : t("history.rollback") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
