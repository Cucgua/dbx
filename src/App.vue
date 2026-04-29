<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { DatabaseZap, FilePlus2, Play, Loader2, X, Globe, Moon, Sun, Upload, Download, Plus, History, Server, Table2 } from "lucide-vue-next";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useSettingsStore } from "@/stores/settingsStore";
import { useToast } from "@/composables/useToast";
import { setLocale, currentLocale, type Locale } from "@/i18n";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import * as api from "@/lib/tauri";

const { t } = useI18n();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const historyStore = useHistoryStore();
const settingsStore = useSettingsStore();
const { message: toastMessage, visible: toastVisible } = useToast();

const showConnectionDialog = ref(false);
const showHistory = ref(false);
const dangerSql = ref("");
const showDangerDialog = ref(false);
const databaseOptions = ref<Record<string, string[]>>({});
const loadingDatabaseOptions = ref<Record<string, boolean>>({});

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

const activeConnection = computed(() => {
  const tab = activeTab.value;
  return tab ? connectionStore.getConfig(tab.connectionId) : undefined;
});

const activeTabContext = computed(() => {
  const tab = activeTab.value;
  const connection = activeConnection.value;
  if (!tab || !connection) return [];

  const items = [
    connection.name,
    connection.db_type.toUpperCase(),
  ];

  if (tab.tableMeta?.tableName) {
    items.push(tab.tableMeta.schema
      ? `${tab.tableMeta.schema}.${tab.tableMeta.tableName}`
      : tab.tableMeta.tableName);
  }

  return items;
});

const activeDatabaseOptions = computed(() => {
  const connection = activeConnection.value;
  return connection ? databaseOptions.value[connection.id] ?? [] : [];
});

const activeDatabaseValue = computed(() => activeTab.value?.database || "");
const activeConnectionValue = computed(() => activeConnection.value?.id || "");

function connectionDisplayName(connectionId: string): string {
  return connectionStore.getConfig(connectionId)?.name || connectionId;
}

function databaseDisplayName(database: string): string {
  const connection = activeConnection.value;
  if (connection?.db_type === "redis" && database !== "") return `db${database}`;
  return database || t("editor.noDatabase");
}

async function loadDatabaseOptions(connectionId: string) {
  const connection = connectionStore.getConfig(connectionId);
  if (!connection || loadingDatabaseOptions.value[connectionId]) return;

  loadingDatabaseOptions.value[connectionId] = true;
  try {
    await connectionStore.ensureConnected(connectionId);
    if (connection.db_type === "redis") {
      const dbs = await api.redisListDatabases(connectionId);
      databaseOptions.value[connectionId] = dbs.map(String);
    } else if (connection.db_type === "mongodb") {
      databaseOptions.value[connectionId] = await api.mongoListDatabases(connectionId);
    } else {
      const dbs = await api.listDatabases(connectionId);
      databaseOptions.value[connectionId] = dbs.map((db) => db.name);
    }
  } finally {
    loadingDatabaseOptions.value[connectionId] = false;
  }
}

async function getDatabaseOptions(connectionId: string): Promise<string[]> {
  if (!databaseOptions.value[connectionId]) {
    await loadDatabaseOptions(connectionId);
  }
  return databaseOptions.value[connectionId] ?? [];
}

watch(activeConnection, (connection) => {
  if (connection && !databaseOptions.value[connection.id]) {
    loadDatabaseOptions(connection.id).catch(() => {});
  }
}, { immediate: true });

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

function replaceActiveSql(sql: string) {
  const tab = activeTab.value;
  if (!tab) return;
  queryStore.updateSql(tab.id, sql);
}

function appendActiveSql(sql: string) {
  const tab = activeTab.value;
  if (!tab) return;
  const current = tab.sql.trimEnd();
  queryStore.updateSql(tab.id, current ? `${current}\n\n${sql}` : sql);
}

function changeActiveDatabase(database: any) {
  const tab = activeTab.value;
  if (!tab || typeof database !== "string") return;
  queryStore.updateDatabase(tab.id, database);
}

async function changeActiveConnection(connectionId: any) {
  const tab = activeTab.value;
  if (!tab || typeof connectionId !== "string") return;
  const connection = connectionStore.getConfig(connectionId);
  if (!connection) return;
  const options = await getDatabaseOptions(connectionId);
  const database = connection.database || options[0] || "";
  queryStore.updateConnection(tab.id, connectionId, database);
  connectionStore.activeConnectionId = connectionId;
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
  getCurrentWindow().setTheme(isDark.value ? "dark" as Theme : "light" as Theme);
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
  settingsStore.initAiConfig();
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
            <div class="h-8 shrink-0 border-b bg-background/80 px-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Server class="h-3.5 w-3.5 shrink-0" />
              <Select
                :model-value="activeConnectionValue"
                @update:model-value="changeActiveConnection"
              >
                <SelectTrigger class="h-6 w-auto max-w-48 border-0 bg-transparent px-1 text-xs font-medium text-foreground shadow-none focus:ring-0">
                  <SelectValue :placeholder="t('editor.selectConnection')">
                    {{ connectionDisplayName(activeConnectionValue) }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="connection in connectionStore.connections"
                    :key="connection.id"
                    :value="connection.id"
                  >
                    {{ connection.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <span class="text-muted-foreground/50">/</span>
              <span class="shrink-0">{{ activeConnection?.db_type.toUpperCase() }}</span>
              <span class="text-muted-foreground/50">/</span>
              <Select
                :model-value="activeDatabaseValue"
                @update:model-value="changeActiveDatabase"
                @update:open="(open: boolean) => { if (open && activeConnection) loadDatabaseOptions(activeConnection.id).catch(() => {}) }"
              >
                <SelectTrigger class="h-6 w-auto max-w-56 border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
                  <SelectValue :placeholder="loadingDatabaseOptions[activeConnection?.id || ''] ? t('common.loading') : t('editor.selectDatabase')">
                    {{ databaseDisplayName(activeDatabaseValue) }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="database in activeDatabaseOptions"
                    :key="database"
                    :value="database"
                  >
                    {{ databaseDisplayName(database) }}
                  </SelectItem>
                  <SelectItem v-if="!activeDatabaseOptions.length && activeDatabaseValue" :value="activeDatabaseValue">
                    {{ databaseDisplayName(activeDatabaseValue) }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <template v-for="item in activeTabContext.slice(2)" :key="item">
                <span class="text-muted-foreground/50">/</span>
                <span class="min-w-0 truncate">{{ item }}</span>
              </template>
              <span class="flex-1" />
              <div v-if="activeTab.tableMeta" class="flex min-w-0 items-center gap-1">
                <Table2 class="h-3.5 w-3.5 shrink-0" />
                <span class="truncate">{{ activeTab.tableMeta.columns.length }} {{ t('tree.columns') }}</span>
              </div>
            </div>
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
                  </div>
                </Pane>
                <Pane :size="60" :min-size="20">
                  <div class="h-full flex flex-col">
                    <AiAssistant
                      :tab="activeTab"
                      :connection="activeConnection"
                      @replace-sql="replaceActiveSql"
                      @append-sql="appendActiveSql"
                    />
                    <DataGrid v-if="activeTab.result" :key="activeTab.id" class="flex-1 min-h-0" :result="activeTab.result" :sql="activeTab.sql" />
                    <div v-else class="flex-1 min-h-0 flex items-center justify-center text-muted-foreground text-sm">
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

      <!-- Global Toast -->
      <Transition name="toast">
        <div v-if="toastVisible" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-foreground text-background text-sm shadow-lg">
          {{ toastMessage }}
        </div>
      </Transition>
    </div>
  </TooltipProvider>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
