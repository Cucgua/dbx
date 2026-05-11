<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  FolderClosed,
  FolderOpen,
  Trash2,
} from "lucide-vue-next";
import { RecycleScroller } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import DangerConfirmDialog from "@/components/editor/DangerConfirmDialog.vue";
import RedisValueViewer from "./RedisValueViewer.vue";
import * as api from "@/lib/api";
import type { RedisKeyInfo } from "@/lib/api";
import {
  buildRedisKeyTree,
  collectExpandedGroupIds,
  flattenVisibleRedisKeyTree,
  type RedisKeyTreeNode,
} from "@/lib/redisKeyTree";

const { t } = useI18n();

const props = defineProps<{
  connectionId: string;
  db: number;
}>();

const flatKeys = ref<RedisKeyInfo[]>([]);
const treeKeys = ref<RedisKeyTreeNode[]>([]);
const loading = ref(false);
const searchPattern = ref("*");
const selectedKeyRaw = ref<string | null>(null);
const hasMore = ref(false);
const expandedGroupIds = ref<Set<string>>(new Set());
const checkedKeys = ref<Set<string>>(new Set());
const showBatchDeleteConfirm = ref(false);

const PAGE_SIZE = 200;
const keyGridStyle = {
  gridTemplateColumns: "minmax(12rem, 0.35fr) 80px 1fr 60px 60px",
};

const effectivePattern = computed(() => searchPattern.value.trim() || "*");
const isSearchMode = computed(() => effectivePattern.value !== "*");
const selectedKey = computed(() => flatKeys.value.find((key) => key.key_raw === selectedKeyRaw.value) ?? null);
const visibleRows = computed(() =>
  flattenVisibleRedisKeyTree(treeKeys.value, expandedGroupIds.value).map((row) => ({
    ...row,
    id: row.node.id,
  })),
);

function countLeaves(node: RedisKeyTreeNode): number {
  if (node.kind === "leaf") return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

function rebuildTree(expandAll = false) {
  const nextTree = buildRedisKeyTree(flatKeys.value, props.db);
  treeKeys.value = nextTree;

  const nextExpanded = new Set<string>();
  const availableExpanded = collectExpandedGroupIds(nextTree);
  if (expandAll) {
    for (const id of availableExpanded) nextExpanded.add(id);
  } else {
    for (const id of expandedGroupIds.value) {
      if (availableExpanded.has(id)) nextExpanded.add(id);
    }
  }
  expandedGroupIds.value = nextExpanded;

  if (selectedKeyRaw.value && !flatKeys.value.some((key) => key.key_raw === selectedKeyRaw.value)) {
    selectedKeyRaw.value = null;
  }
}

async function loadKeys() {
  loading.value = true;
  flatKeys.value = [];
  selectedKeyRaw.value = null;
  checkedKeys.value = new Set();
  try {
    let cur = 0;
    do {
      const result = await api.redisScanKeys(props.connectionId, props.db, cur, effectivePattern.value, PAGE_SIZE);
      const existingKeys = new Set(flatKeys.value.map((key) => key.key_raw));
      flatKeys.value = [...flatKeys.value, ...result.keys.filter((key) => !existingKeys.has(key.key_raw))];
      cur = result.cursor;
      hasMore.value = cur !== 0;
      rebuildTree(isSearchMode.value);
    } while (cur !== 0);
  } finally {
    loading.value = false;
  }
}

function toggleGroup(groupId: string) {
  const next = new Set(expandedGroupIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  expandedGroupIds.value = next;
}

function onRowClick(node: RedisKeyTreeNode) {
  if (node.kind === "group") {
    toggleGroup(node.id);
    return;
  }

  selectedKeyRaw.value = node.keyRaw;
}

function onKeyDeleted() {
  if (!selectedKeyRaw.value) return;
  flatKeys.value = flatKeys.value.filter((key) => key.key_raw !== selectedKeyRaw.value);
  selectedKeyRaw.value = null;
  rebuildTree(false);
}

function toggleCheck(keyRaw: string, event: Event) {
  event.stopPropagation();
  const next = new Set(checkedKeys.value);
  if (next.has(keyRaw)) next.delete(keyRaw);
  else next.add(keyRaw);
  checkedKeys.value = next;
}

function requestBatchDelete() {
  if (checkedKeys.value.size === 0) return;
  showBatchDeleteConfirm.value = true;
}

async function applyBatchDelete() {
  const keys = [...checkedKeys.value];
  await api.redisDeleteKeys(props.connectionId, props.db, keys);
  flatKeys.value = flatKeys.value.filter((k) => !checkedKeys.value.has(k.key_raw));
  if (selectedKeyRaw.value && checkedKeys.value.has(selectedKeyRaw.value)) {
    selectedKeyRaw.value = null;
  }
  checkedKeys.value = new Set();
  rebuildTree(false);
}

function typeColor(type: string): string {
  switch (type) {
    case "string":
      return "text-green-500";
    case "list":
      return "text-blue-500";
    case "set":
      return "text-purple-500";
    case "zset":
      return "text-amber-500";
    case "hash":
      return "text-orange-500";
    case "stream":
      return "text-teal-500";
    default:
      return "text-muted-foreground";
  }
}

function formatSize(size: number, type: string): string {
  if (type === "string") {
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  }
  return String(size);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(loadKeys, 400);
}

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

onMounted(loadKeys);
</script>

<template>
  <Splitpanes class="h-full" horizontal>
    <!-- Key table (top) -->
    <Pane :size="selectedKey ? 50 : 100" :min-size="25">
      <div class="h-full flex flex-col overflow-hidden">
        <!-- Toolbar -->
        <div class="h-9 flex items-center gap-1 px-2 border-b shrink-0">
          <Search class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            v-model="searchPattern"
            class="h-6 text-xs border-0 shadow-none focus-visible:ring-0"
            :placeholder="t('redis.pattern')"
            @input="onSearchInput"
            @keydown.enter="loadKeys"
          />
          <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" @click="loadKeys">
            <Loader2 v-if="loading" class="h-3 w-3 animate-spin" />
            <RefreshCw v-else class="h-3 w-3" />
          </Button>
          <span class="text-xs text-muted-foreground shrink-0 ml-1">{{
            loading && flatKeys.length === 0 ? t("redis.loadingKeys") : t("redis.keys", { count: flatKeys.length })
          }}</span>
          <Button
            v-if="checkedKeys.size > 0"
            variant="ghost"
            size="sm"
            class="h-6 text-xs text-destructive shrink-0 ml-1"
            @click="requestBatchDelete"
          >
            <Trash2 class="w-3 h-3 mr-1" />{{ checkedKeys.size }}
          </Button>
        </div>

        <!-- Table header -->
        <div class="grid border-b bg-muted/50 shrink-0 text-xs font-medium text-muted-foreground" :style="keyGridStyle">
          <div class="px-3 py-1 border-r">{{ t('redis.columnKey') }}</div>
          <div class="px-2 py-1 border-r">{{ t('redis.columnType') }}</div>
          <div class="px-3 py-1 border-r">{{ t('redis.columnValue') }}</div>
          <div class="px-2 py-1 border-r text-right">{{ t('redis.columnSize') }}</div>
          <div class="px-2 py-1 text-right">{{ t('redis.columnTTL') }}</div>
        </div>

        <!-- Table body -->
        <div
          v-if="flatKeys.length === 0 && !loading"
          class="flex-1 flex items-center justify-center text-muted-foreground text-xs"
        >
          {{ t("redis.noKeys") }}
        </div>
        <div
          v-else-if="loading && flatKeys.length === 0"
          class="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-xs"
        >
          <Loader2 class="w-3.5 h-3.5 animate-spin" />
          <span>{{ t("redis.loadingKeys") }}</span>
        </div>
        <RecycleScroller v-else class="flex-1" :items="visibleRows" :item-size="28" key-field="id">
          <template #default="{ item: row }">
            <div
              class="grid border-b text-xs cursor-pointer hover:bg-accent/50 group"
              :class="{ 'bg-accent': row.node.kind === 'leaf' && selectedKeyRaw === row.node.keyRaw }"
              :style="{ ...keyGridStyle, height: '28px' }"
              @click="onRowClick(row.node)"
            >
              <!-- Key column -->
              <div
                class="px-3 flex items-center gap-1 border-r overflow-hidden"
                :style="{ paddingLeft: `${12 + row.depth * 16}px` }"
              >
                <template v-if="row.node.kind === 'group'">
                  <component
                    :is="expandedGroupIds.has(row.node.id) ? ChevronDown : ChevronRight"
                    class="w-3 h-3 shrink-0 text-muted-foreground"
                  />
                  <component
                    :is="expandedGroupIds.has(row.node.id) ? FolderOpen : FolderClosed"
                    class="w-3 h-3 shrink-0 text-amber-500"
                  />
                  <span class="truncate font-mono">{{ row.node.label }}</span>
                  <span class="text-muted-foreground ml-1">({{ countLeaves(row.node) }})</span>
                </template>
                <template v-else>
                  <input
                    type="checkbox"
                    class="w-3 h-3 shrink-0 accent-primary cursor-pointer opacity-0 group-hover:opacity-100"
                    :class="{ 'opacity-100': checkedKeys.has(row.node.keyRaw) }"
                    :checked="checkedKeys.has(row.node.keyRaw)"
                    @click="toggleCheck(row.node.keyRaw, $event)"
                  />
                  <span class="truncate font-mono">{{ row.node.label }}</span>
                </template>
              </div>

              <!-- Type column -->
              <div class="border-r flex items-center justify-center">
                <Badge
                  v-if="row.node.kind === 'leaf'"
                  variant="outline"
                  class="text-xs px-1.5 py-0"
                  :class="typeColor(row.node.keyType)"
                  >{{ row.node.keyType }}</Badge
                >
              </div>

              <!-- Value preview column -->
              <div class="px-3 flex items-center border-r truncate font-mono text-muted-foreground">
                <span v-if="row.node.kind === 'leaf'" class="truncate">{{ row.node.valuePreview }}</span>
              </div>

              <!-- Size column -->
              <div class="px-2 flex items-center justify-end border-r text-muted-foreground">
                <template v-if="row.node.kind === 'leaf'">{{ formatSize(row.node.size, row.node.keyType) }}</template>
              </div>

              <!-- TTL column -->
              <div class="px-2 flex items-center justify-end text-muted-foreground">
                <template v-if="row.node.kind === 'leaf'">{{
                  row.node.ttl === -1 ? "∞" : `${row.node.ttl}s`
                }}</template>
              </div>
            </div>
          </template>
        </RecycleScroller>
      </div>
    </Pane>

    <!-- Value viewer (bottom) -->
    <Pane v-if="selectedKey" :size="50" :min-size="20">
      <div class="h-full min-w-0">
        <RedisValueViewer
          :key="selectedKey.key_raw"
          :connection-id="connectionId"
          :db="db"
          :key-display="selectedKey.key_display"
          :key-raw="selectedKey.key_raw"
          @deleted="onKeyDeleted"
        />
      </div>
    </Pane>
  </Splitpanes>

  <DangerConfirmDialog
    v-model:open="showBatchDeleteConfirm"
    :message="t('dangerDialog.deleteMessage')"
    :details="`${checkedKeys.size} keys`"
    :confirm-label="t('dangerDialog.deleteConfirm')"
    @confirm="applyBatchDelete"
  />
</template>
