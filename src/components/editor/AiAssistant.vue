<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Sparkles, Loader2, Settings } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSettingsStore, type AiProvider } from "@/stores/settingsStore";
import { generateSql } from "@/lib/ai";

const { t } = useI18n();
const settings = useSettingsStore();

const props = defineProps<{
  tableContext: string;
}>();

const emit = defineEmits<{
  insertSql: [sql: string];
}>();

const prompt = ref("");
const isGenerating = ref(false);
const showSettings = ref(false);
const error = ref("");

const tempProvider = ref<AiProvider>(settings.aiConfig.provider);
const tempApiKey = ref(settings.aiConfig.apiKey);
const tempEndpoint = ref(settings.aiConfig.endpoint);
const tempModel = ref(settings.aiConfig.model);

function openSettings() {
  tempProvider.value = settings.aiConfig.provider;
  tempApiKey.value = settings.aiConfig.apiKey;
  tempEndpoint.value = settings.aiConfig.endpoint;
  tempModel.value = settings.aiConfig.model;
  showSettings.value = true;
}

function saveSettings() {
  settings.updateAiConfig({
    provider: tempProvider.value,
    apiKey: tempApiKey.value,
    endpoint: tempEndpoint.value,
    model: tempModel.value,
  });
  showSettings.value = false;
}

async function generate() {
  if (!prompt.value.trim()) return;
  if (!settings.isConfigured()) {
    openSettings();
    return;
  }

  isGenerating.value = true;
  error.value = "";
  try {
    const sql = await generateSql(settings.aiConfig, prompt.value, props.tableContext);
    emit("insertSql", sql.trim());
    prompt.value = "";
  } catch (e: any) {
    error.value = String(e.message || e);
  } finally {
    isGenerating.value = false;
  }
}
</script>

<template>
  <div class="flex items-center gap-1 px-2 py-1 border-t bg-muted/20">
    <Sparkles class="w-3.5 h-3.5 text-purple-500 shrink-0" />
    <Input
      v-model="prompt"
      class="h-6 text-xs flex-1 border-0 shadow-none focus-visible:ring-0"
      :placeholder="t('ai.placeholder')"
      @keydown.enter="generate"
    />
    <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" :disabled="isGenerating" @click="generate">
      <Loader2 v-if="isGenerating" class="h-3 w-3 animate-spin" />
      <Sparkles v-else class="h-3 w-3" />
    </Button>
    <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" @click="openSettings">
      <Settings class="h-3 w-3" />
    </Button>
    <span v-if="error" class="text-destructive text-xs truncate max-w-40">{{ error }}</span>
  </div>

  <!-- Settings Dialog -->
  <Dialog v-model:open="showSettings">
    <DialogContent class="sm:max-w-96">
      <DialogHeader>
        <DialogTitle>{{ t('ai.settings') }}</DialogTitle>
      </DialogHeader>
      <div class="grid gap-3 py-3">
        <div class="grid grid-cols-3 items-center gap-3">
          <Label class="text-right text-xs">{{ t('ai.provider') }}</Label>
          <Select :model-value="tempProvider" @update:model-value="(v: any) => tempProvider = v">
            <SelectTrigger class="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid grid-cols-3 items-center gap-3">
          <Label class="text-right text-xs">API Key</Label>
          <Input v-model="tempApiKey" type="password" class="col-span-2 h-8 text-xs" />
        </div>
        <div class="grid grid-cols-3 items-center gap-3">
          <Label class="text-right text-xs">Endpoint</Label>
          <Input v-model="tempEndpoint" class="col-span-2 h-8 text-xs" />
        </div>
        <div class="grid grid-cols-3 items-center gap-3">
          <Label class="text-right text-xs">Model</Label>
          <Input v-model="tempModel" class="col-span-2 h-8 text-xs" />
        </div>
      </div>
      <DialogFooter>
        <Button size="sm" @click="saveSettings">{{ t('grid.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
