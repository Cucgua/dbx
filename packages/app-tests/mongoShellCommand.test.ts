import { strict as assert } from "node:assert";
import test from "node:test";
import {
  evaluateMongoAggregateSafety,
  mongoAggregateWriteStage,
  mongoCountToQueryResult,
  mongoDocumentsToQueryResult,
  parseMongoAggregateCommand,
  parseMongoCountDocumentsCommand,
  parseMongoFindCommand,
} from "../../apps/desktop/src/lib/mongoShellCommand.ts";

test("parseMongoFindCommand parses db collection find with an empty JSON filter", () => {
  assert.deepEqual(parseMongoFindCommand("db.users.find({})"), {
    collection: "users",
    filter: "{}",
    skip: 0,
    limit: 100,
    sort: undefined,
  });
});

test("parseMongoFindCommand parses getCollection find with chained sort skip and limit", () => {
  assert.deepEqual(
    parseMongoFindCommand(
      'db.getCollection("audit.logs").find({"level":"warn"}).sort({"createdAt":-1}).skip(20).limit(10)',
    ),
    {
      collection: "audit.logs",
      filter: '{"level":"warn"}',
      skip: 20,
      limit: 10,
      sort: '{"createdAt":-1}',
    },
  );
});

test("parseMongoFindCommand rejects unsupported mongo shell commands", () => {
  assert.equal(parseMongoFindCommand("db.users.insertOne({})"), null);
});

test("parseMongoCountDocumentsCommand parses db collection countDocuments", () => {
  assert.deepEqual(parseMongoCountDocumentsCommand("db.products.countDocuments({})"), {
    collection: "products",
    filter: "{}",
  });
});

test("parseMongoAggregateCommand parses db collection aggregate", () => {
  assert.deepEqual(parseMongoAggregateCommand('db.products.aggregate([{"$match":{"active":true}},{"$count":"total"}])'), {
    collection: "products",
    pipeline: '[{"$match":{"active":true}},{"$count":"total"}]',
  });
});

test("parseMongoAggregateCommand accepts an empty pipeline", () => {
  assert.deepEqual(parseMongoAggregateCommand("db.products.aggregate([])"), {
    collection: "products",
    pipeline: "[]",
  });
});

test("parseMongoAggregateCommand rejects non-array pipelines and extra arguments", () => {
  assert.equal(parseMongoAggregateCommand('db.products.aggregate({"$match":{}})'), null);
  assert.equal(parseMongoAggregateCommand("db.products.aggregate([], {})"), null);
  assert.equal(parseMongoAggregateCommand("db.products.aggregate([]).limit(10)"), null);
});

test("parseMongoAggregateCommand normalises ObjectId arguments with either quote style", () => {
  const oid = "507f1f77bcf86cd799439011";
  for (const quote of ["\"", "'"]) {
    const command = parseMongoAggregateCommand(
      `db.orders.aggregate([{"$match":{"_id":ObjectId(${quote}${oid}${quote})}}])`,
    );
    assert.ok(command, `quote=${quote} should parse`);
    assert.equal(command.collection, "orders");
    assert.deepEqual(JSON.parse(command.pipeline), [{ "$match": { "_id": { "$oid": oid } } }]);
  }
});

test("evaluateMongoAggregateSafety blocks write stages unless MCP write flags allow them", () => {
  const out = parseMongoAggregateCommand('db.products.aggregate([{"$out":"products_copy"}])');
  assert.ok(out);
  assert.equal(mongoAggregateWriteStage(out.pipeline), "$out");
  assert.match(evaluateMongoAggregateSafety(out, {}).reason || "", /DBX_MCP_ALLOW_WRITES=1/);

  const merge = parseMongoAggregateCommand('db.products.aggregate([{"$merge":{"into":"products_copy"}}])');
  assert.ok(merge);
  assert.equal(mongoAggregateWriteStage(merge.pipeline), "$merge");
  assert.match(evaluateMongoAggregateSafety(merge, { allowWrites: true }).reason || "", /DBX_MCP_ALLOW_DANGEROUS_SQL=1/);
  assert.equal(evaluateMongoAggregateSafety(merge, { allowWrites: true, allowDangerous: true }).allowed, true);
});

test("mongoCountToQueryResult returns a single count row", () => {
  assert.deepEqual(mongoCountToQueryResult(42, 5), {
    columns: ["count"],
    rows: [[42]],
    affected_rows: 42,
    execution_time_ms: 5,
  });
});

test("mongoDocumentsToQueryResult turns mongo documents into grid rows", () => {
  const result = mongoDocumentsToQueryResult(
    [
      { _id: "1", name: "Ada", profile: { role: "admin" } },
      { _id: "2", active: true, name: "Lin" },
    ],
    5,
    12,
  );

  assert.deepEqual(result.columns, ["_id", "name", "profile", "active"]);
  assert.deepEqual(result.rows, [
    ["1", "Ada", '{"role":"admin"}', null],
    ["2", "Lin", null, true],
  ]);
  assert.equal(result.affected_rows, 12);
  assert.equal(result.execution_time_ms, 5);
  assert.equal(result.truncated, true);
});
