<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Loader2, Save } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSchemaRagSettingsStore } from "@/stores/schemaRagSettingsStore";
import { createDefaultSchemaRagEmbeddingConfig, type SchemaRagEmbeddingConfig } from "@/lib/schemaRagSettings";

const store = useSchemaRagSettingsStore();
const draft = ref<SchemaRagEmbeddingConfig>(createDefaultSchemaRagEmbeddingConfig());
const message = ref("");
const error = ref(false);

watch(
  () => store.config,
  (value) => {
    draft.value = { ...value };
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  if (!store.loaded && !store.loading) {
    void store.load().catch((err) => {
      error.value = true;
      message.value = err?.message || String(err);
    });
  }
});

async function save() {
  message.value = "";
  error.value = false;
  try {
    await store.save(draft.value);
    message.value = "Schema RAG settings saved.";
  } catch (err: any) {
    error.value = true;
    message.value = err?.message || String(err);
  }
}
</script>

<template>
  <div class="flex flex-col gap-5 py-2">
    <div class="rounded-md border bg-muted/20 p-4">
      <div class="space-y-1">
        <Label class="text-base">Schema RAG</Label>
        <p class="text-xs text-muted-foreground">Embedding and rerank settings are stored in the Schema RAG extension config.</p>
      </div>
    </div>

    <div class="space-y-3">
      <Label class="text-sm">Embedding</Label>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Provider</Label>
        <Input v-model="draft.embeddingProvider" class="col-span-2 h-8 text-xs" placeholder="openai-compatible" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Endpoint</Label>
        <Input v-model="draft.embeddingEndpoint" class="col-span-2 h-8 text-xs" placeholder="https://api.example.com/v1" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Model</Label>
        <Input v-model="draft.embeddingModel" class="col-span-2 h-8 text-xs" placeholder="embedding-model" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">API key</Label>
        <Input v-model="draft.embeddingApiKey" type="password" class="col-span-2 h-8 text-xs" autocomplete="off" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Dimension</Label>
        <Input v-model.number="draft.embeddingDimension" type="number" min="1" class="col-span-2 h-8 text-xs" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Batch size</Label>
        <Input v-model.number="draft.embeddingBatchSize" type="number" min="1" class="col-span-2 h-8 text-xs" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Concurrency</Label>
        <Input v-model.number="draft.embeddingConcurrency" type="number" min="1" max="16" class="col-span-2 h-8 text-xs" />
      </div>
    </div>

    <div class="space-y-3">
      <Label class="text-sm">Rerank</Label>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Provider</Label>
        <Input v-model="draft.rerankProvider" class="col-span-2 h-8 text-xs" placeholder="none" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Endpoint</Label>
        <Input v-model="draft.rerankEndpoint" class="col-span-2 h-8 text-xs" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">Model</Label>
        <Input v-model="draft.rerankModel" class="col-span-2 h-8 text-xs" />
      </div>
      <div class="grid grid-cols-3 items-center gap-3">
        <Label class="text-right text-xs">API key</Label>
        <Input v-model="draft.rerankApiKey" type="password" class="col-span-2 h-8 text-xs" autocomplete="off" />
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2">
      <div class="space-y-1">
        <Label for="schema-rag-proxy">Proxy</Label>
        <p class="text-xs text-muted-foreground">Use a dedicated proxy for Schema RAG embedding and rerank requests.</p>
      </div>
      <Switch id="schema-rag-proxy" v-model="draft.proxyEnabled" />
    </div>

    <div class="grid grid-cols-3 items-center gap-3">
      <Label class="text-right text-xs">Proxy URL</Label>
      <Input v-model="draft.proxyUrl" class="col-span-2 h-8 text-xs" placeholder="socks5://127.0.0.1:7890" :disabled="!draft.proxyEnabled" />
    </div>

    <div class="flex items-center gap-3">
      <Button type="button" :disabled="store.saving || store.loading" @click="save">
        <Loader2 v-if="store.saving || store.loading" class="mr-1 h-3 w-3 animate-spin" />
        <Save v-else class="mr-1 h-3 w-3" />
        Save Schema RAG
      </Button>
      <span v-if="message" class="truncate text-xs" :class="error ? 'text-destructive' : 'text-green-500'">
        {{ message }}
      </span>
    </div>
  </div>
</template>
