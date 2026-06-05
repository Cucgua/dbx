<script setup lang="ts">
import AiThoughtNode from "@/components/ai/AiThoughtNode.vue";
import type { AiThoughtNodeState } from "@/lib/aiWorkflowEvents";

defineProps<{
  nodes: AiThoughtNodeState[];
  compact?: boolean;
}>();
</script>

<template>
  <div v-if="nodes.length" class="space-y-2 py-1" :class="{ 'text-[11px]': compact }">
    <div class="space-y-1.5">
      <AiThoughtNode v-for="node in nodes" :key="node.id" :node="node" />
    </div>
  </div>
</template>
