import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

test("AI assistant mode menu shows an icon for ask and agent options", () => {
  const source = readFileSync("apps/desktop/src/components/editor/AiAssistant.vue", "utf8");

  assert.match(
    source,
    /<DropdownMenuItem[\s\S]*?ai\.modeHints\.ask[\s\S]*?<Check[\s\S]*?assistantMode !== 'ask'[\s\S]*?<MessageSquarePlus class="h-3 w-3 shrink-0 text-muted-foreground"[\s\S]*?ai\.modes\.ask[\s\S]*?<\/DropdownMenuItem>/,
  );
  assert.match(
    source,
    /<DropdownMenuItem[\s\S]*?ai\.modeHints\.agent[\s\S]*?<Check[\s\S]*?assistantMode !== 'agent'[\s\S]*?<Bot class="h-3 w-3 shrink-0 text-muted-foreground"[\s\S]*?ai\.modes\.agent[\s\S]*?<\/DropdownMenuItem>/,
  );
  assert.match(
    source,
    /<component :is="assistantMode === 'agent' \? Bot : MessageSquarePlus" class="h-3 w-3" \/>/,
  );
});
