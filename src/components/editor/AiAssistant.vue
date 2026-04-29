<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Bot,
  Check,
  Clipboard,
  Code2,
  Copy,
  FilePlus2,
  Loader2,
  MessageSquareText,
  Replace,
  Settings,
  Sparkles,
  Wand2,
  Wrench,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore, type AiProvider } from "@/stores/settingsStore";
import { buildAiContext, extractSql, runAiAction, type AiAction, type AiContext } from "@/lib/ai";
import type { ConnectionConfig, QueryTab } from "@/types/database";

const { t } = useI18n();
const settings = useSettingsStore();

const props = defineProps<{
  tab: QueryTab;
  connection?: ConnectionConfig;
}>();

const emit = defineEmits<{
  replaceSql: [sql: string];
  appendSql: [sql: string];
}>();

const action = ref<AiAction>("generate");
const prompt = ref("");
const isGenerating = ref(false);
const isBuildingContext = ref(false);
const showSettings = ref(false);
const showPreview = ref(false);
const error = ref("");
const output = ref("");
const copied = ref(false);
const lastContext = ref<AiContext | null>(null);

const tempProvider = ref<AiProvider>(settings.aiConfig.provider);
const tempApiKey = ref(settings.aiConfig.apiKey);
const tempEndpoint = ref(settings.aiConfig.endpoint);
const tempModel = ref(settings.aiConfig.model);

const providerDefaults: Record<AiProvider, { endpoint: string; model: string }> = {
  claude: { endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" },
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" },
  custom: { endpoint: "", model: "" },
};

const actionItems: Array<{ value: AiAction; labelKey: string; icon: any }> = [
  { value: "generate", labelKey: "ai.actions.generate", icon: Sparkles },
  { value: "explain", labelKey: "ai.actions.explain", icon: MessageSquareText },
  { value: "optimize", labelKey: "ai.actions.optimize", icon: Wand2 },
  { value: "fix", labelKey: "ai.actions.fix", icon: Wrench },
  { value: "convert", labelKey: "ai.actions.convert", icon: Replace },
  { value: "sampleData", labelKey: "ai.actions.sampleData", icon: FilePlus2 },
];

const selectedAction = computed(() => actionItems.find((item) => item.value === action.value) ?? actionItems[0]);
const sqlCandidate = computed(() => extractSql(output.value));
const canUseSql = computed(() => !!sqlCandidate.value.trim());
const contextSummary = computed(() => {
  if (!lastContext.value) return "";
  const tableCount = lastContext.value.tables.length;
  return t("ai.contextSummary", {
    database: lastContext.value.database,
    tables: tableCount,
  });
});

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

function selectProvider(provider: AiProvider) {
  tempProvider.value = provider;
  tempEndpoint.value = providerDefaults[provider].endpoint;
  tempModel.value = providerDefaults[provider].model;
}

async function generate() {
  if (!props.connection) {
    error.value = t("ai.noConnection");
    return;
  }
  if (!settings.isConfigured()) {
    openSettings();
    return;
  }
  if (action.value === "generate" && !prompt.value.trim()) return;
  if (action.value !== "generate" && !props.tab.sql.trim() && !prompt.value.trim()) {
    error.value = t("ai.noSql");
    return;
  }

  isGenerating.value = true;
  isBuildingContext.value = true;
  error.value = "";
  copied.value = false;
  try {
    const context = await buildAiContext(props.tab, props.connection);
    lastContext.value = context;
    isBuildingContext.value = false;
    output.value = await runAiAction({
      config: settings.aiConfig,
      action: action.value,
      instruction: prompt.value,
      context,
    });
    showPreview.value = true;
  } catch (e: any) {
    error.value = String(e.message || e);
  } finally {
    isBuildingContext.value = false;
    isGenerating.value = false;
  }
}

function replaceSql() {
  if (!canUseSql.value) return;
  emit("replaceSql", sqlCandidate.value);
  showPreview.value = false;
}

function appendSql() {
  if (!canUseSql.value) return;
  emit("appendSql", sqlCandidate.value);
  showPreview.value = false;
}

async function copySql() {
  if (!canUseSql.value) return;
  await navigator.clipboard.writeText(sqlCandidate.value);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1200);
}

async function copyAll() {
  if (!output.value.trim()) return;
  await navigator.clipboard.writeText(output.value.trim());
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1200);
}
</script>

<template>
  <div class="shrink-0 border-b bg-muted/20 px-2 py-1.5">
    <div class="flex items-center gap-1.5">
      <Bot class="h-3.5 w-3.5 shrink-0 text-primary" />
      <Select :model-value="action" @update:model-value="(v: any) => action = v">
        <SelectTrigger class="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="item in actionItems" :key="item.value" :value="item.value">
            {{ t(item.labelKey) }}
          </SelectItem>
        </SelectContent>
      </Select>

      <Input
        v-model="prompt"
        class="h-7 flex-1 border-0 bg-background/70 text-xs shadow-none focus-visible:ring-1"
        :placeholder="t(`ai.placeholders.${action}`)"
        @keydown.enter="generate"
      />

      <Button
        variant="default"
        size="xs"
        class="shrink-0"
        :disabled="isGenerating"
        @click="generate"
      >
        <Loader2 v-if="isGenerating" class="h-3 w-3 animate-spin" />
        <component :is="selectedAction.icon" v-else class="h-3 w-3" />
        <span>{{ isBuildingContext ? t('ai.readingSchema') : t('ai.run') }}</span>
      </Button>

      <Button variant="ghost" size="icon-xs" class="shrink-0" @click="openSettings">
        <Settings class="h-3 w-3" />
      </Button>
    </div>

    <div v-if="error || contextSummary" class="mt-1 flex items-center gap-2 text-xs">
      <span v-if="error" class="truncate text-destructive">{{ error }}</span>
      <span v-else-if="contextSummary" class="truncate text-muted-foreground">{{ contextSummary }}</span>
      <Badge v-if="lastContext?.truncated" variant="outline" class="h-4 px-1.5 text-[10px]">
        {{ t('ai.truncated') }}
      </Badge>
    </div>
  </div>

  <Dialog v-model:open="showPreview">
    <DialogContent class="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Code2 class="h-4 w-4" />
          {{ t(selectedAction.labelKey) }}
        </DialogTitle>
      </DialogHeader>

      <div class="grid gap-3">
        <div v-if="contextSummary" class="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{{ contextSummary }}</span>
          <Badge v-if="lastContext?.truncated" variant="outline">{{ t('ai.truncated') }}</Badge>
        </div>

        <ScrollArea class="h-72 rounded-lg border bg-background">
          <pre class="whitespace-pre-wrap p-3 text-xs leading-relaxed"><code>{{ output }}</code></pre>
        </ScrollArea>

        <div v-if="canUseSql" class="rounded-lg border bg-muted/20">
          <div class="flex items-center justify-between border-b px-3 py-2">
            <span class="text-xs font-medium">{{ t('ai.sqlPreview') }}</span>
            <Button variant="ghost" size="xs" @click="copySql">
              <Check v-if="copied" class="h-3 w-3" />
              <Copy v-else class="h-3 w-3" />
              {{ copied ? t('ai.copied') : t('ai.copySql') }}
            </Button>
          </div>
          <ScrollArea class="max-h-48">
            <pre class="whitespace-pre-wrap p-3 text-xs leading-relaxed"><code>{{ sqlCandidate }}</code></pre>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" size="sm" @click="copyAll">
          <Clipboard class="h-3.5 w-3.5" />
          {{ t('ai.copyAll') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!canUseSql" @click="appendSql">
          <FilePlus2 class="h-3.5 w-3.5" />
          {{ t('ai.append') }}
        </Button>
        <Button size="sm" :disabled="!canUseSql" @click="replaceSql">
          <Replace class="h-3.5 w-3.5" />
          {{ t('ai.replace') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="showSettings">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ t('ai.settings') }}</DialogTitle>
      </DialogHeader>
      <div class="grid gap-3 py-2">
        <div class="grid grid-cols-3 items-center gap-3">
          <Label class="text-right text-xs">{{ t('ai.provider') }}</Label>
          <Select :model-value="tempProvider" @update:model-value="(v: any) => selectProvider(v)">
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
        <p class="text-xs leading-relaxed text-muted-foreground">
          {{ t('ai.settingsHint') }}
        </p>
      </div>
      <DialogFooter>
        <Button size="sm" @click="saveSettings">{{ t('grid.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
