import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

test("release Linux runners install xdg-utils for AppImage bundling", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /sudo apt-get install -y [^\n]*\bxdg-utils\b/);
});
