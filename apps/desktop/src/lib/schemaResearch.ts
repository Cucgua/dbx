export type SchemaResearchStatus = "sufficient" | "partial" | "need_user_choice" | "not_found" | "error";

export type SchemaEvidenceConfidence = "high" | "medium" | "low";

export type SchemaEvidenceColumnUsage =
  | "select"
  | "filter"
  | "join"
  | "group"
  | "order"
  | "insert"
  | "update"
  | "unknown";

export interface SchemaEvidenceColumn {
  name: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  comment?: string | null;
  usage: SchemaEvidenceColumnUsage;
  reason: string;
  verified: boolean;
}

export interface SchemaEvidenceTable {
  schema: string;
  table: string;
  tableType?: string;
  comment?: string | null;
  reason: string;
  confidence: SchemaEvidenceConfidence;
  columns: SchemaEvidenceColumn[];
}

export interface SchemaEvidenceRelation {
  leftSchema: string;
  leftTable: string;
  leftColumn: string;
  rightSchema: string;
  rightTable: string;
  rightColumn: string;
  source: "foreign_key" | "user_confirmed" | "known_enrichment" | "model_candidate";
  confidence: SchemaEvidenceConfidence;
}

export interface SchemaRejectedCandidate {
  schema?: string;
  table?: string;
  column?: string;
  reason: string;
}

export interface SchemaEvidencePackage {
  tables: SchemaEvidenceTable[];
  relations: SchemaEvidenceRelation[];
  rejectedCandidates: SchemaRejectedCandidate[];
  notes: string[];
}

export interface SchemaResearchUncertainty {
  kind: "table" | "column" | "relation";
  message: string;
  candidates?: unknown[];
}

export interface SchemaResearchToolBudget {
  usedRounds: number;
  schemaSearches: number;
  columnSearches: number;
  tableLoads: number;
  columnDetails: number;
  relationLookups: number;
}

export interface SchemaResearchTaskResult {
  status: SchemaResearchStatus;
  summary: string;
  evidence: SchemaEvidencePackage;
  uncertainties: SchemaResearchUncertainty[];
  toolBudget: SchemaResearchToolBudget;
}

export interface SchemaResearchResultLimits {
  maxTables?: number;
  maxColumnsPerTable?: number;
  maxRelations?: number;
  maxRejectedCandidates?: number;
  maxUncertainties?: number;
  maxNotes?: number;
}

export const EMPTY_SCHEMA_EVIDENCE_PACKAGE: SchemaEvidencePackage = {
  tables: [],
  relations: [],
  rejectedCandidates: [],
  notes: [],
};

const STATUS_VALUES = new Set<SchemaResearchStatus>([
  "sufficient",
  "partial",
  "need_user_choice",
  "not_found",
  "error",
]);

const CONFIDENCE_VALUES = new Set<SchemaEvidenceConfidence>(["high", "medium", "low"]);

const COLUMN_USAGE_VALUES = new Set<SchemaEvidenceColumnUsage>([
  "select",
  "filter",
  "join",
  "group",
  "order",
  "insert",
  "update",
  "unknown",
]);

const RELATION_SOURCE_VALUES = new Set<SchemaEvidenceRelation["source"]>([
  "foreign_key",
  "user_confirmed",
  "known_enrichment",
  "model_candidate",
]);

export function normalizeSchemaResearchTaskResult(
  value: unknown,
  limits: SchemaResearchResultLimits = {},
): SchemaResearchTaskResult {
  const data = asRecord(value);
  const evidence = normalizeEvidencePackage(data.evidence, limits);
  const uncertainties = normalizeUncertainties(data.uncertainties).slice(0, limits.maxUncertainties ?? 6);
  const status = normalizeStatus(data.status, evidence, uncertainties);
  return {
    status,
    summary: cleanString(data.summary) || fallbackSummary(status, evidence, uncertainties),
    evidence,
    uncertainties,
    toolBudget: normalizeToolBudget(data.toolBudget),
  };
}

export function parseSchemaResearchTaskResultText(
  text: string,
  limits: SchemaResearchResultLimits = {},
): SchemaResearchTaskResult {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return normalizeSchemaResearchTaskResult(
      {
        status: "partial",
        summary: text.trim() || "Schema research finished without structured JSON.",
        evidence: EMPTY_SCHEMA_EVIDENCE_PACKAGE,
        uncertainties: [
          {
            kind: "table",
            message: "The schema research subtask did not return structured JSON.",
          },
        ],
      },
      limits,
    );
  }
  try {
    return normalizeSchemaResearchTaskResult(JSON.parse(jsonText), limits);
  } catch {
    return normalizeSchemaResearchTaskResult(
      {
        status: "partial",
        summary: text.trim() || "Schema research JSON could not be parsed.",
        evidence: EMPTY_SCHEMA_EVIDENCE_PACKAGE,
        uncertainties: [
          {
            kind: "table",
            message: "The schema research subtask returned invalid JSON.",
          },
        ],
      },
      limits,
    );
  }
}

export function formatSchemaResearchTaskResultForPrompt(
  result: SchemaResearchTaskResult,
  options: { isZh?: boolean } = {},
): string {
  const isZh = options.isZh === true;
  const lines: string[] = [
    isZh ? `Schema Research 状态：${result.status}` : `Schema research status: ${result.status}`,
    isZh ? `摘要：${result.summary}` : `Summary: ${result.summary}`,
  ];

  if (result.evidence.tables.length) {
    lines.push(isZh ? "证据表：" : "Evidence tables:");
    for (const table of result.evidence.tables) {
      const tableName = [table.schema, table.table].filter(Boolean).join(".");
      lines.push(
        `- ${tableName}${table.tableType ? ` (${table.tableType})` : ""}, confidence=${table.confidence}: ${table.reason}`,
      );
      const columns = table.columns.map(formatEvidenceColumn).join("; ");
      if (columns) lines.push(`  columns: ${columns}`);
    }
  }

  if (result.evidence.relations.length) {
    lines.push(isZh ? "关系证据：" : "Relation evidence:");
    for (const relation of result.evidence.relations) {
      lines.push(
        `- ${relation.leftSchema}.${relation.leftTable}.${relation.leftColumn} = ${relation.rightSchema}.${relation.rightTable}.${relation.rightColumn} (${relation.source}, confidence=${relation.confidence})`,
      );
    }
  }

  if (result.uncertainties.length) {
    lines.push(isZh ? "不确定项：" : "Uncertainties:");
    for (const item of result.uncertainties) {
      lines.push(`- ${item.kind}: ${item.message}`);
    }
  }

  if (result.evidence.rejectedCandidates.length) {
    lines.push(isZh ? "已排除候选：" : "Rejected candidates:");
    for (const item of result.evidence.rejectedCandidates) {
      const target = [item.schema, item.table, item.column].filter(Boolean).join(".");
      lines.push(`- ${target || "candidate"}: ${item.reason}`);
    }
  }

  if (result.evidence.notes.length) {
    lines.push(isZh ? "备注：" : "Notes:");
    for (const note of result.evidence.notes) lines.push(`- ${note}`);
  }

  const budget = result.toolBudget;
  lines.push(
    `Tool budget: rounds=${budget.usedRounds}, schemaSearches=${budget.schemaSearches}, columnSearches=${budget.columnSearches}, tableLoads=${budget.tableLoads}, columnDetails=${budget.columnDetails}, relationLookups=${budget.relationLookups}`,
  );
  lines.push(
    isZh
      ? "最终 SQL 只能使用已验证字段。若表、字段或关系仍不确定，先请求用户确认。"
      : "Use only verified columns in final SQL. If tables, columns, or relations remain uncertain, ask the user to confirm first.",
  );

  return lines.join("\n");
}

function formatEvidenceColumn(column: SchemaEvidenceColumn): string {
  const flags = [
    column.verified ? "verified" : "unverified",
    column.primaryKey ? "PK" : "",
    column.nullable === true ? "nullable" : column.nullable === false ? "not-null" : "",
    column.usage ? `usage=${column.usage}` : "",
  ].filter(Boolean);
  return `${column.name}${column.dataType ? ` ${column.dataType}` : ""}${flags.length ? ` [${flags.join(", ")}]` : ""}: ${column.reason}`;
}

function normalizeEvidencePackage(value: unknown, limits: SchemaResearchResultLimits): SchemaEvidencePackage {
  const data = asRecord(value);
  const maxTables = limits.maxTables ?? 4;
  const maxColumnsPerTable = limits.maxColumnsPerTable ?? 10;
  return {
    tables: normalizeTables(data.tables, maxTables, maxColumnsPerTable),
    relations: normalizeRelations(data.relations).slice(0, limits.maxRelations ?? 8),
    rejectedCandidates: normalizeRejectedCandidates(data.rejectedCandidates).slice(
      0,
      limits.maxRejectedCandidates ?? 8,
    ),
    notes: normalizeStringArray(data.notes).slice(0, limits.maxNotes ?? 8),
  };
}

function normalizeTables(value: unknown, maxTables: number, maxColumnsPerTable: number): SchemaEvidenceTable[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, SchemaEvidenceTable>();
  for (const item of value) {
    const data = asRecord(item);
    const schema = cleanString(data.schema);
    const table = cleanString(data.table || data.name);
    if (!schema || !table) continue;
    const key = `${schema}.${table}`.toLowerCase();
    if (unique.has(key)) continue;
    unique.set(key, {
      schema,
      table,
      tableType: cleanOptionalString(data.tableType),
      comment: cleanOptionalString(data.comment) ?? null,
      reason: cleanString(data.reason) || "candidate table",
      confidence: normalizeConfidence(data.confidence),
      columns: normalizeColumns(data.columns).slice(0, maxColumnsPerTable),
    });
    if (unique.size >= maxTables) break;
  }
  return [...unique.values()];
}

function normalizeColumns(value: unknown): SchemaEvidenceColumn[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, SchemaEvidenceColumn>();
  for (const item of value) {
    const data = asRecord(item);
    const name = cleanString(data.name || data.column);
    if (!name) continue;
    const key = name.toLowerCase();
    if (unique.has(key)) continue;
    unique.set(key, {
      name,
      dataType: cleanOptionalString(data.dataType),
      nullable: typeof data.nullable === "boolean" ? data.nullable : undefined,
      primaryKey: typeof data.primaryKey === "boolean" ? data.primaryKey : undefined,
      comment: cleanOptionalString(data.comment) ?? null,
      usage: normalizeColumnUsage(data.usage),
      reason: cleanString(data.reason) || "candidate column",
      verified: data.verified === true,
    });
  }
  return [...unique.values()];
}

function normalizeRelations(value: unknown): SchemaEvidenceRelation[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, SchemaEvidenceRelation>();
  for (const item of value) {
    const data = asRecord(item);
    const relation: SchemaEvidenceRelation = {
      leftSchema: cleanString(data.leftSchema),
      leftTable: cleanString(data.leftTable),
      leftColumn: cleanString(data.leftColumn),
      rightSchema: cleanString(data.rightSchema),
      rightTable: cleanString(data.rightTable),
      rightColumn: cleanString(data.rightColumn),
      source: normalizeRelationSource(data.source),
      confidence: normalizeConfidence(data.confidence),
    };
    if (
      !relation.leftSchema ||
      !relation.leftTable ||
      !relation.leftColumn ||
      !relation.rightSchema ||
      !relation.rightTable ||
      !relation.rightColumn
    ) {
      continue;
    }
    const key =
      `${relation.leftSchema}.${relation.leftTable}.${relation.leftColumn}:${relation.rightSchema}.${relation.rightTable}.${relation.rightColumn}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, relation);
  }
  return [...unique.values()];
}

function normalizeRejectedCandidates(value: unknown): SchemaRejectedCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: SchemaRejectedCandidate[] = [];
  for (const item of value) {
    const data = asRecord(item);
    const reason = cleanString(data.reason);
    if (!reason) continue;
    candidates.push({
      schema: cleanOptionalString(data.schema),
      table: cleanOptionalString(data.table),
      column: cleanOptionalString(data.column),
      reason,
    });
  }
  return candidates;
}

function normalizeUncertainties(value: unknown): SchemaResearchUncertainty[] {
  if (!Array.isArray(value)) return [];
  const uncertainties: SchemaResearchUncertainty[] = [];
  for (const item of value) {
    const data = asRecord(item);
    const kind = ["table", "column", "relation"].includes(String(data.kind)) ? String(data.kind) : "table";
    const message = cleanString(data.message);
    if (!message) continue;
    uncertainties.push({
      kind: kind as SchemaResearchUncertainty["kind"],
      message,
      candidates: Array.isArray(data.candidates) ? data.candidates.slice(0, 12) : undefined,
    });
  }
  return uncertainties;
}

function normalizeToolBudget(value: unknown): SchemaResearchToolBudget {
  const data = asRecord(value);
  return {
    usedRounds: normalizeNonNegativeInteger(data.usedRounds),
    schemaSearches: normalizeNonNegativeInteger(data.schemaSearches),
    columnSearches: normalizeNonNegativeInteger(data.columnSearches),
    tableLoads: normalizeNonNegativeInteger(data.tableLoads),
    columnDetails: normalizeNonNegativeInteger(data.columnDetails),
    relationLookups: normalizeNonNegativeInteger(data.relationLookups),
  };
}

function normalizeStatus(
  value: unknown,
  evidence: SchemaEvidencePackage,
  uncertainties: SchemaResearchUncertainty[],
): SchemaResearchStatus {
  const status = String(value || "").trim() as SchemaResearchStatus;
  if (STATUS_VALUES.has(status)) return status;
  if (uncertainties.length) return "partial";
  return evidence.tables.length ? "sufficient" : "not_found";
}

function normalizeConfidence(value: unknown): SchemaEvidenceConfidence {
  const confidence = String(value || "").trim() as SchemaEvidenceConfidence;
  return CONFIDENCE_VALUES.has(confidence) ? confidence : "medium";
}

function normalizeColumnUsage(value: unknown): SchemaEvidenceColumnUsage {
  const usage = String(value || "").trim() as SchemaEvidenceColumnUsage;
  return COLUMN_USAGE_VALUES.has(usage) ? usage : "unknown";
}

function normalizeRelationSource(value: unknown): SchemaEvidenceRelation["source"] {
  const source = String(value || "").trim() as SchemaEvidenceRelation["source"];
  return RELATION_SOURCE_VALUES.has(source) ? source : "model_candidate";
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function fallbackSummary(
  status: SchemaResearchStatus,
  evidence: SchemaEvidencePackage,
  uncertainties: SchemaResearchUncertainty[],
): string {
  if (status === "not_found") return "No matching schema evidence was found.";
  if (status === "need_user_choice") return "Schema evidence needs user confirmation.";
  if (uncertainties.length) return "Schema evidence is partial and has unresolved uncertainty.";
  return `Found ${evidence.tables.length} table(s) and ${evidence.relations.length} relation(s).`;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalString(value: unknown): string | undefined {
  const text = cleanString(value);
  return text || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return candidate.slice(start, end + 1);
}
