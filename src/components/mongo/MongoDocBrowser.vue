<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RefreshCw, Trash2, Plus, Save, ChevronLeft, ChevronRight } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import * as api from "@/lib/tauri";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";

const { t } = useI18n();

const props = defineProps<{
  connectionId: string;
  database: string;
  collection: string;
}>();

const documents = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref(0);
const pageSize = 50;
const selectedIdx = ref<number | null>(null);
const editJson = ref("");
const isEditing = ref(false);
const isNew = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await api.mongoFindDocuments(
      props.connectionId, props.database, props.collection,
      page.value * pageSize, pageSize
    );
    documents.value = result.documents;
    total.value = result.total;
  } catch (e: any) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function selectDoc(idx: number) {
  selectedIdx.value = idx;
  editJson.value = JSON.stringify(documents.value[idx], null, 2);
  isEditing.value = false;
  isNew.value = false;
}

function startNew() {
  selectedIdx.value = null;
  editJson.value = '{\n  \n}';
  isEditing.value = true;
  isNew.value = true;
}

async function saveDoc() {
  error.value = "";
  try {
    if (isNew.value) {
      await api.mongoInsertDocument(props.connectionId, props.database, props.collection, editJson.value);
    } else if (selectedIdx.value !== null) {
      const doc = documents.value[selectedIdx.value];
      const id = doc._id;
      if (!id) { error.value = "No _id field"; return; }
      const parsed = JSON.parse(editJson.value);
      delete parsed._id;
      await api.mongoUpdateDocument(props.connectionId, props.database, props.collection, id, JSON.stringify(parsed));
    }
    isEditing.value = false;
    isNew.value = false;
    await load();
  } catch (e: any) {
    error.value = String(e);
  }
}

async function deleteDoc(idx: number) {
  const doc = documents.value[idx];
  const id = doc._id;
  if (!id) return;
  error.value = "";
  try {
    await api.mongoDeleteDocument(props.connectionId, props.database, props.collection, id);
    if (selectedIdx.value === idx) { selectedIdx.value = null; editJson.value = ""; }
    await load();
  } catch (e: any) {
    error.value = String(e);
  }
}

function prevPage() {
  if (page.value <= 0) return;
  page.value--;
  load();
}

function nextPage() {
  if ((page.value + 1) * pageSize >= total.value) return;
  page.value++;
  load();
}

function docPreview(doc: any): string {
  const id = doc._id || "";
  const keys = Object.keys(doc).filter(k => k !== "_id").slice(0, 3);
  const preview = keys.map(k => `${k}: ${JSON.stringify(doc[k]).substring(0, 30)}`).join(", ");
  return `${id} — ${preview}`;
}

function highlightedJson(json: string): string {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (match.startsWith('"')) cls = match.endsWith(":") ? "json-key" : "json-string";
      else if (match === "true" || match === "false") cls = "json-boolean";
      else if (match === "null") cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

onMounted(load);
</script>

<template>
  <Splitpanes class="h-full">
    <!-- Document list (left) -->
    <Pane :size="30" :min-size="15" :max-size="50">
      <div class="h-full flex flex-col overflow-hidden">
      <div class="flex items-center gap-1 px-3 py-1.5 border-b shrink-0 text-xs text-muted-foreground">
        <span>{{ total }} documents</span>
        <span class="flex-1" />
        <Button variant="ghost" size="icon" class="h-5 w-5" @click="startNew"><Plus class="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" class="h-5 w-5" @click="load"><RefreshCw class="h-3 w-3" /></Button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-for="(doc, idx) in documents"
          :key="idx"
          class="px-3 py-1.5 border-b text-xs font-mono cursor-pointer hover:bg-accent/50 flex items-center gap-2 group"
          :class="{ 'bg-accent': selectedIdx === idx }"
          @click="selectDoc(idx)"
        >
          <span class="truncate flex-1">{{ docPreview(doc) }}</span>
          <Button variant="ghost" size="icon" class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive shrink-0" @click.stop="deleteDoc(idx)">
            <Trash2 class="w-3 h-3" />
          </Button>
        </div>
        <div v-if="documents.length === 0 && !loading" class="px-3 py-8 text-center text-muted-foreground text-xs">
          Empty collection
        </div>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-center gap-2 px-3 py-1 border-t text-xs text-muted-foreground shrink-0">
        <Button variant="ghost" size="icon" class="h-5 w-5" :disabled="page <= 0" @click="prevPage">
          <ChevronLeft class="h-3 w-3" />
        </Button>
        <span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
        <Button variant="ghost" size="icon" class="h-5 w-5" :disabled="(page + 1) * pageSize >= total" @click="nextPage">
          <ChevronRight class="h-3 w-3" />
        </Button>
      </div>
    </div>
    </Pane>

    <!-- Document viewer/editor (right) -->
    <Pane :size="70">
    <div class="h-full flex flex-col min-w-0 overflow-hidden">
      <template v-if="selectedIdx !== null || isNew">
        <div class="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0">
          <Badge variant="secondary" class="text-xs">{{ isNew ? 'New' : documents[selectedIdx!]?._id }}</Badge>
          <span class="flex-1" />
          <Button v-if="!isEditing" variant="ghost" size="sm" class="h-6 text-xs" @click="isEditing = true">Edit</Button>
          <template v-if="isEditing">
            <Button variant="ghost" size="sm" class="h-6 text-xs" @click="isEditing = false; isNew = false">{{ t('grid.discard') }}</Button>
            <Button size="sm" class="h-6 text-xs" @click="saveDoc"><Save class="w-3 h-3 mr-1" />{{ t('grid.save') }}</Button>
          </template>
        </div>
        <textarea
          v-if="isEditing"
          v-model="editJson"
          class="flex-1 p-4 font-mono text-xs bg-background resize-none outline-none"
        />
        <div v-else class="flex-1 overflow-auto bg-muted/10">
          <pre
            class="json-viewer min-w-fit p-5 font-mono text-[13px] leading-6"
            v-html="highlightedJson(editJson)"
          />
        </div>
      </template>
      <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
        Select a document
      </div>

      <div v-if="error" class="px-3 py-1.5 border-t bg-destructive/10 text-destructive text-xs shrink-0">
        {{ error }}
      </div>
    </div>
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.json-viewer {
  tab-size: 2;
  white-space: pre;
}

:deep(.json-key) {
  color: #7c3aed;
  font-weight: 600;
}

:deep(.json-string) {
  color: #15803d;
}

:deep(.json-number) {
  color: #b45309;
}

:deep(.json-boolean) {
  color: #2563eb;
  font-weight: 600;
}

:deep(.json-null) {
  color: #64748b;
  font-style: italic;
}

:global(.dark) :deep(.json-key) {
  color: #c4b5fd;
}

:global(.dark) :deep(.json-string) {
  color: #86efac;
}

:global(.dark) :deep(.json-number) {
  color: #fbbf24;
}

:global(.dark) :deep(.json-boolean) {
  color: #93c5fd;
}

:global(.dark) :deep(.json-null) {
  color: #94a3b8;
}
</style>
