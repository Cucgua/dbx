<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RecycleScroller } from "vue-virtual-scroller";
import { Loader2, RefreshCw, Search, Table2, Eye } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as api from "@/lib/api";
import type { ConnectionConfig, TableInfo } from "@/types/database";
import { isSchemaAware } from "@/lib/databaseCapabilities";

type ObjectRow = {
  id: string;
  name: string;
  schema?: string;
  type: "TABLE" | "VIEW";
  comment?: string | null;
};

type ObjectFilter = "all" | "tables" | "views";

const props = defineProps<{
  connection: ConnectionConfig;
  database: string;
  schema?: string;
}>();

const emit = defineEmits<{
  openTable: [target: { tableName: string; schema?: string }];
  schemaChange: [schema: string | undefined];
}>();

const { t } = useI18n();

const schemas = ref<string[]>([]);
const selectedSchema = ref<string | undefined>(props.schema);
const rows = ref<ObjectRow[]>([]);
const search = ref("");
const objectFilter = ref<ObjectFilter>("all");
const loadingSchemas = ref(false);
const loadingObjects = ref(false);
const error = ref("");
let loadId = 0;

const needsSchema = computed(() => isSchemaAware(props.connection.db_type));
const tableCount = computed(() => rows.value.filter((row) => row.type === "TABLE").length);
const viewCount = computed(() => rows.value.filter((row) => row.type === "VIEW").length);
const showObjectFilter = computed(() => tableCount.value > 0 && viewCount.value > 0);
const hasComments = computed(() => rows.value.some((row) => row.comment?.trim()));
const gridTemplateColumns = computed(() =>
  hasComments.value ? "minmax(0,1fr) 120px 160px minmax(160px,0.7fr)" : "minmax(0,1fr) 120px 160px",
);
const searchedRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((row) =>
    [row.name, row.schema, row.type, row.comment]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q)),
  );
});
const filteredRows = computed(() => {
  if (objectFilter.value === "tables") return searchedRows.value.filter((row) => row.type === "TABLE");
  if (objectFilter.value === "views") return searchedRows.value.filter((row) => row.type === "VIEW");
  return searchedRows.value;
});

function normalizeType(type: string): ObjectRow["type"] {
  const value = type.toUpperCase();
  if (value.includes("VIEW")) return "VIEW";
  return "TABLE";
}

function iconFor(row: ObjectRow) {
  return row.type === "VIEW" ? Eye : Table2;
}

function typeLabel(type: ObjectRow["type"]) {
  return type === "VIEW" ? t("objects.view") : t("objects.table");
}

async function loadSchemas() {
  if (!needsSchema.value) {
    schemas.value = [];
    selectedSchema.value = undefined;
    return;
  }
  loadingSchemas.value = true;
  try {
    const names = await api.listSchemas(props.connection.id, props.database);
    schemas.value = names;
    if (!selectedSchema.value || !names.includes(selectedSchema.value)) {
      selectedSchema.value = names.includes("public") ? "public" : names[0];
    }
  } finally {
    loadingSchemas.value = false;
  }
}

async function loadObjects() {
  const id = ++loadId;
  loadingObjects.value = true;
  error.value = "";
  rows.value = [];
  try {
    const schema = needsSchema.value ? selectedSchema.value || "" : props.database;
    const tables: TableInfo[] = await api.listTables(props.connection.id, props.database, schema);
    if (id !== loadId) return;
    rows.value = tables.map((table) => ({
      id: `${schema || props.database}:${table.name}:${table.table_type}`,
      name: table.name,
      schema: needsSchema.value ? schema : undefined,
      type: normalizeType(table.table_type),
      comment: table.comment,
    }));
  } catch (e: any) {
    if (id !== loadId) return;
    error.value = e?.message || String(e);
  } finally {
    if (id === loadId) loadingObjects.value = false;
  }
}

async function reload() {
  await loadSchemas();
  await loadObjects();
}

function onSchemaChange(value: any) {
  selectedSchema.value = typeof value === "string" && value ? value : undefined;
  emit("schemaChange", selectedSchema.value);
  void loadObjects();
}

function filterCount(filter: ObjectFilter) {
  if (filter === "tables") return tableCount.value;
  if (filter === "views") return viewCount.value;
  return rows.value.length;
}

function filterLabel(filter: ObjectFilter) {
  const key = filter === "tables" ? "objects.tables" : filter === "views" ? "objects.views" : "objects.all";
  return `${t(key)} ${filterCount(filter)}`;
}

watch(
  () => [props.connection.id, props.database, props.schema] as const,
  () => {
    selectedSchema.value = props.schema;
    void reload();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Table2 class="h-4 w-4 text-muted-foreground" />
        <div class="min-w-0 truncate text-sm font-medium">
          {{ props.database }}<template v-if="selectedSchema"> / {{ selectedSchema }}</template>
        </div>
        <div class="shrink-0 rounded border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
          {{ filteredRows.length }} / {{ rows.length }}
        </div>
      </div>
      <div class="flex min-w-[240px] flex-1 items-center gap-2">
        <Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input v-model="search" class="h-7 text-xs" :placeholder="t('objects.search')" />
        <div v-if="showObjectFilter" class="flex h-7 shrink-0 items-center rounded border bg-muted/20 p-0.5">
          <button
            v-for="filter in ['all', 'tables', 'views'] as ObjectFilter[]"
            :key="filter"
            type="button"
            class="h-6 rounded-sm px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            :class="{ 'bg-background text-foreground shadow-sm': objectFilter === filter }"
            @click="objectFilter = filter"
          >
            {{ filterLabel(filter) }}
          </button>
        </div>
      </div>
      <Select
        v-if="needsSchema"
        :model-value="selectedSchema"
        :disabled="loadingSchemas"
        @update:model-value="onSchemaChange"
      >
        <SelectTrigger class="h-7 w-36 text-xs">
          <SelectValue :placeholder="loadingSchemas ? t('objects.loadingSchemas') : t('objects.schema')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="schema in schemas" :key="schema" :value="schema">{{ schema }}</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" class="h-7 w-7" :disabled="loadingObjects" @click="reload">
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loadingObjects }" />
      </Button>
    </div>

    <div v-if="loadingObjects" class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      {{ t("objects.loading") }}
    </div>
    <div v-else-if="error" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">
      {{ error }}
    </div>
    <div
      v-else-if="filteredRows.length === 0"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      {{ t("objects.empty") }}
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div
        class="grid h-8 shrink-0 items-center gap-3 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
        :style="{ gridTemplateColumns }"
      >
        <div class="truncate">{{ t("objects.name") }}</div>
        <div class="truncate">{{ t("objects.type") }}</div>
        <div class="truncate">{{ t("objects.schemaColumn") }}</div>
        <div v-if="hasComments" class="truncate">{{ t("objects.comment") }}</div>
      </div>
      <RecycleScroller class="flex-1 min-h-0" :items="filteredRows" :item-size="36" key-field="id">
        <template #default="{ item }">
          <div
            class="grid h-9 cursor-pointer items-center gap-3 border-b px-3 text-xs hover:bg-accent/50"
            :style="{ gridTemplateColumns }"
            @click="emit('openTable', { tableName: item.name, schema: item.schema })"
          >
            <div class="flex min-w-0 items-center gap-2">
              <component
                :is="iconFor(item)"
                class="h-3.5 w-3.5 shrink-0"
                :class="item.type === 'VIEW' ? 'text-purple-500' : 'text-green-500'"
              />
              <span class="truncate font-medium">{{ item.name }}</span>
            </div>
            <div class="truncate text-muted-foreground">{{ typeLabel(item.type) }}</div>
            <div class="truncate text-muted-foreground">{{ item.schema || props.database }}</div>
            <div v-if="hasComments" class="truncate text-muted-foreground" :title="item.comment || ''">
              {{ item.comment || "" }}
            </div>
          </div>
        </template>
      </RecycleScroller>
    </div>
  </div>
</template>
