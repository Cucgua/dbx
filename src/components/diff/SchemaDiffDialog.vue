<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnectionStore } from "@/stores/connectionStore";
import DatabaseIcon from "@/components/icons/DatabaseIcon.vue";
import * as api from "@/lib/api";
import { isSchemaAware } from "@/lib/databaseCapabilities";
import {
  diffColumns,
  diffForeignKeys,
  diffIndexes,
  diffTables,
  diffTriggers,
  generateSyncSql,
  type TableDiff,
} from "@/lib/schemaDiff";
import { useToast } from "@/composables/useToast";
import { Loader2, Copy, Play, GitCompareArrows } from "lucide-vue-next";

const { t } = useI18n();
const { toast } = useToast();
const open = defineModel<boolean>("open", { default: false });
const store = useConnectionStore();

const props = defineProps<{
  prefillConnectionId?: string;
  prefillDatabase?: string;
  prefillSchema?: string;
}>();

const sourceConnectionId = ref("");
const sourceDatabase = ref("");
const sourceDatabases = ref<string[]>([]);
const sourceSchema = ref("");
const sourceSchemas = ref<string[]>([]);

const targetConnectionId = ref("");
const targetDatabase = ref("");
const targetDatabases = ref<string[]>([]);
const targetSchema = ref("");
const targetSchemas = ref<string[]>([]);

const step = ref<"select" | "comparing" | "result">("select");
const diffs = ref<TableDiff[]>([]);
const syncSql = ref("");
const executing = ref(false);

const sqlConnections = computed(() =>
  store.connections.filter((c) => !["redis", "mongodb", "elasticsearch"].includes(c.db_type)),
);

const canCompare = computed(
  () =>
    sourceConnectionId.value &&
    sourceDatabase.value &&
    sourceSchema.value &&
    targetConnectionId.value &&
    targetDatabase.value &&
    targetSchema.value,
);

function connectionIconType(connectionId: string) {
  const config = store.getConfig(connectionId);
  return config?.driver_profile || config?.db_type || "mysql";
}

async function loadDatabases(connectionId: string, side: "source" | "target") {
  if (!connectionId) return;
  try {
    await store.ensureConnected(connectionId);
    const dbs = await api.listDatabases(connectionId);
    const names = dbs.map((d) => d.name);
    if (side === "source") {
      sourceDatabases.value = names;
      sourceDatabase.value = names.length === 1 ? names[0] : "";
      sourceSchemas.value = [];
      sourceSchema.value = "";
    } else {
      targetDatabases.value = names;
      targetDatabase.value = names.length === 1 ? names[0] : "";
      targetSchemas.value = [];
      targetSchema.value = "";
    }
  } catch {
    if (side === "source") sourceDatabases.value = [];
    else targetDatabases.value = [];
  }
}

async function loadSchemas(side: "source" | "target", preferredSchema = "") {
  const connectionId = side === "source" ? sourceConnectionId.value : targetConnectionId.value;
  const database = side === "source" ? sourceDatabase.value : targetDatabase.value;
  if (!connectionId || !database) return;
  const config = store.getConfig(connectionId);
  if (!isSchemaAware(config?.db_type)) {
    if (side === "source") {
      sourceSchemas.value = [];
      sourceSchema.value = database;
    } else {
      targetSchemas.value = [];
      targetSchema.value = database;
    }
    return;
  }

  const schemas = await api.listSchemas(connectionId, database);
  const selected =
    preferredSchema && schemas.includes(preferredSchema)
      ? preferredSchema
      : schemas.includes("public")
        ? "public"
        : (schemas[0] ?? "");
  if (side === "source") {
    sourceSchemas.value = schemas;
    sourceSchema.value = selected;
  } else {
    targetSchemas.value = schemas;
    targetSchema.value = selected;
  }
}

async function startCompare() {
  if (!canCompare.value) return;
  step.value = "comparing";
  diffs.value = [];
  syncSql.value = "";

  try {
    await store.ensureConnected(sourceConnectionId.value);
    await store.ensureConnected(targetConnectionId.value);

    const [srcTables, tgtTables] = await Promise.all([
      api.listTables(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value),
      api.listTables(targetConnectionId.value, targetDatabase.value, targetSchema.value),
    ]);

    const srcTableNames = srcTables.filter((t) => t.table_type !== "VIEW").map((t) => t.name);
    const tgtTableNames = tgtTables.filter((t) => t.table_type !== "VIEW").map((t) => t.name);
    const srcViewNames = srcTables.filter((t) => t.table_type === "VIEW").map((t) => t.name);
    const tgtViewNames = tgtTables.filter((t) => t.table_type === "VIEW").map((t) => t.name);
    const { added, removed, common } = diffTables(srcTableNames, tgtTableNames);
    const { added: addedViews, removed: removedViews } = diffTables(srcViewNames, tgtViewNames);

    const result: TableDiff[] = [];

    for (const name of added) {
      const ddl = await api.getTableDdl(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value, name);
      result.push({ type: "added", objectType: "table", name, ddl });
    }

    for (const name of removed) {
      result.push({ type: "removed", objectType: "table", name });
    }

    for (const name of addedViews) {
      result.push({ type: "added", objectType: "view", name });
    }

    for (const name of removedViews) {
      result.push({ type: "removed", objectType: "view", name });
    }

    for (const name of common) {
      const [srcCols, tgtCols, srcIdx, tgtIdx, srcFks, tgtFks, srcTriggers, tgtTriggers] = await Promise.all([
        api.getColumns(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value, name),
        api.getColumns(targetConnectionId.value, targetDatabase.value, targetSchema.value, name),
        api.listIndexes(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value, name),
        api.listIndexes(targetConnectionId.value, targetDatabase.value, targetSchema.value, name),
        api.listForeignKeys(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value, name),
        api.listForeignKeys(targetConnectionId.value, targetDatabase.value, targetSchema.value, name),
        api.listTriggers(sourceConnectionId.value, sourceDatabase.value, sourceSchema.value, name),
        api.listTriggers(targetConnectionId.value, targetDatabase.value, targetSchema.value, name),
      ]);

      const colDiffs = diffColumns(srcCols, tgtCols);
      const idxDiffs = diffIndexes(srcIdx, tgtIdx);
      const fkDiffs = diffForeignKeys(srcFks, tgtFks);
      const triggerDiffs = diffTriggers(srcTriggers, tgtTriggers);

      if (colDiffs.length > 0 || idxDiffs.length > 0 || fkDiffs.length > 0 || triggerDiffs.length > 0) {
        result.push({
          type: "modified",
          objectType: "table",
          name,
          columns: colDiffs.length > 0 ? colDiffs : undefined,
          indexes: idxDiffs.length > 0 ? idxDiffs : undefined,
          foreignKeys: fkDiffs.length > 0 ? fkDiffs : undefined,
          triggers: triggerDiffs.length > 0 ? triggerDiffs : undefined,
        });
      }
    }

    diffs.value = result;
    const srcConfig = store.getConfig(targetConnectionId.value);
    syncSql.value = generateSyncSql(result, srcConfig?.db_type || "mysql", targetSchema.value);
    step.value = "result";
  } catch (e: any) {
    toast(e?.message || String(e), 5000);
    step.value = "select";
  }
}

async function executeSql() {
  if (!syncSql.value.trim() || executing.value) return;
  executing.value = true;
  try {
    await store.ensureConnected(targetConnectionId.value);
    await api.executeScript(targetConnectionId.value, targetDatabase.value, syncSql.value, targetSchema.value);
    toast(t("diff.syncSuccess"), 2000);
    open.value = false;
  } catch (e: any) {
    toast(e?.message || String(e), 5000);
  } finally {
    executing.value = false;
  }
}

function copySql() {
  navigator.clipboard.writeText(syncSql.value);
  toast(t("grid.copied"));
}

function diffBadgeVariant(type: string) {
  if (type === "added") return "default";
  if (type === "removed") return "destructive";
  return "secondary";
}

function diffLabel(type: string) {
  if (type === "added") return t("diff.added");
  if (type === "removed") return t("diff.removed");
  return t("diff.modified");
}

function resetResult() {
  step.value = "select";
  diffs.value = [];
  syncSql.value = "";
}

watch(sourceConnectionId, (id) => {
  sourceDatabase.value = "";
  loadDatabases(id, "source");
  resetResult();
});

watch(targetConnectionId, (id) => {
  targetDatabase.value = "";
  loadDatabases(id, "target");
  resetResult();
});

watch(sourceDatabase, (database) => {
  sourceSchema.value = "";
  sourceSchemas.value = [];
  resetResult();
  if (database) loadSchemas("source", props.prefillSchema).catch((e) => toast(String(e), 5000));
});
watch(targetDatabase, (database) => {
  targetSchema.value = "";
  targetSchemas.value = [];
  resetResult();
  if (database) loadSchemas("target").catch((e) => toast(String(e), 5000));
});
watch(sourceSchema, () => resetResult());
watch(targetSchema, () => resetResult());

watch(open, async (val) => {
  if (val) {
    step.value = "select";
    diffs.value = [];
    syncSql.value = "";
    if (props.prefillConnectionId) {
      sourceConnectionId.value = props.prefillConnectionId;
      await loadDatabases(props.prefillConnectionId, "source");
      if (props.prefillDatabase) {
        sourceDatabase.value = props.prefillDatabase;
        await loadSchemas("source", props.prefillSchema);
      }
    }
  }
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <GitCompareArrows class="w-4 h-4" />
          {{ t("diff.title") }}
        </DialogTitle>
      </DialogHeader>

      <div class="flex-1 min-h-0 overflow-auto space-y-4 py-2">
        <!-- Source / Target Selection -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label class="text-xs font-medium">{{ t("diff.source") }}</Label>
            <Select
              :model-value="sourceConnectionId"
              @update:model-value="(v: any) => (sourceConnectionId = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <div class="flex items-center gap-2">
                  <DatabaseIcon
                    v-if="sourceConnectionId"
                    :db-type="connectionIconType(sourceConnectionId)"
                    class="w-3.5 h-3.5"
                  />
                  <SelectValue :placeholder="t('diff.selectConnection')" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in sqlConnections" :key="c.id" :value="c.id">
                  <div class="flex items-center gap-2">
                    <DatabaseIcon :db-type="c.driver_profile || c.db_type" class="w-3.5 h-3.5" />
                    {{ c.name }}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              v-if="sourceDatabases.length"
              :model-value="sourceDatabase"
              @update:model-value="(v: any) => (sourceDatabase = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('diff.selectDatabase')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="db in sourceDatabases" :key="db" :value="db">{{ db }}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              v-if="sourceSchemas.length"
              :model-value="sourceSchema"
              @update:model-value="(v: any) => (sourceSchema = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('diff.selectSchema')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="schema in sourceSchemas" :key="schema" :value="schema">{{ schema }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label class="text-xs font-medium">{{ t("diff.target") }}</Label>
            <Select
              :model-value="targetConnectionId"
              @update:model-value="(v: any) => (targetConnectionId = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <div class="flex items-center gap-2">
                  <DatabaseIcon
                    v-if="targetConnectionId"
                    :db-type="connectionIconType(targetConnectionId)"
                    class="w-3.5 h-3.5"
                  />
                  <SelectValue :placeholder="t('diff.selectConnection')" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in sqlConnections" :key="c.id" :value="c.id">
                  <div class="flex items-center gap-2">
                    <DatabaseIcon :db-type="c.driver_profile || c.db_type" class="w-3.5 h-3.5" />
                    {{ c.name }}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              v-if="targetDatabases.length"
              :model-value="targetDatabase"
              @update:model-value="(v: any) => (targetDatabase = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('diff.selectDatabase')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="db in targetDatabases" :key="db" :value="db">{{ db }}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              v-if="targetSchemas.length"
              :model-value="targetSchema"
              @update:model-value="(v: any) => (targetSchema = String(v))"
            >
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('diff.selectSchema')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="schema in targetSchemas" :key="schema" :value="schema">{{ schema }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button v-if="step === 'select'" size="sm" :disabled="!canCompare" @click="startCompare">
          <GitCompareArrows class="w-3.5 h-3.5 mr-1" />
          {{ t("diff.compare") }}
        </Button>

        <!-- Comparing -->
        <div v-if="step === 'comparing'" class="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 class="w-4 h-4 animate-spin mr-2" />
          {{ t("diff.comparing") }}
        </div>

        <!-- Results -->
        <template v-if="step === 'result'">
          <div v-if="diffs.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            {{ t("diff.noDifferences") }}
          </div>

          <template v-else>
            <!-- Diff Table -->
            <div class="border rounded-lg overflow-hidden">
              <div class="max-h-60 overflow-auto">
                <table class="w-full text-xs table-fixed">
                  <thead class="bg-muted sticky top-0 z-10">
                    <tr>
                      <th class="text-left px-3 py-2 font-medium w-1/4">{{ t("diff.table") }}</th>
                      <th class="text-left px-3 py-2 font-medium w-16">{{ t("diff.status") }}</th>
                      <th class="text-left px-3 py-2 font-medium">{{ t("diff.details") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="d in diffs" :key="d.name" class="border-t border-border/50 hover:bg-accent/30">
                      <td class="px-3 py-1.5 font-mono truncate">{{ d.name }}</td>
                      <td class="px-3 py-1.5">
                        <Badge :variant="diffBadgeVariant(d.type)" class="text-[10px] h-4 px-1.5">
                          {{ diffLabel(d.type) }}
                        </Badge>
                      </td>
                      <td class="px-3 py-1.5 text-muted-foreground">
                        <template v-if="d.type === 'modified' && d.columns">
                          <span v-for="(col, ci) in d.columns" :key="`col-${ci}`">
                            <span
                              :class="{
                                'text-green-500': col.type === 'added',
                                'text-red-500': col.type === 'removed',
                                'text-yellow-500': col.type === 'modified',
                              }"
                              >{{ col.type === "added" ? "+" : col.type === "removed" ? "-" : "~" }}{{ col.name }}</span
                            >
                            <span v-if="ci < d.columns!.length - 1">, </span>
                          </span>
                        </template>
                        <template v-if="d.type === 'modified' && d.indexes">
                          <span v-if="d.columns?.length">; </span>
                          <span>{{ t("diff.indexes") }}: </span>
                          <span v-for="(idx, ii) in d.indexes" :key="`idx-${ii}`">
                            <span
                              :class="{
                                'text-green-500': idx.type === 'added',
                                'text-red-500': idx.type === 'removed',
                                'text-yellow-500': idx.type === 'modified',
                              }"
                              >{{ idx.type === "added" ? "+" : idx.type === "removed" ? "-" : "~" }}{{ idx.name }}</span
                            >
                            <span v-if="ii < d.indexes!.length - 1">, </span>
                          </span>
                        </template>
                        <template v-if="d.type === 'modified' && d.foreignKeys">
                          <span v-if="d.columns?.length || d.indexes?.length">; </span>
                          <span>{{ t("diff.foreignKeys") }}: </span>
                          <span v-for="(fk, fi) in d.foreignKeys" :key="`fk-${fi}`">
                            <span
                              :class="{
                                'text-green-500': fk.type === 'added',
                                'text-red-500': fk.type === 'removed',
                                'text-yellow-500': fk.type === 'modified',
                              }"
                              >{{ fk.type === "added" ? "+" : fk.type === "removed" ? "-" : "~" }}{{ fk.name }}</span
                            >
                            <span v-if="fi < d.foreignKeys!.length - 1">, </span>
                          </span>
                        </template>
                        <template v-if="d.type === 'modified' && d.triggers">
                          <span v-if="d.columns?.length || d.indexes?.length || d.foreignKeys?.length">; </span>
                          <span>{{ t("diff.triggers") }}: </span>
                          <span v-for="(trigger, ti) in d.triggers" :key="`trigger-${ti}`">
                            <span
                              :class="{
                                'text-green-500': trigger.type === 'added',
                                'text-red-500': trigger.type === 'removed',
                                'text-yellow-500': trigger.type === 'modified',
                              }"
                              >{{ trigger.type === "added" ? "+" : trigger.type === "removed" ? "-" : "~"
                              }}{{ trigger.name }}</span
                            >
                            <span v-if="ti < d.triggers!.length - 1">, </span>
                          </span>
                        </template>
                        <span v-else-if="d.type === 'added'" class="text-green-500">{{ t("diff.newTable") }}</span>
                        <span v-else-if="d.type === 'removed'" class="text-red-500">{{ t("diff.dropTable") }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- SQL Preview -->
            <div class="space-y-1">
              <Label class="text-xs font-medium">{{ t("diff.generatedSql") }}</Label>
              <textarea
                v-model="syncSql"
                class="w-full h-48 rounded-lg border bg-muted/20 p-3 font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </template>
        </template>
      </div>

      <DialogFooter v-if="step === 'result' && diffs.length > 0" class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="copySql">
          <Copy class="w-3 h-3 mr-1" /> {{ t("diff.copySql") }}
        </Button>
        <Button size="sm" :disabled="!syncSql.trim() || executing" @click="executeSql">
          <Loader2 v-if="executing" class="w-3 h-3 animate-spin mr-1" />
          <Play v-else class="w-3 h-3 mr-1" />
          {{ t("diff.executeSync") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
