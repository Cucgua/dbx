<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { DatabaseZap, FilePlus2, Play, Loader2, X, Globe, Moon, Sun, Upload, Download, Plus, History } from "lucide-vue-next";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ConnectionTree from "@/components/sidebar/ConnectionTree.vue";
import ConnectionDialog from "@/components/connection/ConnectionDialog.vue";
import QueryEditor from "@/components/editor/QueryEditor.vue";
import DataGrid from "@/components/grid/DataGrid.vue";
import RedisKeyBrowser from "@/components/redis/RedisKeyBrowser.vue";
import AiAssistant from "@/components/editor/AiAssistant.vue";
import MongoDocBrowser from "@/components/mongo/MongoDocBrowser.vue";
import QueryHistory from "@/components/editor/QueryHistory.vue";
import DangerConfirmDialog from "@/components/editor/DangerConfirmDialog.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { setLocale, currentLocale, type Locale } from "@/i18n";
import * as api from "@/lib/tauri";

const { t } = useI18n();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const historyStore = useHistoryStore();

const showConnectionDialog = ref(false);
const showHistory = ref(false);
const dangerSql = ref("");
const showDangerDialog = ref(false);

const editConfig = computed(() => {
  const id = connectionStore.editingConnectionId;
  if (!id) return undefined;
  return connectionStore.getConfig(id);
});

watch(editConfig, (v) => {
  if (v) showConnectionDialog.value = true;
});

watch(showConnectionDialog, (v) => {
  if (!v) connectionStore.stopEditing();
});

const activeTab = computed(() =>
  queryStore.tabs.find((t) => t.id === queryStore.activeTabId)
);

function onEditorUpdate(val: string) {
  if (queryStore.activeTabId) {
    queryStore.updateSql(queryStore.activeTabId, val);
  }
}

function newQuery() {
  if (!connectionStore.activeConnectionId) return;
  const conn = connectionStore.connections.find(
    (c) => c.id === connectionStore.activeConnectionId
  );
  if (!conn) return;
  queryStore.createTab(conn.id, conn.database || "");
}

const DANGER_RE = /^\s*(DROP|DELETE|TRUNCATE|ALTER)\b/i;

function isDangerousSql(sql: string): boolean {
  return DANGER_RE.test(sql);
}

function tryExecute() {
  const tab = activeTab.value;
  if (!tab || !tab.sql.trim()) return;
  if (isDangerousSql(tab.sql)) {
    dangerSql.value = tab.sql;
    showDangerDialog.value = true;
  } else {
    doExecute();
  }
}

async function doExecute() {
  const tab = activeTab.value;
  if (!tab) return;
  const connName = connectionStore.getConfig(tab.connectionId)?.name || "";
  const sql = tab.sql;
  const start = Date.now();
  await queryStore.executeCurrentTab();
  const elapsed = Date.now() - start;
  const success = !tab.result?.columns.includes("Error");
  historyStore.add({
    connection_name: connName,
    database: tab.database,
    sql,
    execution_time_ms: elapsed,
    success,
    error: success ? undefined : String(tab.result?.rows?.[0]?.[0] ?? ""),
  });
}

function onDangerConfirm() {
  doExecute();
}

function onHistoryRestore(sql: string) {
  if (queryStore.activeTabId) {
    queryStore.updateSql(queryStore.activeTabId, sql);
  }
}

async function onExecuteSql(sql: string) {
  const tab = activeTab.value;
  if (!tab) return;
  await api.executeQuery(tab.connectionId, tab.database, sql);
}

async function onReloadData() {
  const tab = activeTab.value;
  if (!tab) return;
  if (tab.mode === "data" && tab.tableMeta) {
    queryStore.updateSql(tab.id, buildTableSql(tab));
  }
  queryStore.executeCurrentTab();
}

type ActiveTab = NonNullable<typeof activeTab.value>;

function quoteIdent(tab: ActiveTab, name: string): string {
  const config = connectionStore.getConfig(tab.connectionId);
  return config?.db_type === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

function qualifiedTableName(tab: NonNullable<typeof activeTab.value>): string {
  const config = connectionStore.getConfig(tab.connectionId);
  if (!tab.tableMeta) return "";
  if (config?.db_type === "postgres" && tab.tableMeta.schema) {
    return `${quoteIdent(tab, tab.tableMeta.schema)}.${quoteIdent(tab, tab.tableMeta.tableName)}`;
  }
  return quoteIdent(tab, tab.tableMeta.tableName);
}

function defaultOrderBy(tab: NonNullable<typeof activeTab.value>): string | undefined {
  const primaryKeys = tab.tableMeta?.primaryKeys ?? [];
  if (primaryKeys.length === 0) return undefined;
  return primaryKeys.map((pk) => `${quoteIdent(tab, pk)} ASC`).join(", ");
}

function buildTableSql(
  tab: NonNullable<typeof activeTab.value>,
  options: { orderBy?: string; limit?: number; offset?: number } = {},
): string {
  const limit = options.limit ?? 100;
  const orderBy = options.orderBy ?? defaultOrderBy(tab);
  const order = orderBy ? ` ORDER BY ${orderBy}` : "";
  const offset = options.offset ? ` OFFSET ${options.offset}` : "";
  return `SELECT * FROM ${qualifiedTableName(tab)}${order} LIMIT ${limit}${offset};`;
}

async function onPaginate(offset: number, limit: number) {
  const tab = activeTab.value;
  if (!tab?.tableMeta) return;
  const sql = buildTableSql(tab, { limit, offset });
  queryStore.updateSql(tab.id, sql);
  await queryStore.executeCurrentTab();
}

async function onSort(column: string, direction: "asc" | "desc" | null) {
  const tab = activeTab.value;
  if (!tab?.tableMeta) return;
  const orderBy = direction ? `${quoteIdent(tab, column)} ${direction.toUpperCase()}` : defaultOrderBy(tab);
  const sql = buildTableSql(tab, { orderBy });
  queryStore.updateSql(tab.id, sql);
  await queryStore.executeCurrentTab();
}

function toggleLocale() {
  const next: Locale = currentLocale() === "zh-CN" ? "en" : "zh-CN";
  setLocale(next);
}

const isDark = ref(localStorage.getItem("dbx-theme") === "dark");

function applyTheme() {
  document.documentElement.classList.toggle("dark", isDark.value);
}

function toggleTheme() {
  isDark.value = !isDark.value;
  localStorage.setItem("dbx-theme", isDark.value ? "dark" : "light");
  applyTheme();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === "w") {
    e.preventDefault();
    if (queryStore.activeTabId) {
      queryStore.closeTab(queryStore.activeTabId);
    }
  }
}

onMounted(() => {
  applyTheme();
  connectionStore.initFromDisk();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <!-- Toolbar -->
      <div class="h-10 flex items-center gap-1 px-2 border-b bg-muted/30 shrink-0">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="showConnectionDialog = true">
              <DatabaseZap class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('toolbar.newConnection') }}</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" class="h-5" />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="newQuery" :disabled="!connectionStore.activeConnectionId">
              <FilePlus2 class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('toolbar.newQuery') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :disabled="!activeTab || activeTab.isExecuting"
              @click="tryExecute()"
            >
              <Loader2 v-if="activeTab?.isExecuting" class="h-4 w-4 animate-spin" />
              <Play v-else class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('toolbar.executeShortcut') }}</TooltipContent>
        </Tooltip>

        <div class="flex-1" />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" :class="{ 'bg-accent': showHistory }" @click="showHistory = !showHistory">
              <History class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('history.title') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="toggleTheme">
              <Moon v-if="!isDark" class="h-4 w-4" />
              <Sun v-else class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ isDark ? 'Light' : 'Dark' }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="toggleLocale">
              <Globe class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('common.language') }}</TooltipContent>
        </Tooltip>

        <span class="text-xs text-muted-foreground mr-2">DBX</span>
      </div>

      <!-- Main Content -->
      <div class="flex-1 flex min-h-0">
      <Splitpanes class="flex-1 min-h-0">
        <!-- Sidebar -->
        <Pane :size="20" :min-size="10" :max-size="40">
          <div class="h-full flex flex-col overflow-hidden">
            <div class="h-8 flex items-center px-3 text-xs font-medium text-muted-foreground border-b bg-muted/20">
              {{ t('sidebar.connections') }}
              <span class="flex-1" />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon" class="h-5 w-5" @click="connectionStore.importConnectionsFromFile()">
                    <Upload class="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t('sidebar.import') }}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon" class="h-5 w-5" @click="connectionStore.exportConnectionsToFile()">
                    <Download class="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t('sidebar.export') }}</TooltipContent>
              </Tooltip>
            </div>
            <div class="flex-1 overflow-y-auto">
              <ConnectionTree />
            </div>
          </div>
        </Pane>

        <!-- Editor + Results -->
        <Pane :size="80">
          <div class="h-full flex flex-col min-w-0">
          <!-- Tabs Bar -->
          <div v-if="queryStore.tabs.length > 0" class="h-8 flex items-center border-b bg-muted/20 overflow-x-auto shrink-0">
            <div
              v-for="tab in queryStore.tabs"
              :key="tab.id"
              class="flex items-center gap-1 px-3 h-full text-xs cursor-pointer border-r hover:bg-accent transition-colors whitespace-nowrap"
              :class="{ 'bg-background font-medium': tab.id === queryStore.activeTabId }"
              @click="queryStore.activeTabId = tab.id"
            >
              <span>{{ tab.title }}</span>
              <button
                class="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                @click.stop="queryStore.closeTab(tab.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>

          <!-- Editor Panel -->
          <div v-if="activeTab" class="flex flex-col flex-1 min-h-0">
            <!-- Query mode: editor + results -->
            <template v-if="activeTab.mode === 'query'">
              <Splitpanes horizontal class="flex-1">
                <Pane :size="40" :min-size="15">
                  <div class="h-full flex flex-col">
                    <QueryEditor
                      class="flex-1"
                      :model-value="activeTab.sql"
                      @update:model-value="onEditorUpdate"
                      @execute="tryExecute()"
                    />
                    <AiAssistant
                      table-context=""
                      @insert-sql="(sql: string) => { queryStore.updateSql(activeTab!.id, sql); }"
                    />
                  </div>
                </Pane>
                <Pane :size="60" :min-size="20">
                  <div class="h-full">
                    <DataGrid v-if="activeTab.result" :key="activeTab.id" :result="activeTab.result" :sql="activeTab.sql" />
                    <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
                      {{ t('editor.pressToExecute') }}
                    </div>
                  </div>
                </Pane>
              </Splitpanes>
            </template>

            <!-- Data mode: full-height grid -->
            <template v-else-if="activeTab.mode === 'data'">
              <div class="flex-1 min-h-0">
                <DataGrid
                  v-if="activeTab.result"
                  :key="activeTab.id"
                  :result="activeTab.result"
                  :sql="activeTab.sql"
                  :editable="!!activeTab.tableMeta?.primaryKeys?.length"
                  :table-meta="activeTab.tableMeta"
                  :on-execute-sql="onExecuteSql"
                  @reload="onReloadData"
                  @paginate="onPaginate"
                  @sort="onSort"
                />
                <div v-else-if="activeTab.isExecuting" class="h-full flex items-center justify-center text-muted-foreground text-sm">
                  <Loader2 class="h-5 w-5 animate-spin mr-2" /> {{ t('common.loading') }}
                </div>
              </div>
            </template>

            <!-- Redis mode: key browser -->
            <template v-else-if="activeTab.mode === 'redis'">
              <div class="flex-1 min-h-0">
                <RedisKeyBrowser
                  :key="activeTab.id"
                  :connection-id="activeTab.connectionId"
                  :db="Number(activeTab.database)"
                />
              </div>
            </template>

            <!-- MongoDB mode: document browser -->
            <template v-else-if="activeTab.mode === 'mongo'">
              <div class="flex-1 min-h-0">
                <MongoDocBrowser
                  :key="activeTab.id"
                  :connection-id="activeTab.connectionId"
                  :database="activeTab.database"
                  :collection="activeTab.sql"
                />
              </div>
            </template>
          </div>

          <!-- Empty State -->
          <div v-else class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <h2 class="text-lg font-medium mb-2">{{ t('welcome.title') }}</h2>
              <p class="text-sm text-muted-foreground mb-4">
                {{ t('welcome.subtitle') }}
              </p>
              <Button @click="showConnectionDialog = true">
                <Plus class="h-4 w-4 mr-2" /> {{ t('toolbar.newConnection') }}
              </Button>
            </div>
          </div>
          </div>
        </Pane>
      </Splitpanes>

      <!-- History Panel (fixed width, outside Splitpanes) -->
      <div v-if="showHistory" class="w-72 h-full shrink-0 border-l bg-background">
        <QueryHistory @restore="onHistoryRestore" @close="showHistory = false" />
      </div>
      </div>

      <ConnectionDialog v-model:open="showConnectionDialog" :edit-config="editConfig" />
      <DangerConfirmDialog v-model:open="showDangerDialog" :sql="dangerSql" @confirm="onDangerConfirm" />
    </div>
  </TooltipProvider>
</template>
