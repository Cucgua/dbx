<script setup lang="ts">
import { ChevronRight } from "lucide-vue-next";
import type { ExplainPlanNode } from "@/lib/explainPlan";

defineProps<{
  node: ExplainPlanNode;
  depth?: number;
}>();
</script>

<template>
  <div class="space-y-2">
    <div class="rounded border bg-background px-3 py-2 shadow-xs">
      <div class="flex min-w-0 items-center gap-2">
        <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ node.title }}</div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span class="rounded bg-muted px-1.5 py-0.5">{{ node.nodeType }}</span>
            <span
              v-if="node.relation"
              class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              >{{ node.relation }}</span
            >
            <span
              v-if="node.index"
              class="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >{{ node.index }}</span
            >
            <span v-if="node.cost">{{ node.cost }}</span>
            <span v-if="node.rows">{{ node.rows }} rows</span>
          </div>
        </div>
      </div>
      <div v-if="node.details.length" class="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
        <div v-for="detail in node.details" :key="detail" class="break-all">{{ detail }}</div>
      </div>
    </div>

    <div v-if="node.children.length" class="space-y-2 border-l pl-4">
      <ExplainPlanNodeTree v-for="child in node.children" :key="child.id" :node="child" :depth="(depth || 0) + 1" />
    </div>
  </div>
</template>
