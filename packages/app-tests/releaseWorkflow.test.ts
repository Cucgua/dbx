import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

test("fork release workflow builds Windows artifacts and augments latest metadata", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /build-windows:/);
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /args: --target x86_64-pc-windows-msvc/);
  assert.match(workflow, /Upload Windows portable ZIP/);
  assert.match(workflow, /Add JDBC plugin metadata to latest\.json/);
});
