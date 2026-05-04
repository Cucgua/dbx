<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import AiAssistant from "@/components/editor/AiAssistant.vue";
import QueryHistory from "@/components/editor/QueryHistory.vue";
import AppToolbar from "@/components/layout/AppToolbar.vue";
import AppTabBar from "@/components/layout/AppTabBar.vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import EditorToolbar from "@/components/layout/EditorToolbar.vue";
import ContentArea from "@/components/layout/ContentArea.vue";
import AppDialogs from "@/components/layout/AppDialogs.vue";
import WelcomeScreen from "@/components/layout/WelcomeScreen.vue";
import UpdateDialog from "@/components/layout/UpdateDialog.vue";
import LoginPage from "@/components/auth/LoginPage.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToast } from "@/composables/useToast";
import { useTheme } from "@/composables/useTheme";
import { useAppUpdater } from "@/composables/useAppUpdater";
import { useFileDrop } from "@/composables/useFileDrop";
import { usePanelResize } from "@/composables/usePanelResize";
import { useDatabaseOptions } from "@/composables/useDatabaseOptions";
import { useSqlExecution } from "@/composables/useSqlExecution";
import { useDialogSources } from "@/composables/useDialogSources";
import { useNavigationTargets } from "@/composables/useNavigationTargets";
import { useDataGridActions } from "@/composables/useDataGridActions";
import { useTauriEvents } from "@/composables/useTauriEvents";
import { setLocale, currentLocale } from "@/i18n";
import * as api from "@/lib/api";
import { resolveExecutableSql } from "@/lib/sqlExecutionTarget";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { isCloseTabShortcut, isExecuteSqlShortcut } from "@/lib/keyboardShortcuts";
import { isPreviewTab } from "@/lib/tabPresentation";

const { t } = useI18n();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const settingsStore = useSettingsStore();
const { message: toastMessage, visible: toastVisible, toast } = useToast();
const { isDark, applyTheme, toggleTheme } = useTheme();
const {
  checkingUpdates, updateInfo, updateCheckMessage, showUpdateDialog,
  isDownloadingUpdate, downloadProgress, updateReady,
  openUrl, checkUpdates, openLatestRelease,
  downloadAndInstallUpdate, restartApp,
} = useAppUpdater();
const { setupFileDrop } = useFileDrop();

const isDesktop = isTauriRuntime();
const needsAuth = ref(!isDesktop);
const authenticated = ref(isDesktop);

const showConnectionDialog = ref(false);
const showSettingsDialog = ref(false);
const showHistory = ref(false);
const showAiPanel = ref(localStorage.getItem("dbx-ai-panel-open") !== "false");
const {
  sidebarWidth, aiPanelWidth, historyWidth,
  startSidebarResize, startAiPanelResize, startHistoryResize,
} = usePanelResize();
const aiAssistantRef = ref<InstanceType<typeof AiAssistant> | null>(null);

const selectedSql = ref("");
const cursorPos = ref(0);
const formatSqlRequestId = ref(0);
const activeOutputView = ref<"result" | "explain">("result");

const activeTab = computed(() =>
  queryStore.tabs.find((t) => t.id === queryStore.activeTabId)
);

const activeConnection = computed(() => {
  const tab = activeTab.value;
  return tab ? connectionStore.getConfig(tab.connectionId) : undefined;
});

const executableSql = computed(() => {
  const tab = activeTab.value;
  return tab ? resolveExecutableSql(tab.sql, selectedSql.value, {
    mode: settingsStore.editorSettings.executeMode,
    cursorPos: cursorPos.value,
  }) : "";
});

const {
  dangerSql, showDangerDialog,
  tryExecute, cancelActiveExecution, tryExplain, onDangerConfirm,
} = useSqlExecution({ activeTab, activeConnection, executableSql, activeOutputView });

const dialogs = useDialogSources();
const { getDatabaseOptions } = useDatabaseOptions();
const { openLineageTarget, openDatabaseSearchTarget, onStructureEditorSaved, openTableTarget } =
  useNavigationTargets(dialogs);
const { onExecuteSql, onReloadData, onPaginate, onSort } = useDataGridActions(activeTab);
const { setupTauriListeners } = useTauriEvents({ openTableTarget });

const appVersion = ref("");
const sqlFileUnsupportedTypes = new Set(["redis", "mongodb", "elasticsearch"]);
const hasSqlFileConnections = computed(() =>
  connectionStore.connections.some((c) => !sqlFileUnsupportedTypes.has(c.db_type))
);
const connectionStats = computed(() => ({
  total: connectionStore.connections.length,
  connected: connectionStore.connectedIds.size,
  types: new Set(connectionStore.connections.map((c) => c.driver_profile || c.db_type)).size,
}));
const recentConnections = computed(() => connectionStore.connections.slice(0, 5));

watch(() => queryStore.activeTabId, () => {
  selectedSql.value = "";
  activeOutputView.value = "result";
});

function toggleAiPanel() {
  showAiPanel.value = !showAiPanel.value;
  localStorage.setItem("dbx-ai-panel-open", String(showAiPanel.value));
}

function fixWithAi(errorMessage: string) {
  if (!showAiPanel.value) {
    showAiPanel.value = true;
    localStorage.setItem("dbx-ai-panel-open", "true");
  }
  nextTick(() => aiAssistantRef.value?.triggerAction("fix", errorMessage));
}

function formatActiveSql() {
  const tab = activeTab.value;
  if (!tab || tab.mode !== "query" || !tab.sql.trim()) return;
  formatSqlRequestId.value++;
}

function newQuery() {
  const connId = connectionStore.activeConnectionId || connectionStore.connections[0]?.id;
  if (!connId) return;
  const conn = connectionStore.getConfig(connId);
  if (!conn) return;
  connectionStore.activeConnectionId = connId;
  queryStore.createTab(conn.id, conn.database || "");
}

async function openConnectionQuery(connectionId: string) {
  const connection = connectionStore.getConfig(connectionId);
  if (!connection) return;
  const options = await getDatabaseOptions(connectionId);
  connectionStore.activeConnectionId = connectionId;
  queryStore.createTab(connectionId, connection.database || options[0] || "");
}

async function changeActiveConnection(connectionId: string) {
  const tab = activeTab.value;
  if (!tab) return;
  const connection = connectionStore.getConfig(connectionId);
  if (!connection) return;
  const options = await getDatabaseOptions(connectionId);
  queryStore.updateConnection(tab.id, connectionId, connection.database || options[0] || "");
  connectionStore.activeConnectionId = connectionId;
}

function changeActiveDatabase(database: string) {
  const tab = activeTab.value;
  if (tab) queryStore.updateDatabase(tab.id, database);
}

function toggleLocale() { setLocale(currentLocale() === "zh-CN" ? "en" : "zh-CN"); }
function openGitHub() { openUrl("https://github.com/t8y2/dbx"); }
function openMcpGuide() { openUrl("https://github.com/t8y2/dbx/blob/main/docs/mcp-guide.md"); }

function ensureQueryTab(): string {
  const tab = activeTab.value;
  if (tab && tab.mode === "query") return tab.id;
  const connId = connectionStore.activeConnectionId || connectionStore.connections[0]?.id || "";
  const db = tab?.database || "";
  return queryStore.createTab(connId, db, undefined, "query");
}

function onAiReplaceSql(sql: string) {
  const tabId = ensureQueryTab();
  queryStore.updateSql(tabId, sql);
}

function onAiExecuteSql(sql: string) {
  const tabId = ensureQueryTab();
  queryStore.updateSql(tabId, sql);
  nextTick(() => tryExecute());
}

function handleKeydown(e: KeyboardEvent) {
  if (isCloseTabShortcut(e)) {
    e.preventDefault();
    if (queryStore.activeTabId) queryStore.closeTab(queryStore.activeTabId);
    return;
  }
  if (activeTab.value?.mode === "query" && isExecuteSqlShortcut(e)
    && e.target instanceof Element && e.target.closest("[data-query-editor-root]")) {
    e.preventDefault();
    e.stopPropagation();
    tryExecute();
  }
}

function initApp() {
  connectionStore.initFromDisk().catch((e: any) => {
    toast(t("connection.loadFailed", { message: e?.message || String(e) }), 5000);
  });
  settingsStore.initAiConfig();
}

onMounted(async () => {
  applyTheme();
  window.addEventListener("keydown", handleKeydown, true);
  if (!isDesktop) {
    try {
      const res = await fetch("/api/auth/check");
      const data = await res.json();
      needsAuth.value = data.required;
      authenticated.value = data.authenticated;
    } catch { /* server unreachable */ }
    if (!needsAuth.value || authenticated.value) initApp();
    api.checkForUpdates().then((info) => { appVersion.value = info.current_version; }).catch(() => {});
    return;
  }
  initApp();
  setupFileDrop().catch(() => {});
  checkUpdates({ silent: true });
  import("@tauri-apps/api/app").then(({ getVersion }) => {
    getVersion().then((v) => { appVersion.value = v; }).catch(() => {});
  }).catch(() => {});
  setupTauriListeners();
});

onUnmounted(() => { window.removeEventListener("keydown", handleKeydown, true); });
</script>

<template>
  <LoginPage v-if="needsAuth && !authenticated" @authenticated="authenticated = true; initApp()" />
  <TooltipProvider v-show="!needsAuth || authenticated" :delay-duration="300">
    <div class="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <AppToolbar
        :is-dark="isDark" :show-ai-panel="showAiPanel" :show-history="showHistory"
        :checking-updates="checkingUpdates"
        :has-connections="connectionStore.connections.length > 0"
        :has-sql-file-connections="hasSqlFileConnections"
        @new-connection="showConnectionDialog = true" @new-query="newQuery"
        @toggle-theme="toggleTheme" @toggle-locale="toggleLocale"
        @toggle-ai="toggleAiPanel" @toggle-history="showHistory = !showHistory"
        @open-github="openGitHub" @open-settings="showSettingsDialog = true"
        @check-updates="checkUpdates()"
        @open-transfer="dialogs.showTransferDialog.value = true"
        @open-sql-file="dialogs.showSqlFileDialog.value = true"
      />

      <div class="flex-1 flex min-h-0">
        <AppSidebar
          :sidebar-width="sidebarWidth"
          @import="dialogs.onImportClick" @export="dialogs.onExportClick"
          @start-resize="startSidebarResize"
        />

        <div class="flex-1 min-w-0">
          <div class="h-full flex flex-col min-w-0">
            <AppTabBar />
            <div v-if="activeTab" class="flex flex-col flex-1 min-h-0">
              <EditorToolbar
                v-if="activeTab.mode === 'query' && !isPreviewTab(activeTab)"
                :active-tab="activeTab" :active-connection="activeConnection" :executable-sql="executableSql"
                @execute="tryExecute()" @cancel="cancelActiveExecution()" @explain="tryExplain()"
                @format-sql="formatActiveSql"
                @change-connection="changeActiveConnection" @change-database="changeActiveDatabase"
              />
              <ContentArea
                :active-tab="activeTab" :active-connection="activeConnection" :executable-sql="executableSql"
                :active-output-view="activeOutputView" :format-sql-request-id="formatSqlRequestId"
                :selected-sql="selectedSql" :cursor-pos="cursorPos"
                @update:active-output-view="activeOutputView = $event"
                @fix-with-ai="fixWithAi" @execute="tryExecute()" @cancel="cancelActiveExecution()"
                @explain="tryExplain()"
                @editor-update="(v: string) => { if (queryStore.activeTabId) queryStore.updateSql(queryStore.activeTabId, v) }"
                @editor-selection-change="(v: string) => selectedSql = v"
                @editor-cursor-change="(p: number) => cursorPos = p"
                @format-error="toast(t('toolbar.formatSqlFailed'))"
                @reload="onReloadData" @paginate="onPaginate" @sort="onSort" @execute-sql="onExecuteSql"
              />
            </div>
            <WelcomeScreen
              v-else
              :connection-stats="connectionStats" :recent-connections="recentConnections"
              :app-version="appVersion" :has-connections="connectionStore.connections.length > 0"
              @open-connection-query="openConnectionQuery" @new-connection="showConnectionDialog = true"
              @new-query="newQuery" @show-history="showHistory = true"
              @import-config="dialogs.onImportClick" @open-github="openGitHub" @open-mcp-guide="openMcpGuide"
            />
          </div>
        </div>

        <div v-if="showAiPanel" class="h-full shrink-0 relative bg-background" :style="{ width: aiPanelWidth + 'px' }">
          <div class="panel-resize-handle panel-resize-handle--left" @mousedown="startAiPanelResize" />
          <div class="h-full min-h-0 overflow-hidden">
            <AiAssistant ref="aiAssistantRef" :tab="activeTab" :connection="activeConnection"
              @replace-sql="onAiReplaceSql"
              @execute-sql="onAiExecuteSql" @close="toggleAiPanel"
            />
          </div>
        </div>

        <div v-if="showHistory" class="h-full shrink-0 relative bg-background" :style="{ width: historyWidth + 'px' }">
          <div class="panel-resize-handle panel-resize-handle--left" @mousedown="startHistoryResize" />
          <QueryHistory @restore="(sql: string) => { if (queryStore.activeTabId) queryStore.updateSql(queryStore.activeTabId, sql) }" @close="showHistory = false" />
        </div>
      </div>

      <AppDialogs
        :show-connection-dialog="showConnectionDialog" :show-settings-dialog="showSettingsDialog"
        :show-danger-dialog="showDangerDialog" :danger-sql="dangerSql"
        @update:show-connection-dialog="showConnectionDialog = $event"
        @update:show-settings-dialog="showSettingsDialog = $event"
        @update:show-danger-dialog="showDangerDialog = $event"
        @danger-confirm="onDangerConfirm"
        @connect-started="(name: string) => toast(t('connection.connecting', { name }), 30000)"
        @connect-succeeded="(name: string) => toast(t('connection.connectSuccess', { name }), 2000)"
        @connect-failed="(msg: string) => toast(t('connection.connectFailed', { message: msg }), 5000)"
        @structure-editor-saved="onStructureEditorSaved(onReloadData, toast)"
        @open-lineage-target="openLineageTarget"
        @open-database-search-target="openDatabaseSearchTarget"
      />
      <UpdateDialog
        v-model:open="showUpdateDialog" :update-info="updateInfo" :update-check-message="updateCheckMessage"
        :is-downloading-update="isDownloadingUpdate" :download-progress="downloadProgress" :update-ready="updateReady"
        @open-latest-release="openLatestRelease" @download-and-install="downloadAndInstallUpdate" @restart="restartApp"
      />

      <Transition name="toast">
        <div v-if="toastVisible" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-foreground text-background text-sm shadow-lg">
          {{ toastMessage }}
        </div>
      </Transition>
    </div>
  </TooltipProvider>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
