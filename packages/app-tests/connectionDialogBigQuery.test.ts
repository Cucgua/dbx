import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("apps/desktop/src/components/connection/ConnectionDialog.vue", "utf8");

test("BigQuery profile uses the Google API endpoint and port 443", () => {
  assert.match(
    source,
    /bigquery:\s*\{\s*type:\s*"bigquery",\s*port:\s*443,\s*user:\s*"",\s*label:\s*"BigQuery",\s*icon:\s*"bigquery",\s*host:\s*"https:\/\/www\.googleapis\.com\/bigquery\/v2"/,
  );
});

test("BigQuery connection form exposes URL params for authentication properties", () => {
  assert.match(source, /form\.db_type === 'bigquery'/);
  assert.match(source, /OAuthType=0;OAuthServiceAcctEmail=/);
  assert.match(source, /OAuthPvtKeyPath=/);
});
