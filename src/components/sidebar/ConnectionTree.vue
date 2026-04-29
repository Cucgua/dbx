<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useConnectionStore } from "@/stores/connectionStore";
import TreeItem from "./TreeItem.vue";

const { t } = useI18n();
const store = useConnectionStore();
</script>

<template>
  <div class="text-sm select-none">
    <TreeItem v-for="node in store.treeNodes" :key="node.id" :node="node" :depth="0" />
    <div v-if="store.treeNodes.length === 0" class="px-3 py-8 text-center text-muted-foreground text-xs">
      {{ t('sidebar.noConnections') }}
    </div>
  </div>
</template>
