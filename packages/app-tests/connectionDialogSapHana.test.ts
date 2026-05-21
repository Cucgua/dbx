import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../apps/desktop/src/components/connection/ConnectionDialog.vue", import.meta.url),
  "utf8",
);

test("SAP HANA connection form exposes URL params for tenant routing", () => {
  assert.match(source, /form\.db_type === 'saphana'/);
  assert.match(source, /databaseName=TENANT_DB/);
  assert.match(
    source,
    /form\.db_type === 'mysql' \|\|[\s\S]*form\.db_type === 'goldendb'[\s\S]*form\.db_type === 'saphana'/,
  );
});
