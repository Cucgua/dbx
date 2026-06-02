<script setup lang="ts">
import { useI18n } from "vue-i18n";
import AiThoughtNode from "@/components/ai/AiThoughtNode.vue";
import type { AiThoughtNodeState } from "@/lib/aiWorkflowEvents";

defineProps<{
  nodes: AiThoughtNodeState[];
  compact?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="nodes.length" class="space-y-2 py-1" :class="{ 'text-[11px]': compact }">
    <div class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-normal text-muted-foreground/80">
      <span>{{ t("ai.thoughtChain") }}</span>
    </div>
    <div class="space-y-1.5">
      <AiThoughtNode v-for="node in nodes" :key="node.id" :node="node" />
    </div>
  </div>
</template>
