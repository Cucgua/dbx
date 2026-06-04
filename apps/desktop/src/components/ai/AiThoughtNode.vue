<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  ShieldCheck,
  Square,
  Wand2,
  Wrench,
} from "@lucide/vue";
import type { AiThoughtNodeState, AiWorkflowNodeKind, AiWorkflowNodeStatus } from "@/lib/aiWorkflowEvents";

const props = withDefaults(
  defineProps<{
    node: AiThoughtNodeState;
    depth?: number;
  }>(),
  {
    depth: 0,
  },
);

const { t } = useI18n();
const expanded = ref(props.node.defaultExpanded);
const manuallyToggled = ref(false);
const argumentsExpanded = ref(false);

const kindIcon = computed(() => iconForKind(props.node.kind));
const statusLabel = computed(() => t(statusLabelKey(props.node.status)));
const statusTone = computed(() => statusClass(props.node.status));
const nodeSummary = computed(() => props.node.summary || props.node.description || props.node.content.trim());
const contentExpanded = ref(false);
const compactContent = computed(() => compactThoughtContent(props.node.content, contentExpanded.value));
const showArgumentsToggle = computed(() => (props.node.toolArguments || "").length > 240);
const visibleToolArguments = computed(() => {
  const value = props.node.toolArguments || "";
  if (!showArgumentsToggle.value || argumentsExpanded.value) return value;
  return `${value.slice(0, 240)}...`;
});
const hasBody = computed(
  () =>
    !!props.node.description ||
    !!props.node.content ||
    !!props.node.toolArguments ||
    !!props.node.summary ||
    !!props.node.children.length,
);
const shouldShowInlineSummary = computed(() => !expanded.value && !!nodeSummary.value);

watch(
  () => props.node.defaultExpanded,
  (value) => {
    if (manuallyToggled.value) return;
    expanded.value = value;
  },
);

function iconForKind(kind: AiWorkflowNodeKind) {
  if (kind === "model") return Bot;
  if (kind === "agent") return Wand2;
  if (kind === "tool") return Wrench;
  if (kind === "user") return MessageSquarePlus;
  if (kind === "evidence") return ShieldCheck;
  return Check;
}

function statusLabelKey(status: AiWorkflowNodeStatus): string {
  if (status === "loading") return "ai.thoughtNodeLoading";
  if (status === "success") return "ai.thoughtNodeSuccess";
  if (status === "error") return "ai.thoughtNodeError";
  if (status === "waiting") return "ai.thoughtNodeWaiting";
  return "ai.thoughtNodeAbort";
}

function statusClass(status: AiWorkflowNodeStatus): string {
  if (status === "loading") return "border-blue-400 bg-blue-500/10 text-blue-500";
  if (status === "success") return "border-emerald-400 bg-emerald-500/10 text-emerald-500";
  if (status === "error") return "border-amber-400 bg-amber-500/10 text-amber-500";
  if (status === "waiting") return "border-blue-400 bg-blue-500/10 text-blue-500";
  return "border-muted-foreground/40 bg-muted text-muted-foreground";
}

function toggleExpanded() {
  if (!hasBody.value) return;
  manuallyToggled.value = true;
  expanded.value = !expanded.value;
}

function compactThoughtContent(content: string, showAll: boolean): { text: string; truncated: boolean } {
  const value = content.trim();
  if (!value) return { text: "", truncated: false };
  const maxLines = 5;
  const maxChars = 800;
  const lines = value.split(/\r?\n/);
  if (showAll || (lines.length <= maxLines && value.length <= maxChars)) {
    return { text: value, truncated: false };
  }
  const recentLines = lines.slice(-maxLines).join("\n");
  const text = recentLines.length > maxChars ? recentLines.slice(-maxChars) : recentLines;
  return { text, truncated: true };
}
</script>

<template>
  <div class="relative pl-5 text-muted-foreground">
    <div class="absolute left-[7px] top-6 bottom-0 w-px bg-border/70" :class="{ hidden: !node.children.length }" />
    <div
      class="absolute left-0 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-background"
      :class="statusTone"
    >
      <Loader2 v-if="node.status === 'loading'" class="h-2.5 w-2.5 animate-spin" />
      <Check v-else-if="node.status === 'success'" class="h-2.5 w-2.5" />
      <AlertTriangle v-else-if="node.status === 'error'" class="h-2.5 w-2.5" />
      <Square v-else-if="node.status === 'abort'" class="h-2 w-2" />
      <component :is="kindIcon" v-else class="h-2.5 w-2.5" />
    </div>

    <button
      class="flex w-full min-w-0 items-start gap-1.5 text-left text-[11px] leading-5 transition-colors hover:text-foreground"
      :disabled="!hasBody"
      @click="toggleExpanded"
    >
      <ChevronRight
        class="mt-1 h-3 w-3 shrink-0 transition-transform duration-200"
        :class="{ 'rotate-90': expanded, 'opacity-0': !hasBody }"
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate font-medium text-foreground/80">{{ node.title }}</span>
          <span class="shrink-0 rounded bg-muted px-1 text-[10px] leading-4 opacity-80">{{ statusLabel }}</span>
        </div>
        <div v-if="shouldShowInlineSummary" class="truncate text-[10px] leading-4 opacity-70">
          {{ nodeSummary }}
        </div>
      </div>
    </button>

    <div
      class="overflow-hidden transition-all duration-200 ease-in-out"
      :style="{ maxHeight: expanded ? '16000px' : '0px', opacity: expanded ? '1' : '0' }"
    >
      <div v-if="node.description" class="mt-1 whitespace-pre-wrap pl-4 text-[10px] leading-4 opacity-80">
        {{ node.description }}
      </div>
      <div v-if="node.content" class="mt-1 pl-4 text-[11px] leading-5 text-muted-foreground">
        <div v-if="compactContent.truncated" class="mb-1 text-[10px] text-muted-foreground/70">
          {{ t("ai.thoughtEarlierHidden") }}
        </div>
        <div class="whitespace-pre-wrap">{{ compactContent.text }}</div>
        <button
          v-if="compactContent.truncated || contentExpanded"
          class="mt-1 text-[10px] text-primary hover:underline"
          @click.stop="contentExpanded = !contentExpanded"
        >
          {{ contentExpanded ? t("ai.thoughtShowRecent") : t("ai.thoughtShowAll") }}
        </button>
      </div>
      <div v-if="node.toolArguments" class="mt-1 pl-4">
        <div class="text-[10px] font-medium text-foreground/65">{{ t("ai.thoughtToolArguments") }}</div>
        <div class="break-words font-mono text-[10px] opacity-80">{{ visibleToolArguments }}</div>
        <button
          v-if="showArgumentsToggle"
          class="mt-1 text-[10px] text-primary hover:underline"
          @click.stop="argumentsExpanded = !argumentsExpanded"
        >
          {{ argumentsExpanded ? t("ai.thoughtCollapse") : t("ai.thoughtExpand") }}
        </button>
      </div>
      <div v-if="node.summary" class="mt-1 whitespace-pre-wrap pl-4 text-[10px] opacity-90">
        <span class="font-medium text-foreground/65">{{ t("ai.thoughtToolSummary") }}：</span>{{ node.summary }}
      </div>
      <div v-if="node.children.length" class="mt-2 space-y-1">
        <AiThoughtNode v-for="child in node.children" :key="child.id" :node="child" :depth="depth + 1" />
      </div>
    </div>
  </div>
</template>
