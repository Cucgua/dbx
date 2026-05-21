import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("Redis value viewer uses a clearer two-line side panel header", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisValueViewer.vue", "utf8");

  assert.match(source, /class="flex h-9 items-center gap-2 px-4"/);
  assert.match(source, /class="flex min-h-7 flex-wrap items-center gap-2 px-4 pb-1"/);
  assert.doesNotMatch(source, /class="h-9 flex items-center gap-2 px-4 border-b bg-muted\/30 shrink-0"/);
});

test("Redis collection headers avoid unclear raw loaded over total suffixes", () => {
  const source = readFileSync("apps/desktop/src/components/redis/RedisValueViewer.vue", "utf8");

  assert.match(source, /function collectionCountLabel/);
  assert.doesNotMatch(source, /` \/ \$\{data\.total\}`/);
  assert.match(source, /collectionCountLabel\("items", collectionItems\.length, data\.total\)/);
  assert.match(source, /collectionCountLabel\("fields", collectionItems\.length, data\.total\)/);
  assert.match(source, /collectionCountLabel\("members", collectionItems\.length, data\.total\)/);
});
