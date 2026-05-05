<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AlertCircle, Braces, GitBranch, Table2 } from "lucide-vue-next";
import type { ParsedExplainPlan, ExplainPlanNode } from "@/lib/explainPlan";
import { flattenExplainPlanNodes } from "@/lib/explainPlan";
import { Button } from "@/components/ui/button";
import ExplainPlanNodeTree from "./ExplainPlanNodeTree.vue";

const props = defineProps<{
  plan?: ParsedExplainPlan;
  error?: string;
  loading?: boolean;
  sourceSql?: string;
  explainSql?: string;
}>();

const { t } = useI18n();
const activeView = ref<"tree" | "summary" | "json">("tree");

const flatRows = computed(() => {
  const rows: Array<{ node: ExplainPlanNode; depth: number }> = [];
  function visit(node: ExplainPlanNode, depth: number) {
    rows.push({ node, depth });
    node.children.forEach((child) => visit(child, depth + 1));
  }
  props.plan?.nodes.forEach((node) => visit(node, 0));
  return rows;
});

const rawJson = computed(() => (props.plan ? JSON.stringify(props.plan.raw, null, 2) : ""));
const nodeCount = computed(() => (props.plan ? flattenExplainPlanNodes(props.plan.nodes).length : 0));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <div class="h-9 shrink-0 border-b px-3 flex items-center gap-2 text-xs">
      <span class="inline-flex items-center gap-1 rounded border bg-muted px-2 py-0.5 font-medium">
        <GitBranch class="h-3.5 w-3.5" />
        {{ t("explain.title") }}
      </span>
      <span v-if="plan" class="text-muted-foreground"
        >{{ plan.databaseType.toUpperCase() }} · {{ t("explain.nodeCount", { count: nodeCount }) }}</span
      >
      <span class="flex-1" />
      <div v-if="plan" class="inline-flex rounded-md border bg-muted/40 p-0.5">
        <Button
          size="sm"
          :variant="activeView === 'tree' ? 'secondary' : 'ghost'"
          class="h-6 px-2 text-xs gap-1"
          @click="activeView = 'tree'"
        >
          <GitBranch class="h-3.5 w-3.5" />
          {{ t("explain.tree") }}
        </Button>
        <Button
          size="sm"
          :variant="activeView === 'summary' ? 'secondary' : 'ghost'"
          class="h-6 px-2 text-xs gap-1"
          @click="activeView = 'summary'"
        >
          <Table2 class="h-3.5 w-3.5" />
          {{ t("explain.summary") }}
        </Button>
        <Button
          size="sm"
          :variant="activeView === 'json' ? 'secondary' : 'ghost'"
          class="h-6 px-2 text-xs gap-1"
          @click="activeView = 'json'"
        >
          <Braces class="h-3.5 w-3.5" />
          JSON
        </Button>
      </div>
    </div>

    <div v-if="loading" class="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
      {{ t("explain.running") }}
    </div>

    <div v-else-if="error" class="flex-1 min-h-0 flex items-center justify-center">
      <div
        class="flex max-w-xl items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
        <span>{{ error }}</span>
      </div>
    </div>

    <div v-else-if="!plan" class="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
      {{ t("explain.empty") }}
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <div v-if="activeView === 'tree'" class="mx-auto max-w-5xl space-y-3 p-4">
        <ExplainPlanNodeTree v-for="node in plan.nodes" :key="node.id" :node="node" />
      </div>

      <div v-else-if="activeView === 'summary'" class="p-3">
        <div class="overflow-auto rounded border">
          <table class="w-full min-w-[760px] text-left text-xs">
            <thead class="bg-muted/70 text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.node") }}</th>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.relation") }}</th>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.index") }}</th>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.cost") }}</th>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.rows") }}</th>
                <th class="px-2 py-1.5 font-medium">{{ t("explain.details") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in flatRows" :key="row.node.id" class="border-t">
                <td class="px-2 py-1.5 font-medium" :style="{ paddingLeft: `${8 + row.depth * 18}px` }">
                  {{ row.node.title }}
                </td>
                <td class="px-2 py-1.5 text-muted-foreground">{{ row.node.relation || "-" }}</td>
                <td class="px-2 py-1.5 text-muted-foreground">{{ row.node.index || "-" }}</td>
                <td class="px-2 py-1.5 tabular-nums">{{ row.node.cost || "-" }}</td>
                <td class="px-2 py-1.5 tabular-nums">{{ row.node.rows || "-" }}</td>
                <td class="px-2 py-1.5 text-muted-foreground">
                  {{ row.node.details.join("; ") || "-" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <pre v-else class="m-3 overflow-auto rounded border bg-muted/30 p-3 text-xs leading-relaxed">{{ rawJson }}</pre>
    </div>
  </div>
</template>
