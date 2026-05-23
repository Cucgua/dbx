import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("apps/desktop/src/components/connection/ConnectionDialog.vue", "utf8");

test("connection dialog auto-resolves host from URL before test/save", () => {
  assert.match(source, /function ensureConnectionHostResolvedFromUrl\(\): boolean/);
  assert.match(source, /if \(!ensureConnectionHostResolvedFromUrl\(\)\) return;/);
  assert.match(source, /return applyConnectionUrlToForm\(url\);/);
});

test("save button allows URL-only submissions when host is empty", () => {
  assert.match(source, /&&\s*!connectionUrlInput\.trim\(\)\)/);
});
