<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Copy, Trash2, Save, RefreshCw, Plus, Loader2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import DangerConfirmDialog from "@/components/editor/DangerConfirmDialog.vue";
import * as api from "@/lib/api";
import type { RedisValue } from "@/lib/api";

const { t } = useI18n();

const props = defineProps<{
  connectionId: string;
  db: number;
  keyDisplay: string;
  keyRaw: string;
}>();

const emit = defineEmits<{ deleted: [] }>();

const data = ref<RedisValue | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const editValue = ref("");
const isEditing = ref(false);
const newField = ref("");
const newValue = ref("");
const newScore = ref("");
const showDeleteConfirm = ref(false);
const editingTtl = ref(false);
const ttlInput = ref("");
const collectionItems = ref<any[]>([]);
const scanCursor = ref<number | undefined>(undefined);

type PendingDelete =
  | { kind: "key" }
  | { kind: "hash"; field: string }
  | { kind: "list"; index: number }
  | { kind: "set"; member: string }
  | { kind: "zset"; member: string };

const pendingDelete = ref<PendingDelete | null>(null);

const deleteDetails = computed(() => {
  const pending = pendingDelete.value;
  if (!pending) return "";
  if (pending.kind === "key") return t("dangerDialog.redisKeyDetails", { key: props.keyDisplay });
  if (pending.kind === "hash")
    return t("dangerDialog.redisHashFieldDetails", { key: props.keyDisplay, field: pending.field });
  if (pending.kind === "list")
    return t("dangerDialog.redisListItemDetails", { key: props.keyDisplay, index: pending.index });
  if (pending.kind === "zset")
    return t("dangerDialog.redisSetMemberDetails", { key: props.keyDisplay, member: pending.member });
  return t("dangerDialog.redisSetMemberDetails", { key: props.keyDisplay, member: pending.member });
});

const isBinaryStringValue = computed(() => data.value?.key_type === "string" && data.value?.value_is_binary);
const hasMore = computed(() => scanCursor.value != null && scanCursor.value > 0);

async function load() {
  loading.value = true;
  try {
    data.value = await api.redisGetValue(props.connectionId, props.db, props.keyRaw);
    scanCursor.value = data.value.scan_cursor ?? undefined;
    if (data.value.key_type === "string") {
      editValue.value = String(data.value.value);
    } else if (["list", "set", "zset", "hash"].includes(data.value.key_type)) {
      collectionItems.value = Array.isArray(data.value.value) ? [...data.value.value] : [];
    }
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!data.value || !hasMore.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const result = await api.redisLoadMore(
      props.connectionId,
      props.db,
      props.keyRaw,
      data.value.key_type,
      scanCursor.value!,
      200,
    );
    const newItems = Array.isArray(result.value) ? result.value : [];
    collectionItems.value = [...collectionItems.value, ...newItems];
    scanCursor.value = result.scan_cursor ?? undefined;
  } finally {
    loadingMore.value = false;
  }
}

async function saveString() {
  if (isBinaryStringValue.value) return;
  await api.redisSetString(props.connectionId, props.db, props.keyRaw, editValue.value);
  isEditing.value = false;
  await load();
}

function handleStringInput() {
  if (!isBinaryStringValue.value) {
    isEditing.value = true;
  }
}

async function applyDeleteKey() {
  await api.redisDeleteKey(props.connectionId, props.db, props.keyRaw);
  emit("deleted");
}

function requestDeleteKey() {
  pendingDelete.value = { kind: "key" };
  showDeleteConfirm.value = true;
}

function copyValue() {
  if (!data.value) return;
  const text = typeof data.value.value === "string" ? data.value.value : JSON.stringify(data.value.value, null, 2);
  navigator.clipboard.writeText(text);
}

// TTL
function startEditTtl() {
  if (!data.value) return;
  ttlInput.value = data.value.ttl > 0 ? String(data.value.ttl) : "";
  editingTtl.value = true;
}

async function saveTtl() {
  const val = ttlInput.value.trim();
  const ttl = val === "" || val === "-1" ? -1 : parseInt(val, 10);
  if (isNaN(ttl)) return;
  await api.redisSetTtl(props.connectionId, props.db, props.keyRaw, ttl);
  editingTtl.value = false;
  await load();
}

function cancelEditTtl() {
  editingTtl.value = false;
}

// Hash
async function hashSet() {
  if (!newField.value) return;
  await api.redisHashSet(props.connectionId, props.db, props.keyRaw, newField.value, newValue.value);
  newField.value = "";
  newValue.value = "";
  await load();
}
async function applyHashDel(field: string) {
  await api.redisHashDel(props.connectionId, props.db, props.keyRaw, field);
  await load();
}
function requestHashDel(field: string) {
  pendingDelete.value = { kind: "hash", field };
  showDeleteConfirm.value = true;
}

// List
async function listPush() {
  if (!newValue.value) return;
  await api.redisListPush(props.connectionId, props.db, props.keyRaw, newValue.value);
  newValue.value = "";
  await load();
}
async function applyListRemove(index: number) {
  await api.redisListRemove(props.connectionId, props.db, props.keyRaw, index);
  await load();
}
function requestListRemove(index: number) {
  pendingDelete.value = { kind: "list", index };
  showDeleteConfirm.value = true;
}

// Set
async function setAdd() {
  if (!newValue.value) return;
  await api.redisSetAdd(props.connectionId, props.db, props.keyRaw, newValue.value);
  newValue.value = "";
  await load();
}
async function applySetRemove(member: string) {
  await api.redisSetRemove(props.connectionId, props.db, props.keyRaw, member);
  await load();
}
function requestSetRemove(member: string) {
  pendingDelete.value = { kind: "set", member };
  showDeleteConfirm.value = true;
}

// ZSet
async function zsetAdd() {
  if (!newValue.value) return;
  const score = parseFloat(newScore.value || "0");
  await api.redisZadd(props.connectionId, props.db, props.keyRaw, newValue.value, score);
  newValue.value = "";
  newScore.value = "";
  await load();
}
async function applyZsetRemove(member: string) {
  await api.redisZrem(props.connectionId, props.db, props.keyRaw, member);
  await load();
}
function requestZsetRemove(member: string) {
  pendingDelete.value = { kind: "zset", member };
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  const pending = pendingDelete.value;
  if (!pending) return;
  if (pending.kind === "key") await applyDeleteKey();
  else if (pending.kind === "hash") await applyHashDel(pending.field);
  else if (pending.kind === "list") await applyListRemove(pending.index);
  else if (pending.kind === "set") await applySetRemove(pending.member);
  else if (pending.kind === "zset") await applyZsetRemove(pending.member);
  pendingDelete.value = null;
}

function formatValue(val: any): string {
  if (typeof val === "string") return val;
  return JSON.stringify(val, null, 2);
}

onMounted(load);
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground">
      {{ t("common.loading") }}
    </div>

    <template v-else-if="data">
      <!-- Header -->
      <div class="h-9 flex items-center gap-2 px-4 border-b bg-muted/30 shrink-0">
        <span class="font-mono text-sm font-medium truncate">{{ data.key_display }}</span>
        <Badge variant="secondary" class="text-xs">{{ data.key_type }}</Badge>
        <template v-if="!editingTtl">
          <Badge
            v-if="data.ttl > 0"
            variant="outline"
            class="text-xs cursor-pointer hover:bg-accent"
            @click="startEditTtl"
            >TTL: {{ data.ttl }}s</Badge
          >
          <Badge
            v-else-if="data.ttl === -1"
            variant="outline"
            class="text-xs opacity-50 cursor-pointer hover:bg-accent hover:opacity-100"
            @click="startEditTtl"
            >{{ t("redis.noExpiry") }}</Badge
          >
        </template>
        <div v-else class="flex items-center gap-1">
          <Input
            v-model="ttlInput"
            class="h-6 w-20 text-xs"
            placeholder="seconds (-1=no expiry)"
            autofocus
            @keydown.enter="saveTtl"
            @keydown.escape="cancelEditTtl"
          />
          <Button variant="ghost" size="icon" class="h-6 w-6" @click="saveTtl"><Save class="h-3 w-3" /></Button>
        </div>
        <span class="flex-1" />
        <Button variant="ghost" size="icon" class="h-7 w-7" @click="load"><RefreshCw class="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" class="h-7 w-7" @click="copyValue"><Copy class="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" class="h-7 w-7 text-destructive" @click="requestDeleteKey"
          ><Trash2 class="h-3.5 w-3.5"
        /></Button>
      </div>

      <!-- String -->
      <div v-if="data.key_type === 'string'" class="flex-1 flex flex-col overflow-hidden">
        <textarea
          v-model="editValue"
          class="flex-1 p-4 font-mono text-sm bg-background resize-none outline-none"
          :readonly="isBinaryStringValue"
          @input="handleStringInput"
        />
        <div v-if="isBinaryStringValue" class="px-4 py-2 border-t text-xs text-muted-foreground shrink-0">
          {{ t("redis.binaryStringReadonlyHint") }}
        </div>
        <div v-if="isEditing" class="px-4 py-2 border-t flex justify-end gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            @click="
              isEditing = false;
              editValue = String(data.value);
            "
            >{{ t("grid.discard") }}</Button
          >
          <Button size="sm" @click="saveString"><Save class="w-3 h-3 mr-1" /> {{ t("grid.save") }}</Button>
        </div>
      </div>

      <!-- List -->
      <div v-else-if="data.key_type === 'list'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
          <span class="text-xs text-muted-foreground">{{
            t("redis.items", { count: collectionItems.length }) + (data.total != null ? ` / ${data.total}` : "")
          }}</span>
          <span class="flex-1" />
          <Input v-model="newValue" class="h-6 w-40 text-xs" placeholder="value" @keydown.enter="listPush" />
          <Button variant="ghost" size="sm" class="h-6 text-xs" @click="listPush"
            ><Plus class="w-3 h-3 mr-1" />Push</Button
          >
        </div>
        <div class="grid grid-cols-[60px_1fr_32px] border-b bg-muted/50 shrink-0">
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground border-r">#</div>
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground">Value</div>
          <div />
        </div>
        <div class="flex-1 overflow-y-auto">
          <div
            v-for="(item, idx) in collectionItems"
            :key="idx"
            class="grid grid-cols-[60px_1fr_32px] border-b text-sm font-mono hover:bg-accent/50 group"
          >
            <div class="px-3 py-1.5 text-xs text-muted-foreground border-r">{{ idx }}</div>
            <div class="px-3 py-1.5 truncate">{{ item }}</div>
            <div class="flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                @click="requestListRemove(Number(idx))"
                ><Trash2 class="w-3 h-3"
              /></Button>
            </div>
          </div>
          <div v-if="hasMore" class="p-2">
            <Button variant="outline" size="sm" class="w-full h-7 text-xs" :disabled="loadingMore" @click="loadMore">
              <Loader2 v-if="loadingMore" class="w-3 h-3 mr-1.5 animate-spin" />
              {{ t("redis.loadMoreKeys") }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Set -->
      <div v-else-if="data.key_type === 'set'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
          <span class="text-xs text-muted-foreground">{{
            t("redis.items", { count: collectionItems.length }) + (data.total != null ? ` / ${data.total}` : "")
          }}</span>
          <span class="flex-1" />
          <Input v-model="newValue" class="h-6 w-40 text-xs" placeholder="member" @keydown.enter="setAdd" />
          <Button variant="ghost" size="sm" class="h-6 text-xs" @click="setAdd"
            ><Plus class="w-3 h-3 mr-1" />Add</Button
          >
        </div>
        <div class="grid grid-cols-[1fr_32px] border-b bg-muted/50 shrink-0">
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground">Member</div>
          <div />
        </div>
        <div class="flex-1 overflow-y-auto">
          <div
            v-for="(item, idx) in collectionItems"
            :key="idx"
            class="grid grid-cols-[1fr_32px] border-b text-sm font-mono hover:bg-accent/50 group"
          >
            <div class="px-3 py-1.5 truncate">{{ item }}</div>
            <div class="flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                @click="requestSetRemove(String(item))"
                ><Trash2 class="w-3 h-3"
              /></Button>
            </div>
          </div>
          <div v-if="hasMore" class="p-2">
            <Button variant="outline" size="sm" class="w-full h-7 text-xs" :disabled="loadingMore" @click="loadMore">
              <Loader2 v-if="loadingMore" class="w-3 h-3 mr-1.5 animate-spin" />
              {{ t("redis.loadMoreKeys") }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Hash -->
      <div v-else-if="data.key_type === 'hash'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
          <span class="text-xs text-muted-foreground">{{
            t("redis.fields", { count: collectionItems.length }) + (data.total != null ? ` / ${data.total}` : "")
          }}</span>
          <span class="flex-1" />
          <Input v-model="newField" class="h-6 w-24 text-xs" placeholder="field" />
          <Input v-model="newValue" class="h-6 w-32 text-xs" placeholder="value" @keydown.enter="hashSet" />
          <Button variant="ghost" size="sm" class="h-6 text-xs" @click="hashSet"
            ><Plus class="w-3 h-3 mr-1" />Set</Button
          >
        </div>
        <div class="grid grid-cols-[minmax(8rem,0.3fr)_1fr_32px] border-b bg-muted/50 shrink-0">
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground border-r">Field</div>
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground">Value</div>
          <div />
        </div>
        <div class="flex-1 overflow-y-auto">
          <div
            v-for="(item, idx) in collectionItems"
            :key="idx"
            class="grid grid-cols-[minmax(8rem,0.3fr)_1fr_32px] border-b text-sm font-mono hover:bg-accent/50 group"
          >
            <div class="px-3 py-1.5 text-blue-500 truncate border-r">{{ item.field }}</div>
            <div class="px-3 py-1.5 truncate text-muted-foreground">{{ item.value }}</div>
            <div class="flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                @click="requestHashDel(String(item.field))"
                ><Trash2 class="w-3 h-3"
              /></Button>
            </div>
          </div>
          <div v-if="hasMore" class="p-2">
            <Button variant="outline" size="sm" class="w-full h-7 text-xs" :disabled="loadingMore" @click="loadMore">
              <Loader2 v-if="loadingMore" class="w-3 h-3 mr-1.5 animate-spin" />
              {{ t("redis.loadMoreKeys") }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Sorted Set -->
      <div v-else-if="data.key_type === 'zset'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
          <span class="text-xs text-muted-foreground">{{
            t("redis.members", { count: collectionItems.length }) + (data.total != null ? ` / ${data.total}` : "")
          }}</span>
          <span class="flex-1" />
          <Input v-model="newScore" class="h-6 w-20 text-xs" placeholder="score" />
          <Input v-model="newValue" class="h-6 w-32 text-xs" placeholder="member" @keydown.enter="zsetAdd" />
          <Button variant="ghost" size="sm" class="h-6 text-xs" @click="zsetAdd"
            ><Plus class="w-3 h-3 mr-1" />Add</Button
          >
        </div>
        <div class="grid grid-cols-[100px_1fr_32px] border-b bg-muted/50 shrink-0">
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground border-r">Score</div>
          <div class="px-3 py-1 text-xs font-medium text-muted-foreground">Member</div>
          <div />
        </div>
        <div class="flex-1 overflow-y-auto">
          <div
            v-for="(item, idx) in collectionItems"
            :key="idx"
            class="grid grid-cols-[100px_1fr_32px] border-b text-sm font-mono hover:bg-accent/50 group"
          >
            <div class="px-3 py-1.5 text-muted-foreground text-xs border-r">{{ item.score }}</div>
            <div class="px-3 py-1.5 truncate">{{ item.member }}</div>
            <div class="flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                @click="requestZsetRemove(String(item.member))"
                ><Trash2 class="w-3 h-3"
              /></Button>
            </div>
          </div>
          <div v-if="hasMore" class="p-2">
            <Button variant="outline" size="sm" class="w-full h-7 text-xs" :disabled="loadingMore" @click="loadMore">
              <Loader2 v-if="loadingMore" class="w-3 h-3 mr-1.5 animate-spin" />
              {{ t("redis.loadMoreKeys") }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Stream (readonly) -->
      <div v-else-if="data.key_type === 'stream'" class="flex-1 overflow-auto">
        <div class="px-4 py-1 text-xs text-muted-foreground border-b">
          {{ t("redis.entries", { count: Array.isArray(data.value) ? data.value.length : 0 }) }}
        </div>
        <div
          v-for="entry in data.value"
          :key="entry.id"
          class="px-4 py-2 border-b text-sm font-mono hover:bg-accent/50"
        >
          <div class="mb-1 text-xs text-muted-foreground">{{ entry.id }}</div>
          <div
            v-for="(val, field) in entry.fields"
            :key="String(field)"
            class="grid grid-cols-[minmax(6rem,0.35fr)_1fr] gap-3 py-0.5"
          >
            <span class="truncate text-blue-500">{{ field }}</span>
            <span class="truncate text-muted-foreground">{{ val }}</span>
          </div>
        </div>
      </div>

      <!-- Unknown -->
      <div v-else class="flex-1 overflow-auto p-4">
        <pre class="font-mono text-sm whitespace-pre-wrap">{{ formatValue(data.value) }}</pre>
      </div>
    </template>

    <DangerConfirmDialog
      v-model:open="showDeleteConfirm"
      :message="t('dangerDialog.deleteMessage')"
      :details="deleteDetails"
      :confirm-label="t('dangerDialog.deleteConfirm')"
      @confirm="confirmDelete"
    />
  </div>
</template>
