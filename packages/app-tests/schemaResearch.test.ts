import { strict as assert } from "node:assert";
import { test } from "vitest";

import {
  formatSchemaResearchTaskResultForPrompt,
  normalizeSchemaResearchTaskResult,
  parseSchemaResearchTaskResultText,
} from "../../apps/desktop/src/lib/schemaResearch";

test("normalizes and limits schema research evidence", () => {
  const result = normalizeSchemaResearchTaskResult(
    {
      status: "sufficient",
      summary: "Found review evidence.",
      evidence: {
        tables: [
          {
            schema: "public",
            table: "reviews",
            tableType: "TABLE",
            reason: "review business table",
            confidence: "high",
            columns: [
              { name: "id", usage: "select", reason: "primary key", verified: true, primaryKey: true },
              { name: "product_id", usage: "join", reason: "product relation", verified: true },
              { name: "score", usage: "select", reason: "rating value", verified: false },
            ],
          },
          {
            schema: "public",
            table: "review_events",
            reason: "event log",
            columns: [],
          },
        ],
        relations: [
          {
            leftSchema: "public",
            leftTable: "reviews",
            leftColumn: "product_id",
            rightSchema: "public",
            rightTable: "products",
            rightColumn: "id",
            source: "foreign_key",
            confidence: "high",
          },
        ],
        rejectedCandidates: [{ schema: "public", table: "review_events", reason: "event table only" }],
        notes: ["score still needs live detail"],
      },
      toolBudget: {
        usedRounds: 2,
        schemaSearches: 1,
        columnSearches: 1,
        tableLoads: 0,
        columnDetails: 1,
        relationLookups: 1,
      },
    },
    { maxTables: 1, maxColumnsPerTable: 2 },
  );

  assert.equal(result.status, "sufficient");
  assert.equal(result.evidence.tables.length, 1);
  assert.equal(result.evidence.tables[0].columns.length, 2);
  assert.equal(result.evidence.relations.length, 1);
  assert.equal(result.toolBudget.columnDetails, 1);
});

test("formats compact prompt evidence without raw tool payloads", () => {
  const result = normalizeSchemaResearchTaskResult({
    status: "partial",
    summary: "Need relation confirmation.",
    evidence: {
      tables: [
        {
          schema: "public",
          table: "orders",
          reason: "order facts",
          confidence: "high",
          columns: [{ name: "customer_id", usage: "join", reason: "customer key", verified: true }],
        },
      ],
    },
    uncertainties: [{ kind: "relation", message: "No FK between orders and customers." }],
    toolBudget: { usedRounds: 1, schemaSearches: 1 },
  });

  const text = formatSchemaResearchTaskResultForPrompt(result, { isZh: true });

  assert.match(text, /Schema Research 状态：partial/);
  assert.match(text, /public\.orders/);
  assert.match(text, /customer_id/);
  assert.match(text, /No FK between orders and customers/);
  assert.doesNotMatch(text, /rawMessage|tool_calls|matchedColumns/);
});

test("parses fenced JSON schema research results", () => {
  const result = parseSchemaResearchTaskResultText(`
Here is the result:
\`\`\`json
{
  "status": "need_user_choice",
  "summary": "Two candidate tables remain.",
  "evidence": {
    "tables": []
  },
  "uncertainties": [
    { "kind": "table", "message": "Choose reviews or comments." }
  ]
}
\`\`\`
`);

  assert.equal(result.status, "need_user_choice");
  assert.equal(result.uncertainties.length, 1);
  assert.equal(result.evidence.tables.length, 0);
});
