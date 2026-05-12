import { strict as assert } from "node:assert";
import test from "node:test";
import { parseConnectionUrl } from "../src/lib/connectionUrl.ts";

test("parses postgres connection URLs", () => {
  assert.deepEqual(parseConnectionUrl("postgresql://alice:secret@db.example.com:5433/app?sslmode=require"), {
    dbType: "postgres",
    driverProfile: "postgres",
    driverLabel: "PostgreSQL",
    host: "db.example.com",
    port: 5433,
    username: "alice",
    password: "secret",
    database: "app",
    urlParams: "sslmode=require",
    ssl: false,
  });
});

test("parses mysql URLs with encoded credentials", () => {
  const parsed = parseConnectionUrl("mysql://root:p%40ss@127.0.0.1/shop?charset=utf8mb4");

  assert.equal(parsed.dbType, "mysql");
  assert.equal(parsed.driverProfile, "mysql");
  assert.equal(parsed.host, "127.0.0.1");
  assert.equal(parsed.port, 3306);
  assert.equal(parsed.username, "root");
  assert.equal(parsed.password, "p@ss");
  assert.equal(parsed.database, "shop");
  assert.equal(parsed.urlParams, "charset=utf8mb4");
});

test("keeps MongoDB URLs as connection strings", () => {
  const source = "mongodb+srv://reader:secret@cluster.example.com/app?retryWrites=true";
  const parsed = parseConnectionUrl(source);

  assert.equal(parsed.dbType, "mongodb");
  assert.equal(parsed.driverProfile, "mongodb");
  assert.equal(parsed.host, "cluster.example.com");
  assert.equal(parsed.port, 27017);
  assert.equal(parsed.database, "app");
  assert.equal(parsed.connectionString, source);
  assert.equal(parsed.useMongoUrl, true);
  assert.equal(parsed.ssl, true);
});

test("uses selected HTTP-compatible profile for HTTP URLs", () => {
  const parsed = parseConnectionUrl("https://search.example.com:9243", "elasticsearch");

  assert.equal(parsed.dbType, "elasticsearch");
  assert.equal(parsed.driverProfile, "elasticsearch");
  assert.equal(parsed.host, "search.example.com");
  assert.equal(parsed.port, 9243);
  assert.equal(parsed.ssl, true);
});

test("rejects unsupported URL schemes", () => {
  assert.throws(() => parseConnectionUrl("ftp://example.com"), /Unsupported connection URL scheme/);
});
