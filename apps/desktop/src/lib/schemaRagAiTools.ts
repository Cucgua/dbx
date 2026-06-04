import type { AiConfig } from "@/stores/settingsStore";
import type { ColumnInfo, DatabaseType, ForeignKeyInfo, IndexInfo } from "@/types/database";
import * as api from "@/lib/api";
import type { SchemaRagGraphSeed } from "@/lib/schemaRagApi";

export const SCHEMA_RAG_AI_TOOL_NAMES = new Set([
  "dbx_search_schema",
  "dbx_search_table_columns",
  "dbx_load_table_schema",
  "dbx_expand_schema_graph",
]);

export interface SchemaRagAiToolContext {
  connectionId?: string;
  databaseType: DatabaseType;
  database: string;
  schema?: string;
}

export interface SchemaRagAiToolBudget {
  schemaSearches: number;
  columnSearches: number;
  tableLoads: number;
  graphExpansions: number;
  searchedQueries: Set<string>;
  loadedTables: Set<string>;
}

const MAX_SCHEMA_SEARCHES = 8;
const MAX_COLUMN_SEARCHES = 12;
const MAX_TABLE_LOADS = 8;
const MAX_GRAPH_EXPANSIONS = 4;
const MAX_RELATED_TABLES = 5;

export function createSchemaRagAiToolBudget(): SchemaRagAiToolBudget {
  return {
    schemaSearches: 0,
    columnSearches: 0,
    tableLoads: 0,
    graphExpansions: 0,
    searchedQueries: new Set(),
    loadedTables: new Set(),
  };
}

export function isSchemaRagAiToolName(name: string): boolean {
  return SCHEMA_RAG_AI_TOOL_NAMES.has(name);
}

export function getSchemaRagSubtaskAllowedToolNames(): string[] {
  return [...SCHEMA_RAG_AI_TOOL_NAMES];
}

export function supportsSchemaRagAiToolLoop(config: AiConfig, context: SchemaRagAiToolContext): boolean {
  if (!context.connectionId || !context.schema) return false;
  if (["redis", "mongodb"].includes(context.databaseType)) return false;
  if (config.apiStyle !== "completions") return false;
  return !["claude", "gemini"].includes(config.provider);
}

export function buildSchemaRagAiTools(): unknown[] {
  return [
    {
      type: "function",
      function: {
        name: "dbx_search_schema",
        description:
          "Search the analyzed Schema RAG index for relevant tables, columns, and relationships in the active schema.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language schema search query with business terms, table roles, and column hints.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 8,
              description: "Maximum matching tables to return.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_search_table_columns",
        description:
          "Search the analyzed Schema RAG index for semantically relevant columns inside a specific table.",
        parameters: {
          type: "object",
          properties: {
            schema: { type: "string", description: "Schema name. Defaults to the active schema." },
            table: { type: "string", description: "Target table name." },
            query: {
              type: "string",
              description: "Column search query. Include business terms and likely identifier fragments.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              description: "Maximum matching columns to return.",
            },
            includePrimaryKey: {
              type: "boolean",
              description: "Whether the result should include primary-key flags. Defaults to true.",
            },
          },
          required: ["table", "query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_load_table_schema",
        description:
          "Load live columns, indexes, and foreign keys for one confirmed table before using its fields in final SQL.",
        parameters: {
          type: "object",
          properties: {
            schema: { type: "string", description: "Schema name. Defaults to the active schema." },
            table: { type: "string", description: "Target table name." },
          },
          required: ["table"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_expand_schema_graph",
        description:
          "Expand Schema RAG graph evidence from table, column, API field, business concept, or join-candidate seeds.",
        parameters: {
          type: "object",
          properties: {
            seeds: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [
                      "table",
                      "column",
                      "api_doc_source",
                      "api_doc_section",
                      "api_field",
                      "business_concept",
                      "join_candidate",
                    ],
                  },
                  id: { type: "string" },
                  schema: { type: "string" },
                  table: { type: "string" },
                  column: { type: "string" },
                },
                required: ["kind"],
              },
            },
            includeCandidates: {
              type: "boolean",
              description: "Whether to include candidate mappings and candidate joins. Defaults to true.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              description: "Maximum graph facts to return.",
            },
          },
          required: ["seeds"],
        },
      },
    },
  ];
}

export async function executeSchemaRagAiTool(
  name: string,
  rawArguments: string,
  context: SchemaRagAiToolContext,
  budget: SchemaRagAiToolBudget,
): Promise<unknown> {
  if (!isSchemaRagAiToolName(name)) return { error: `Unknown Schema RAG tool: ${name}` };
  const args = parseToolArguments(rawArguments);
  if (name === "dbx_search_schema") return executeSchemaSearch(context, budget, args);
  if (name === "dbx_search_table_columns") return executeColumnSearch(context, budget, args);
  if (name === "dbx_load_table_schema") return executeLoadTableSchema(context, budget, args);
  if (name === "dbx_expand_schema_graph") return executeExpandGraph(context, budget, args);
  return { error: `Unhandled Schema RAG tool: ${name}` };
}

async function executeSchemaSearch(
  context: SchemaRagAiToolContext,
  budget: SchemaRagAiToolBudget,
  args: Record<string, unknown>,
): Promise<unknown> {
  const scope = activeScope(context);
  if (!scope) return { error: "No active connection/schema for Schema RAG." };
  if (budget.schemaSearches >= MAX_SCHEMA_SEARCHES) return { error: "Schema search budget exceeded." };

  const query = stringArg(args.query);
  if (!query) return { error: "query is required" };
  const queryKey = normalizeKey(query);
  if (budget.searchedQueries.has(queryKey)) {
    return { error: "Duplicate schema search skipped. Reuse the previous result or ask for a narrower query." };
  }
  budget.searchedQueries.add(queryKey);
  budget.schemaSearches += 1;

  const status = await api.loadSchemaRagStatus(scope);
  if (!status.indexed) return { indexed: false, tables: [], message: "Current schema has not been analyzed." };
  const result = await api.searchSchemaRag({
    ...scope,
    query,
    limit: clampInt(args.limit, 1, 8, 6),
  });

  return {
    indexed: true,
    indexedAt: result.indexedAt,
    query: result.query,
    truncated: result.truncated,
    tables: result.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      tableType: table.tableType,
      score: table.score,
      reason: table.reason,
      matchedColumns: table.matchedColumns.map((column) => ({
        name: column.name,
        comment: column.comment,
        primaryKey: column.primaryKey,
        dataType: column.dataType,
        score: column.score,
        reason: column.reason,
      })),
      relatedTables: table.relatedTables.slice(0, MAX_RELATED_TABLES),
    })),
  };
}

async function executeColumnSearch(
  context: SchemaRagAiToolContext,
  budget: SchemaRagAiToolBudget,
  args: Record<string, unknown>,
): Promise<unknown> {
  const scope = activeScope(context, stringArg(args.schema));
  if (!scope) return { error: "No active connection/schema for Schema RAG column search." };
  if (budget.columnSearches >= MAX_COLUMN_SEARCHES) return { error: "Column search budget exceeded." };

  const table = stringArg(args.table);
  const query = stringArg(args.query);
  if (!table || !query) return { error: "table and query are required" };
  budget.columnSearches += 1;

  const status = await api.loadSchemaRagStatus(scope);
  if (!status.indexed) {
    return {
      indexed: false,
      indexUnavailable: true,
      schema: scope.schema,
      table,
      query,
      columns: [],
      message: "Current schema has not been analyzed. Use dbx_load_table_schema as a live metadata fallback.",
    };
  }

  const result = await api.searchTableColumnsRag({
    ...scope,
    table,
    query,
    limit: clampInt(args.limit, 1, 30, 12),
    includePrimaryKey: args.includePrimaryKey !== false,
  });
  return {
    indexed: true,
    indexedAt: result.indexedAt,
    schema: result.schema,
    table: result.table,
    query: result.query,
    totalColumns: result.totalColumns,
    returnedColumns: result.returnedColumns,
    truncated: result.truncated,
    columns: result.columns.map((column) => ({
      name: column.name,
      comment: column.comment,
      primaryKey: column.primaryKey,
      dataType: column.dataType,
      score: column.score,
      reason: column.reason,
    })),
  };
}

async function executeLoadTableSchema(
  context: SchemaRagAiToolContext,
  budget: SchemaRagAiToolBudget,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for schema loading." };
  if (budget.tableLoads >= MAX_TABLE_LOADS) return { error: "Table schema load budget exceeded." };

  const schema = stringArg(args.schema) || context.schema || "";
  const table = stringArg(args.table);
  if (!schema || !table) return { error: "schema and table are required" };
  const tableKey = normalizeKey(`${schema}.${table}`);
  if (budget.loadedTables.has(tableKey)) {
    return { error: "Duplicate table schema load skipped. Reuse the previously loaded table schema." };
  }
  budget.loadedTables.add(tableKey);
  budget.tableLoads += 1;

  const [columns, indexes, foreignKeys] = await Promise.all([
    api.getColumns(context.connectionId, context.database, schema, table),
    api.listIndexes(context.connectionId, context.database, schema, table).catch(() => [] as IndexInfo[]),
    api.listForeignKeys(context.connectionId, context.database, schema, table).catch(() => [] as ForeignKeyInfo[]),
  ]);

  return {
    schema,
    table,
    columns: columns.map(formatColumn),
    indexes: indexes.map((index) => ({
      name: index.name,
      columns: index.columns,
      unique: index.is_unique,
      primary: index.is_primary,
    })),
    foreignKeys: foreignKeys.map((fk) => ({
      column: fk.column,
      refTable: fk.ref_table,
      refColumn: fk.ref_column,
    })),
  };
}

async function executeExpandGraph(
  context: SchemaRagAiToolContext,
  budget: SchemaRagAiToolBudget,
  args: Record<string, unknown>,
): Promise<unknown> {
  const scope = activeScope(context);
  if (!scope) return { error: "No active connection/schema for graph expansion." };
  if (budget.graphExpansions >= MAX_GRAPH_EXPANSIONS) return { error: "Schema graph expansion budget exceeded." };

  const seeds = Array.isArray(args.seeds)
    ? args.seeds.map(normalizeGraphSeed).filter((seed): seed is SchemaRagGraphSeed => !!seed)
    : [];
  if (!seeds.length) return { error: "seeds are required" };
  budget.graphExpansions += 1;

  const status = await api.loadSchemaRagStatus(scope);
  if (!status.indexed) {
    return {
      indexed: false,
      message: "Current schema has not been analyzed. Graph expansion is unavailable.",
      verifiedMappings: [],
      candidateMappings: [],
      joinCandidates: [],
      concepts: [],
      sourceEvidence: [],
    };
  }

  const result = await api.expandSchemaRagGraph({
    ...scope,
    seeds,
    includeCandidates: args.includeCandidates !== false,
    limit: clampInt(args.limit, 1, 100, 20),
  });
  return {
    indexed: true,
    verifiedMappings: result.verifiedMappings.slice(0, 20),
    candidateMappings: result.candidateMappings.slice(0, 20),
    joinCandidates: result.joinCandidates.slice(0, 20),
    concepts: result.concepts.slice(0, 20),
    sourceEvidence: result.sourceEvidence.slice(0, 20),
  };
}

function activeScope(context: SchemaRagAiToolContext, schemaOverride?: string) {
  if (!context.connectionId) return null;
  const schema = schemaOverride || context.schema || "";
  if (!schema) return null;
  return { connectionId: context.connectionId, database: context.database, schema };
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) return {};
  const parsed = JSON.parse(rawArguments);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function formatColumn(column: ColumnInfo) {
  return {
    name: column.name,
    dataType: column.data_type,
    nullable: column.is_nullable,
    primaryKey: column.is_primary_key,
    default: column.column_default,
    extra: column.extra,
    comment: column.comment,
  };
}

function normalizeGraphSeed(value: unknown): SchemaRagGraphSeed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const kind = stringArg(data.kind);
  if (
    ![
      "table",
      "column",
      "api_doc_source",
      "api_doc_section",
      "api_field",
      "business_concept",
      "join_candidate",
    ].includes(kind)
  ) {
    return null;
  }
  const seed: SchemaRagGraphSeed = { kind: kind as SchemaRagGraphSeed["kind"] };
  const id = stringArg(data.id);
  const schema = stringArg(data.schema);
  const table = stringArg(data.table);
  const column = stringArg(data.column);
  if (id) seed.id = id;
  if (schema) seed.schema = schema;
  if (table) seed.table = table;
  if (column) seed.column = column;
  return seed;
}
