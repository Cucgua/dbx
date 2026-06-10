<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { AlertTriangle, CheckCircle2, Copy, Loader2, PackageSearch, RefreshCw, Server } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyToClipboard } from "@/lib/clipboard";
import { checkMcpServerStatus, loadMcpHttpConfig, loadMcpHttpStatus, saveMcpHttpConfig, type McpHttpConfig, type McpHttpStatus, type McpServerStatus } from "@/lib/api";

const mcpStatus = ref<McpServerStatus | null>(null);
const mcpHttpStatus = ref<McpHttpStatus | null>(null);
const mcpHttpConfig = ref<McpHttpConfig>({ enabled: true, host: "127.0.0.1", port: 7424, token: "" });
const loading = ref(false);
const savingConfig = ref(false);
const statusError = ref("");
const configMessage = ref("");
const configError = ref(false);
type CopyKind = "" | "install" | "claude-config" | "codex-config" | "http-endpoint" | "http-token";
const copied = ref<CopyKind>("");
const configTab = ref<"claude" | "codex">("claude");
const readonlyMode = ref(false);
const allowDangerous = ref(false);

const emit = defineEmits<{
  refreshState: [state: { loading: boolean; refresh: () => Promise<void> }];
}>();

const envEntries = computed(() => {
  const entries: Array<[string, string]> = [];
  if (readonlyMode.value) entries.push(["DBX_MCP_ALLOW_WRITES", "0"]);
  if (!readonlyMode.value && allowDangerous.value) entries.push(["DBX_MCP_ALLOW_DANGEROUS_SQL", "1"]);
  return entries;
});

const claudeRecommendedConfig = computed(() => {
  const config: Record<string, unknown> = {
    mcpServers: {
      dbx: {
        command: "dbx-mcp-server",
      } as Record<string, unknown>,
    },
  };
  if (envEntries.value.length > 0) {
    const env = Object.fromEntries(envEntries.value);
    ((config.mcpServers as Record<string, any>).dbx as Record<string, unknown>).env = env;
  }
  return JSON.stringify(config, null, 2);
});

const codexRecommendedConfig = computed(() => {
  const lines = ["[mcp_servers.dbx]", 'command = "dbx-mcp-server"'];
  if (envEntries.value.length > 0) {
    lines.push("");
    lines.push("[mcp_servers.dbx.env]");
    for (const [key, value] of envEntries.value) lines.push(`${key} = "${value}"`);
  }
  return lines.join("\n");
});

const statusTone = computed<"ok" | "warning" | "muted">(() => {
  if (!mcpStatus.value) return "muted";
  if (!mcpStatus.value.installed || mcpStatus.value.update_available || mcpStatus.value.error) return "warning";
  return "ok";
});

const statusLabel = computed(() => {
  if (loading.value) return "Checking";
  if (statusError.value) return "Check failed";
  if (!mcpStatus.value) return "Not checked";
  if (!mcpStatus.value.installed) return "Not installed";
  if (mcpStatus.value.update_available) return "Update available";
  return "Ready";
});

const httpStatusLabel = computed(() => {
  if (loading.value) return "Checking";
  if (!mcpHttpStatus.value) return "No runtime status";
  return mcpHttpStatus.value.enabled ? "Listening" : "Disabled";
});

const configuredEndpoint = computed(() => `http://${mcpHttpConfig.value.host || "127.0.0.1"}:${mcpHttpConfig.value.port || 7424}/mcp`);

const mcpCommand = computed(() => {
  if (!mcpStatus.value) return "npm install -g @dbx-app/mcp-server@latest --registry=https://registry.npmjs.org";
  return mcpStatus.value.installed ? mcpStatus.value.update_command : mcpStatus.value.install_command;
});

watch(readonlyMode, (value) => {
  if (value) allowDangerous.value = false;
});

watch(
  loading,
  () => {
    emit("refreshState", { loading: loading.value, refresh });
  },
  { immediate: true },
);

onMounted(() => {
  void refresh();
});

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  statusError.value = "";
  try {
    const [serverStatus, httpStatus] = await Promise.all([
      checkMcpServerStatus().catch((err) => {
        statusError.value = err?.message || String(err);
        return null;
      }),
      loadMcpHttpStatus().catch(() => null),
    ]);
    mcpStatus.value = serverStatus;
    mcpHttpStatus.value = httpStatus;
    mcpHttpConfig.value = await loadMcpHttpConfig();
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  configMessage.value = "";
  configError.value = false;
  savingConfig.value = true;
  try {
    mcpHttpConfig.value = await saveMcpHttpConfig(mcpHttpConfig.value);
    configMessage.value = "MCP HTTP config saved. Restart the desktop app for listener changes to take effect.";
  } catch (err: any) {
    configError.value = true;
    configMessage.value = err?.message || String(err);
  } finally {
    savingConfig.value = false;
  }
}

async function copyText(kind: CopyKind, value: string) {
  copied.value = kind;
  try {
    await copyToClipboard(value);
  } catch {
    copied.value = "";
    return;
  }
  window.setTimeout(() => {
    if (copied.value === kind) copied.value = "";
  }, 1500);
}
</script>

<template>
  <div class="flex flex-col gap-5 py-2">
    <div class="rounded-md border bg-muted/20 p-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 space-y-2">
          <div class="flex items-center gap-2">
            <Server class="h-4 w-4 text-muted-foreground" />
            <Label class="text-base">Desktop HTTP MCP</Label>
          </div>
          <p class="text-xs text-muted-foreground">Streamable HTTP MCP endpoint exposed by the desktop app.</p>
        </div>
        <Badge variant="outline" class="shrink-0 rounded-md">
          <Loader2 v-if="loading" class="mr-1 h-3 w-3 animate-spin" />
          {{ httpStatusLabel }}
        </Badge>
      </div>
    </div>

    <div class="space-y-3 rounded-md border bg-muted/20 p-4">
      <div class="flex items-center justify-between gap-4">
        <div class="space-y-1">
          <Label for="mcp-http-enabled">Desktop HTTP listener</Label>
          <p class="text-xs text-muted-foreground">Configuration is stored in the MCP HTTP extension config file.</p>
        </div>
        <Switch id="mcp-http-enabled" v-model="mcpHttpConfig.enabled" />
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="mcp-http-host" class="text-xs">Host</Label>
          <Input id="mcp-http-host" v-model="mcpHttpConfig.host" class="h-8 text-xs" placeholder="127.0.0.1" />
        </div>
        <div class="space-y-1.5">
          <Label for="mcp-http-port" class="text-xs">Port</Label>
          <Input id="mcp-http-port" v-model.number="mcpHttpConfig.port" type="number" min="1" class="h-8 text-xs" />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label for="mcp-http-token" class="text-xs">Bearer token</Label>
        <Input id="mcp-http-token" v-model="mcpHttpConfig.token" type="password" class="h-8 text-xs" autocomplete="off" />
      </div>

      <div class="flex items-center gap-3">
        <Button type="button" size="sm" :disabled="savingConfig || loading" @click="saveConfig">
          <Loader2 v-if="savingConfig" class="mr-1 h-3 w-3 animate-spin" />
          Save HTTP config
        </Button>
        <span v-if="configMessage" class="truncate text-xs" :class="configError ? 'text-destructive' : 'text-green-500'">
          {{ configMessage }}
        </span>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-md border p-3">
        <div class="text-xs font-medium uppercase text-muted-foreground">Endpoint</div>
        <div class="mt-2 flex items-center gap-2">
          <div class="min-w-0 flex-1 truncate font-mono text-sm">
            {{ mcpHttpStatus?.endpoint || configuredEndpoint }}
          </div>
          <Button type="button" variant="outline" size="icon" class="h-7 w-7" @click="copyText('http-endpoint', mcpHttpStatus?.endpoint || configuredEndpoint)">
            <CheckCircle2 v-if="copied === 'http-endpoint'" class="h-3.5 w-3.5 text-green-500" />
            <Copy v-else class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div class="rounded-md border p-3">
        <div class="text-xs font-medium uppercase text-muted-foreground">Bearer token</div>
        <div class="mt-2 flex items-center gap-2">
          <div class="min-w-0 flex-1 truncate font-mono text-sm">
            {{ mcpHttpStatus?.token ? "********" : "Not available until server starts" }}
          </div>
          <Button type="button" variant="outline" size="icon" class="h-7 w-7" :disabled="!mcpHttpStatus?.token" @click="copyText('http-token', mcpHttpStatus?.token || '')">
            <CheckCircle2 v-if="copied === 'http-token'" class="h-3.5 w-3.5 text-green-500" />
            <Copy v-else class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <div class="rounded-md border bg-muted/20 p-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 space-y-2">
          <div class="flex items-center gap-2">
            <PackageSearch class="h-4 w-4 text-muted-foreground" />
            <Label class="text-base">DBX MCP Server package</Label>
          </div>
          <p class="text-xs text-muted-foreground">Global npm package status for Claude Code, Codex, and other agents.</p>
        </div>
        <Badge variant="outline" class="shrink-0 rounded-md" :class="statusTone === 'ok' ? 'border-green-500/40 text-green-600 dark:text-green-400' : statusTone === 'warning' ? 'border-amber-500/40 text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">
          <Loader2 v-if="loading" class="mr-1 h-3 w-3 animate-spin" />
          <CheckCircle2 v-else-if="statusTone === 'ok'" class="mr-1 h-3 w-3" />
          <AlertTriangle v-else-if="statusTone === 'warning'" class="mr-1 h-3 w-3" />
          {{ statusLabel }}
        </Badge>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-md border p-3">
        <div class="text-xs font-medium uppercase text-muted-foreground">Current version</div>
        <div class="mt-2 font-mono text-sm">
          {{ mcpStatus?.current_version ? `v${mcpStatus.current_version}` : "No global install detected" }}
        </div>
      </div>
      <div class="rounded-md border p-3">
        <div class="text-xs font-medium uppercase text-muted-foreground">Latest version</div>
        <div class="mt-2 font-mono text-sm">
          {{ mcpStatus?.latest_version ? `v${mcpStatus.latest_version}` : "Unknown" }}
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <Label>{{ mcpStatus?.installed ? "Upgrade command" : "Install command" }}</Label>
      <div class="flex min-w-0 items-center gap-2">
        <div class="min-w-0 flex-1 overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs whitespace-nowrap">
          {{ mcpCommand }}
        </div>
        <Button type="button" variant="outline" size="icon" @click="copyText('install', mcpCommand)">
          <CheckCircle2 v-if="copied === 'install'" class="h-4 w-4 text-green-500" />
          <Copy v-else class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2">
      <div class="space-y-1">
        <Label for="mcp-readonly-mode">Read-only mode</Label>
        <p class="text-xs text-muted-foreground">Adds DBX_MCP_ALLOW_WRITES=0 to the sample config.</p>
      </div>
      <Switch id="mcp-readonly-mode" v-model="readonlyMode" />
    </div>

    <div class="flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2">
      <div class="space-y-1">
        <Label for="mcp-allow-dangerous">Allow dangerous SQL</Label>
        <p class="text-xs text-muted-foreground">Adds DBX_MCP_ALLOW_DANGEROUS_SQL=1 to the sample config.</p>
      </div>
      <Switch id="mcp-allow-dangerous" v-model="allowDangerous" :disabled="readonlyMode" />
    </div>

    <div class="space-y-2">
      <Label>MCP config</Label>
      <Tabs v-model="configTab" class="space-y-3">
        <TabsList>
          <TabsTrigger value="claude">Claude Code</TabsTrigger>
          <TabsTrigger value="codex">Codex</TabsTrigger>
        </TabsList>
        <TabsContent value="claude" class="m-0">
          <div class="relative rounded-md border bg-background p-3">
            <pre class="overflow-x-auto whitespace-pre text-xs leading-relaxed"><code>{{ claudeRecommendedConfig }}</code></pre>
            <Button type="button" variant="outline" size="icon" class="absolute right-2 top-2 h-7 w-7" @click="copyText('claude-config', claudeRecommendedConfig)">
              <CheckCircle2 v-if="copied === 'claude-config'" class="h-3.5 w-3.5 text-green-500" />
              <Copy v-else class="h-3.5 w-3.5" />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="codex" class="m-0">
          <div class="relative rounded-md border bg-background p-3">
            <pre class="overflow-x-auto whitespace-pre text-xs leading-relaxed"><code>{{ codexRecommendedConfig }}</code></pre>
            <Button type="button" variant="outline" size="icon" class="absolute right-2 top-2 h-7 w-7" @click="copyText('codex-config', codexRecommendedConfig)">
              <CheckCircle2 v-if="copied === 'codex-config'" class="h-3.5 w-3.5 text-green-500" />
              <Copy v-else class="h-3.5 w-3.5" />
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>

    <div v-if="mcpStatus?.error || statusError" class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      {{ statusError || mcpStatus?.error }}
    </div>

    <div class="flex justify-end">
      <Button type="button" variant="outline" :disabled="loading" @click="refresh">
        <Loader2 v-if="loading" class="mr-1 h-3 w-3 animate-spin" />
        <RefreshCw v-else class="mr-1 h-3 w-3" />
        Check again
      </Button>
    </div>
  </div>
</template>
