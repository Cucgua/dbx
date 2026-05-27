import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../apps/desktop/src/components/connection/ConnectionDialog.vue", import.meta.url),
  "utf8",
);

test("connection dialog exposes generic TLS controls for supported database types", () => {
  assert.match(source, /const tlsCapableDatabaseTypes = new Set<DatabaseType>/);
  assert.match(source, /"mysql"/);
  assert.match(source, /"postgres"/);
  assert.match(source, /const supportsTlsToggle = computed/);
  assert.match(source, /<TabsTrigger v-if="supportsTlsToggle" value="tls">/);
  assert.match(source, /<TabsContent v-if="supportsTlsToggle" value="tls"/);
});

test("connection dialog exposes CA certificate path for native MySQL TLS", () => {
  assert.match(source, /const supportsMysqlTlsOptions = computed/);
  assert.match(source, /form\.value\.db_type === "mysql"/);
  assert.match(source, /const mysqlTlsMode = computed/);
  assert.match(source, /const mysqlClientCertPath = computed/);
  assert.match(source, /const mysqlClientKeyPath = computed/);
  assert.match(source, /v-model="mysqlTlsMode"/);
  assert.match(source, /v-model="form\.ca_cert_path"/);
  assert.match(source, /v-model="mysqlClientCertPath"/);
  assert.match(source, /v-model="mysqlClientKeyPath"/);
  assert.match(source, /setUrlParam\(next, "ssl-cert"/);
  assert.match(source, /setUrlParam\(next, "ssl-key"/);
  assert.match(source, /const bareMysqlProfiles = new Set/);
  assert.match(source, /"oceanbase"/);
  assert.match(source, /"doris"/);
  assert.match(source, /"starrocks"/);
  assert.match(source, /"selectdb"/);
});

test("connection dialog exposes PostgreSQL TLS certificate controls", () => {
  assert.match(source, /const nativePostgresTlsDatabaseTypes = new Set<DatabaseType>/);
  assert.match(source, /const supportsPostgresTlsOptions = computed/);
  assert.match(source, /"postgres"/);
  assert.match(source, /"redshift"/);
  assert.match(source, /"gaussdb"/);
  assert.match(source, /"opengauss"/);
  assert.match(source, /const postgresTlsMode = computed/);
  assert.match(source, /v-model="postgresTlsMode"/);
  assert.match(source, /v-model="postgresRootCertPath"/);
  assert.match(source, /v-model="postgresClientCertPath"/);
  assert.match(source, /v-model="postgresClientKeyPath"/);
  assert.match(source, /setUrlParam\(form\.value\.url_params, "sslrootcert"/);
  assert.match(source, /setUrlParam\(form\.value\.url_params, "sslcert"/);
  assert.match(source, /setUrlParam\(form\.value\.url_params, "sslkey"/);
});
