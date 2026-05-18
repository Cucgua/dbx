import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSqlSafety } from "../src/sql-safety.js";

test("allows read-only SQL by default", () => {
  const decision = evaluateSqlSafety("select * from users limit 5");

  assert.equal(decision.allowed, true);
});
test("blocks write SQL by default", () => {
  const decision = evaluateSqlSafety("update users set role = 'admin' where id = 1");

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /read-only/i);
});

test("blocks dangerous SQL even when writes are enabled", () => {
  const decision = evaluateSqlSafety("drop table users", { allowWrites: true });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /dangerous/i);
});

test("blocks update without where when writes are enabled", () => {
  const decision = evaluateSqlSafety("update users set disabled = true", { allowWrites: true });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /WHERE/i);
});
