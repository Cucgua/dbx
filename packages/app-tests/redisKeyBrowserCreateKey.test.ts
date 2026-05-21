import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("Redis key browser exposes a create key dialog for common value types", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /<Plus class="h-3 w-3" \/>/);
  assert.match(source, /v-model:open="showCreateKeyDialog"/);
  assert.match(source, /createKeyTypeOptions/);
  assert.match(source, /value: "string"/);
  assert.match(source, /value: "hash"/);
  assert.match(source, /value: "list"/);
  assert.match(source, /value: "set"/);
  assert.match(source, /value: "zset"/);
});

test("Redis command line opens in the right workspace instead of taking permanent row space", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /activeSidePanel/);
  assert.match(source, /@click="openCommandPanel"/);
  assert.match(source, /<Tabs v-model="activeSidePanel"/);
  assert.match(source, /<TabsContent value="command"/);
  assert.match(source, /t\("redis\.keyDetail"\)/);
  assert.match(source, /t\("redis\.commandLine"\)/);
  assert.match(source, /data-redis-command-input/);
  assert.doesNotMatch(source, /<Terminal class=/);
  assert.doesNotMatch(source, /absolute inset-x-0 bottom-0/);
  assert.doesNotMatch(source, /<div class="min-h-9 flex items-center gap-1 px-2 border-b bg-muted\/20 shrink-0">/);
});

test("Redis key list keeps metadata out of the browsing rows until a key is selected", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.doesNotMatch(source, /t\("redis\.columnValue"\)/);
  assert.doesNotMatch(source, /t\("redis\.columnSize"\)/);
  assert.doesNotMatch(source, /t\("redis\.columnTTL"\)/);
  assert.match(source, /:metadata="selectedKey"/);
});

test("Redis key list uses readable leaf rows with stable key icons", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /:item-size="30"/);
  assert.match(source, /:style="\{ height: '30px' \}"/);
  assert.match(source, /text-\[13px\]/);
  assert.match(source, /class="h-3\.5 w-3\.5 text-muted-foreground\/70 transition-opacity group-hover:opacity-0"/);
  assert.match(source, /class="relative flex h-4 w-4 shrink-0 items-center justify-center"/);
  assert.match(source, /group-hover:opacity-0/);
  assert.match(source, /group-hover:opacity-100/);
});

test("Redis key browser uses side-by-side panes for key list and value details", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /<Splitpanes class="redis-workspace-splitpanes h-full">/);
  assert.doesNotMatch(source, /<Splitpanes class="h-full" horizontal>/);
  assert.match(source, /<Pane :size="36" :min-size="24">/);
  assert.match(source, /<Pane :size="64" :min-size="36">/);
  assert.doesNotMatch(source, /v-if="showSidePanel"/);
});

test("Redis workspace tab bar aligns with the key browser toolbar height", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /class="h-9 shrink-0 border-b bg-background px-3 flex items-center"/);
  assert.doesNotMatch(source, /class="h-10 shrink-0 border-b bg-muted\/20 px-3 flex items-center"/);
});

test("Redis workspace tabs use compact shadcn tabs with icons and no underline", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /<TabsList class="h-7 gap-1 p-0\.5"/);
  assert.doesNotMatch(source, /<TabsList variant="line"/);
  assert.doesNotMatch(source, /data-active:after:/);
  assert.doesNotMatch(source, /data-active:text-destructive/);
  assert.match(source, /<KeyRound class="size-3\.5"/);
  assert.match(source, /<TerminalSquare class="size-3\.5"/);
  assert.doesNotMatch(source, /grid h-7 w-52 grid-cols-2 p-0\.5/);
});

test("Redis command workspace uses a terminal-like surface", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /type RedisCommandHistoryEntry/);
  assert.match(source, /commandHistory/);
  assert.match(source, /isRedisClearScreenCommand/);
  assert.match(source, /commandHistory\.value = \[\]/);
  assert.match(source, /t\("redis\.commandWelcome"\)/);
  assert.match(source, /v-for="entry in commandHistory"/);
  assert.match(source, /{{ commandPrompt }}/);
  assert.match(source, /{{ entry\.prompt }}/);
  assert.match(source, /{{ entry\.command }}/);
  assert.match(source, /class="relative flex min-h-0 flex-1 flex-col bg-\[#090c10\] font-mono text-\[13px\] leading-5 text-slate-100"/);
  assert.match(source, /class="flex shrink-0 items-center gap-2 border-t border-white\/10 bg-\[#090c10\] px-4 py-2"/);
  assert.match(source, /class="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-\[13px\] text-slate-100 caret-\[#d7ba7d\] outline-none/);
  assert.doesNotMatch(source, /class="border-b border-slate-800 bg-slate-950 px-4 py-3 text-slate-100"/);
  assert.doesNotMatch(source, /class="min-h-full whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950/);
});

test("Redis browser uses a single thin shared splitter between panes", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisKeyBrowser.vue", "utf8");

  assert.match(source, /<Splitpanes class="redis-workspace-splitpanes h-full">/);
  assert.doesNotMatch(source, /class="h-full min-w-0 border-l bg-background flex flex-col overflow-hidden"/);
  assert.match(source, /\.redis-workspace-splitpanes :deep\(\.splitpanes--vertical > \.splitpanes__splitter\)/);
  assert.match(source, /width: 1px !important;/);
});
