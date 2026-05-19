import assert from "node:assert/strict";
import test from "node:test";
import { createAiMessageRenderer } from "../../apps/desktop/src/lib/aiMessageRender.ts";

test("reuses rendered AI message segments for unchanged content", () => {
  let markdownCalls = 0;
  const renderer = createAiMessageRenderer({
    markdown: (text) => {
      markdownCalls++;
      return `<p>${text}</p>`;
    },
  });

  const first = renderer.render("hello **dbx**\n```sql\nSELECT 1\n```");
  const second = renderer.render("hello **dbx**\n```sql\nSELECT 1\n```");

  assert.equal(markdownCalls, 1);
  assert.strictEqual(second, first);
  assert.deepEqual(second, [
    { type: "text", content: "hello **dbx**", html: "<p>hello **dbx**</p>" },
    { type: "code", content: "SELECT 1", lang: "SQL" },
  ]);
});

test("evicts older rendered AI message cache entries", () => {
  let markdownCalls = 0;
  const renderer = createAiMessageRenderer({
    maxEntries: 2,
    markdown: (text) => {
      markdownCalls++;
      return text;
    },
  });

  renderer.render("one");
  renderer.render("two");
  renderer.render("one");
  renderer.render("three");
  renderer.render("two");

  assert.equal(markdownCalls, 4);
});
