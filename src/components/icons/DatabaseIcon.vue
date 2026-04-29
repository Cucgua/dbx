<script setup lang="ts">
import { computed } from "vue";
import { siMysql, siPostgresql, siSqlite, siRedis, siMongodb, siClickhouse, siDuckdb } from "simple-icons";
import { Database } from "lucide-vue-next";

const props = defineProps<{
  dbType: string;
}>();

const icons: Record<string, { path: string; color: string }> = {
  mysql: { path: siMysql.path, color: `#${siMysql.hex}` },
  postgres: { path: siPostgresql.path, color: `#${siPostgresql.hex}` },
  sqlite: { path: siSqlite.path, color: `#${siSqlite.hex}` },
  redis: { path: siRedis.path, color: `#${siRedis.hex}` },
  mongodb: { path: siMongodb.path, color: `#${siMongodb.hex}` },
  clickhouse: { path: siClickhouse.path, color: `#${siClickhouse.hex}` },
  duckdb: { path: siDuckdb.path, color: `#${siDuckdb.hex}` },
};

const iconData = computed(() => icons[props.dbType]);
const hasBrandIcon = computed(() => !!iconData.value);
</script>

<template>
  <svg v-if="hasBrandIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" :fill="iconData.color">
    <path :d="iconData.path" />
  </svg>
  <Database v-else class="text-blue-400" />
</template>
