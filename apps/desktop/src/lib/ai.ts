import type { AiConfig } from "@/stores/settingsStore";
import { uuid } from "@/lib/utils";
import type { AiToolTrace } from "@/lib/api";
import type {
  ColumnInfo,
  ConnectionConfig,
  DatabaseType,
  ForeignKeyInfo,
  IndexInfo,
  QueryResult,
  QueryTab,
} from "@/types/database";
import * as api from "@/lib/api";
import { currentLocale } from "@/i18n";
import { defaultDatabaseTargetsSchema, resolveDefaultDatabase } from "@/lib/defaultDatabase";
import { aiTableMentionKey, type AiTableMention } from "@/lib/aiTableMentions";
import { aiSkillForAction } from "@/lib/aiSkills";
import { isSchemaAware } from "@/lib/databaseCapabilities";
import { createAiWorkflowEvent, type AiWorkflowEvent, type AiWorkflowEventInput } from "@/lib/aiWorkflowEvents";
import {
  formatSchemaResearchTaskResultForPrompt,
  normalizeSchemaResearchTaskResult,
  parseSchemaResearchTaskResultText,
  type SchemaResearchResultLimits,
  type SchemaResearchStatus,
  type SchemaResearchTaskResult,
} from "@/lib/schemaResearch";
import type { ApiDocExtractionRequest } from "@/lib/schemaDocIngestion";
import type {
  ApiDocExtractionStatus,
  SchemaRagApiDocExtraction,
  SchemaRagApiFieldFact,
  SchemaRagBusinessConceptFact,
  SchemaRagJoinCandidateFact,
} from "@/lib/schemaRag";

export type AiAction = "generate" | "explain" | "optimize" | "fix" | "convert" | "sampleData";
export type AiAssistantMode = "ask" | "agent" | "rag";

export interface AiSchemaTable {
  schema?: string;
  name: string;
  tableType: string;
  columns: ColumnInfo[];
  indexes?: IndexInfo[];
  foreignKeys?: ForeignKeyInfo[];
}

export interface AiContext {
  connectionName: string;
  databaseType: DatabaseType;
  connectionId?: string;
  database: string;
  schema?: string;
  currentSql: string;
  lastError?: string;
  lastResultPreview?: string;
  tables: AiSchemaTable[];
  schemaRagContext?: string;
  schemaScope?: "focused_table" | "database";
  truncated: boolean;
}

interface SchemaRagToolScope {
  connectionId: string;
  database: string;
  schema: string;
}

export interface AiRequestInput {
  config: AiConfig;
  action: AiAction;
  mode?: AiAssistantMode;
  instruction: string;
  context: AiContext;
}

export interface SchemaResearchEvidenceGate {
  status: Exclude<SchemaResearchStatus, "sufficient">;
  summary: string;
  uncertainties: Array<{ kind?: string; message?: string }>;
  promptSummary?: string;
}

export type AiWorkflowEventHandler = (event: AiWorkflowEvent) => void;

function emitAiWorkflowEvent(handler: AiWorkflowEventHandler | undefined, input: AiWorkflowEventInput) {
  if (!handler) return;
  handler(createAiWorkflowEvent(input));
}

interface AiSchemaToolWorkflowHooks {
  onEvent?: AiWorkflowEventHandler;
  parentNodeId?: string;
}

export interface AiRelationRequestColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  comment?: string | null;
}

export interface AiRelationRequestTable {
  schema: string;
  table: string;
  columns: AiRelationRequestColumn[];
}

export interface AiRelationCandidatePair {
  leftColumn: string;
  rightColumn: string;
  reason?: string;
  source?: "model" | "auto";
}

export interface AiRelationRequest {
  id: string;
  left: AiRelationRequestTable;
  right: AiRelationRequestTable;
  reason?: string;
  candidates: AiRelationCandidatePair[];
}

export interface AiTableChoiceCandidate {
  schema: string;
  table: string;
  tableType?: string;
  comment?: string | null;
  score?: number;
  reason?: string;
}

export interface AiTableChoiceRequest {
  id: string;
  question: string;
  reason?: string;
  allowManual: boolean;
  candidates: AiTableChoiceCandidate[];
}

export interface AiTableChoiceResult {
  confirmed: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  selectedTable?: {
    schema: string;
    table: string;
    source: "candidate" | "manual";
  };
  message?: string;
}

export interface AiColumnChoiceCandidate {
  column: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  comment?: string | null;
  score?: number;
  reason?: string;
}

export interface AiColumnChoiceRequest {
  id: string;
  schema: string;
  table: string;
  question: string;
  reason?: string;
  multiple: boolean;
  allowManual: boolean;
  candidates: AiColumnChoiceCandidate[];
}

export interface AiColumnChoiceResult {
  confirmed: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  selectedColumns?: Array<{
    column: string;
    source: "candidate" | "manual";
  }>;
  message?: string;
}

export interface AiRelationToolResult {
  confirmed: boolean;
  skipped?: boolean;
  cancelled?: boolean;
  relation?: {
    leftSchema: string;
    leftTable: string;
    rightSchema: string;
    rightTable: string;
    columnPairs: Array<{
      leftColumn: string;
      rightColumn: string;
    }>;
    operator: "=";
    joinType: "inner" | "left" | "right" | "full";
    source: "user";
  };
  message?: string;
}

export type AiRelationRequestHandler = (request: AiRelationRequest) => Promise<AiRelationToolResult>;
export type AiTableChoiceRequestHandler = (request: AiTableChoiceRequest) => Promise<AiTableChoiceResult>;
export type AiColumnChoiceRequestHandler = (request: AiColumnChoiceRequest) => Promise<AiColumnChoiceResult>;

export async function runAiAction(input: AiRequestInput, history?: api.AiMessage[]): Promise<string> {
  const isZh = currentLocale() === "zh-CN";
  const skill = aiSkillForAction(input.action);
  const systemPrompt = buildSystemPrompt(input.action, input.context, input.mode);
  const instruction = isZh ? skill.userInstruction.zh : skill.userInstruction.en;
  const userPrompt = [
    `Action: ${input.action}`,
    instruction,
    "",
    "User request:",
    input.instruction.trim() || "(No extra instruction provided.)",
  ].join("\n");

  const messages: api.AiMessage[] = [...(history || []), { role: "user", content: userPrompt }];

  const params = actionParams(input.action);
  return api.aiComplete({
    config: input.config,
    systemPrompt,
    messages,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
  });
}

export async function runAiStream(
  input: AiRequestInput,
  history: api.AiMessage[] | undefined,
  onDelta: (delta: string) => void,
  sessionId?: string,
  onReasoningDelta?: (delta: string) => void,
  onToolTrace?: (trace: AiToolTrace) => void,
  onRelationRequest?: AiRelationRequestHandler,
  onTableChoiceRequest?: AiTableChoiceRequestHandler,
  onColumnChoiceRequest?: AiColumnChoiceRequestHandler,
  onEvent?: AiWorkflowEventHandler,
): Promise<void> {
  const isZh = currentLocale() === "zh-CN";
  const skill = aiSkillForAction(input.action);
  const systemPrompt = buildSystemPrompt(input.action, input.context, input.mode);
  const instruction = isZh ? skill.userInstruction.zh : skill.userInstruction.en;
  const userPrompt = [
    `Action: ${input.action}`,
    instruction,
    "",
    "User request:",
    input.instruction.trim() || "(No extra instruction provided.)",
  ].join("\n");

  const messages: api.AiMessage[] = [...(history || []), { role: "user", content: userPrompt }];

  const sid = sessionId || uuid();
  const params = actionParams(input.action);
  const maxTokens = input.config.enableThinking ? Math.max(params.maxTokens, 8192) : params.maxTokens;
  const mainNodeId = uuid();
  emitAiWorkflowEvent(onEvent, {
    type: "node.start",
    nodeId: mainNodeId,
    kind: "model",
    title: isZh ? "主模型分析" : "Main model reasoning",
    status: "loading",
  });

  const toolResult = await runAiToolLoop(
    input,
    messages,
    maxTokens,
    params.temperature,
    onReasoningDelta,
    onToolTrace,
    onRelationRequest,
    onTableChoiceRequest,
    onColumnChoiceRequest,
    onEvent,
    mainNodeId,
    onDelta,
  ).catch(() => undefined);
  if (toolResult != null) {
    emitAiWorkflowEvent(onEvent, {
      type: "node.update",
      nodeId: mainNodeId,
      status: "success",
      description: isZh ? "工具链路已完成" : "Tool loop completed",
    });
    if (toolResult) await emitBufferedText(toolResult, onDelta);
    return;
  }

  await api.aiStream(
    sid,
    {
      config: input.config,
      systemPrompt,
      messages,
      maxTokens,
      temperature: params.temperature,
    },
    (chunk) => {
      if (!chunk.done) {
        if (chunk.reasoning_delta) {
          emitAiWorkflowEvent(onEvent, { type: "node.delta", nodeId: mainNodeId, delta: chunk.reasoning_delta });
          onReasoningDelta?.(chunk.reasoning_delta);
        }
        if (chunk.delta) onDelta(chunk.delta);
      }
    },
  );
  emitAiWorkflowEvent(onEvent, {
    type: "node.update",
    nodeId: mainNodeId,
    status: "success",
    description: isZh ? "回答生成完成" : "Answer completed",
  });
}

async function emitBufferedText(text: string, onDelta: (delta: string) => void): Promise<void> {
  const chunks = chunkBufferedText(text);
  for (const chunk of chunks) {
    onDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

function chunkBufferedText(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  for (const part of text.split(/(\s+|[，。！？、；：,.!?;:])/u)) {
    if (!part) continue;
    current += part;
    if (current.length >= 24 || /[\n。！？.!?]/u.test(part)) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const MAX_SCHEMA_RAG_RELATED_TABLES = 5;
const MAX_AI_SCHEMA_SEARCH_CALLS = 10;
const MAX_AI_SCHEMA_TABLE_LOADS = 10;
const MAX_AI_TABLE_LIST_CALLS = 5;
const MAX_AI_COLUMN_SEARCH_CALLS = 30;
const MAX_AI_COLUMN_DETAIL_CALLS = 10;
const MAX_AI_TABLE_CHOICE_REQUESTS = 3;
const MAX_AI_COLUMN_CHOICE_REQUESTS = 5;
const MAX_AI_TABLE_CHOICE_CANDIDATES = 12;
const MAX_AI_COLUMN_CHOICE_CANDIDATES = 30;
const MAX_AI_RELATION_LOOKUPS = 6;
const MAX_AI_RELATION_REQUESTS = 3;
const MAX_AI_ENRICHMENT_SAVES = 3;
const MAX_AI_ENRICHMENT_ALIASES = 8;
const MAX_AI_TOOL_ROUNDS = 6;
const MAX_AI_SCHEMA_RESEARCH_TASKS = 3;
const MAX_SCHEMA_RESEARCH_TOOL_ROUNDS = 4;
const MAX_SCHEMA_RESEARCH_OUTPUT_TOKENS = 1800;
const MAX_SCHEMA_RESEARCH_TABLES = 4;
const MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE = 10;

function actionParams(action: AiAction): { maxTokens: number; temperature: number } {
  switch (action) {
    case "explain":
      return { maxTokens: 3200, temperature: 0.2 };
    case "sampleData":
      return { maxTokens: 2400, temperature: 0.1 };
    default:
      return { maxTokens: 2400, temperature: 0.15 };
  }
}

export function extractSql(text: string): string {
  const fenced = text.match(/```(?:sql|mysql|postgresql|sqlite|tsql|clickhouse)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

export function buildSystemPrompt(action: AiAction, context: AiContext, mode: AiAssistantMode = "ask"): string {
  const schema = formatSchema(context);
  const resultPreview = context.lastResultPreview ? `\nLast result preview:\n${context.lastResultPreview}\n` : "";
  const lastError = context.lastError ? `\nLast error:\n${context.lastError}\n` : "";

  const isZh = currentLocale() === "zh-CN";
  const schemaRag = context.schemaRagContext
    ? `\n${isZh ? "Schema 智能检索结果" : "Smart schema retrieval"}:\n${context.schemaRagContext}\n`
    : "";
  const schemaScope = context.schemaScope ?? "database";

  const lines: string[] = [
    ...buildBasePromptLines(isZh),
    ...buildModePromptLines(mode, isZh),
    ...buildActionPromptLines(action, isZh),
  ];

  if (context.truncated) {
    lines.push(
      isZh
        ? "Schema 已截断：如果请求可能涉及未出现的表或字段，不要猜测。请让用户用 @table 指定相关表，或先生成只读探索/元数据查询。"
        : "Schema is truncated: if the request may involve tables or columns not shown, do not guess. Ask the user to mention the relevant @table, or generate a read-only exploration query first.",
    );
  }
  if (schemaScope === "focused_table") {
    lines.push(
      isZh
        ? "Schema 上下文是当前打开的表；这不是完整数据库表清单。若用户询问库里有哪些表、表清单、全部表或未列出的表，请先生成只读元数据查询确认，不要把当前表当作全库，也不要直接断言不存在。"
        : "Schema context is focused table only; not a complete database table list. If the user asks for available tables, table inventory, all tables, or tables not shown here, generate a read-only metadata query first instead of treating the focused table as the whole database.",
    );
  }

  lines.push(
    isZh
      ? "返回 SQL 时放在 ```sql 代码块中。额外说明简短实用。"
      : "Put SQL in a fenced ```sql code block. Keep extra explanation short and practical.",
    "",
    `Database type: ${context.databaseType}`,
    `Connection: ${context.connectionName}`,
    `Database: ${context.database}`,
    schemaScope === "focused_table"
      ? "Schema context is focused table only; not a complete database table list."
      : context.truncated
        ? "Schema context is truncated."
        : "Schema context is complete.",
    "",
    `Current SQL:\n${context.currentSql.trim() || "(empty)"}`,
    lastError,
    resultPreview,
    schemaRag,
    `Schema:\n${schema}`,
  );

  return lines.filter(Boolean).join("\n");
}

function buildBasePromptLines(isZh: boolean): string[] {
  return [
    isZh ? "你是 DBX 内置的数据库助手。用中文回复。" : "You are DBX's built-in database assistant. Reply in English.",
    isZh
      ? "精确、保守，根据当前数据库方言生成 SQL。"
      : "Be precise, conservative, and adapt SQL to the active database dialect.",
    isZh
      ? "严格使用当前数据库方言；标识符引用、分页、日期函数、字符串拼接、LIMIT/TOP/OFFSET 语法必须匹配数据库类型。"
      : "Strictly use the active database dialect; identifier quoting, pagination, date functions, string concatenation, and LIMIT/TOP/OFFSET syntax must match the database type.",
    isZh
      ? "下面的 Schema 上下文已包含表、列、索引和外键信息，直接使用即可。不要查询 information_schema 或系统表来获取结构信息。"
      : "The schema context below already contains tables, columns, indexes, and foreign keys — use it directly. Do NOT query information_schema or system tables.",
    isZh
      ? "当用户要求分析或查看某个表时，生成 SELECT 查询获取数据，而不是查询元数据。"
      : "When the user asks to 'analyze' or 'look at' a table, generate a SELECT query to retrieve data, not a metadata query.",
    isZh ? "不要编造 Schema 中不存在的表或列。" : "Never invent tables or columns that are not in the schema context.",
    isZh
      ? "用户输入中的 @schema.table 或 @table 表示用户明确提到的表；这些表已优先放入 Schema 上下文。"
      : "User input may contain @schema.table or @table mentions. Treat them as explicit table references; mentioned tables are prioritized in the schema context.",
    isZh
      ? "不要生成多语句 SQL，除非用户明确要求。不要在同一个回答里混合 SELECT 和写操作。"
      : "Do not generate multi-statement SQL unless the user explicitly asks for it. Do not mix SELECT statements and write operations in the same answer.",
    isZh
      ? "对于 DROP、DELETE、TRUNCATE、ALTER 或没有 WHERE 的 UPDATE，简要警告并优先提供安全的 SELECT 预览。"
      : "For destructive statements (DROP, DELETE, TRUNCATE, ALTER, UPDATE without WHERE), warn briefly and prefer a safer SELECT preview.",
    isZh
      ? "对于 UPDATE 或 DELETE，必须带 WHERE 并说明影响范围；生产库写操作只给建议，不主动建议执行。"
      : "For UPDATE or DELETE, require a WHERE clause and explain the affected scope; for production writes, provide guidance but do not proactively suggest execution.",
  ];
}

function buildModePromptLines(mode: AiAssistantMode, isZh: boolean): string[] {
  if (mode === "rag") {
    return [
      isZh
        ? "你处于 RAG 模式。使用完整 Schema Research 工具链为表、字段、业务含义或接口文档映射取证，再生成最终 SQL 或说明。"
        : "You are in RAG mode. Use the full Schema Research tool chain to gather evidence for table, column, business-meaning, or API-doc mappings before producing final SQL or an explanation.",
      isZh
        ? "第一个 ```sql 代码块只能包含最终建议的 SQL；不要暗示已经执行、即将自动执行或需要系统自动执行。"
        : "The first ```sql code block must contain only the final suggested SQL. Do not imply that it has run, will auto-run, or should be auto-run by the system.",
      isZh
        ? "如果证据不足，先说明缺少哪些表、字段或关系，再给只读预览 SQL 或澄清问题。"
        : "If evidence is insufficient, explain which tables, columns, or relationships are missing, then provide a read-only preview SQL or a clarifying question.",
    ];
  }

  if (mode === "agent") {
    return [
      isZh
        ? "你处于 Agent 模式。用户表达查询意图时，优先生成一个可直接执行的只读 SQL。"
        : "You are in Agent mode. When the user expresses query intent, prioritize one directly executable read-only SQL statement.",
      isZh
        ? "第一个 ```sql 代码块只能包含最终推荐执行的 SQL；不要把解释性 SQL、备选 SQL、危险 SQL 放在第一个代码块。"
        : "The first ```sql code block must contain only the final SQL recommended for execution; do not put explanatory SQL, alternatives, or risky SQL in the first code block.",
      isZh
        ? "如果安全执行条件不满足，先说明原因，再给只读预览或澄清问题。"
        : "If safe execution requirements are not met, explain why first, then provide a read-only preview or a clarifying question.",
    ];
  }

  return [
    isZh
      ? "你处于 Ask 模式。只生成 SQL 和说明，不要暗示已经执行或即将自动执行。"
      : "You are in Ask mode. Generate SQL and explanations only; do not imply that anything has run or will auto-run.",
  ];
}

function buildActionPromptLines(action: AiAction, isZh: boolean): string[] {
  const skill = aiSkillForAction(action);
  return isZh
    ? [...skill.systemRules.zh, ...skill.outputContract.zh]
    : [...skill.systemRules.en, ...skill.outputContract.en];
}

export function supportsAiSchemaToolLoop(config: AiConfig, context: AiContext): boolean {
  if (!context.connectionId || !context.schema) return false;
  if (["redis", "mongodb"].includes(context.databaseType)) return false;
  if (config.apiStyle !== "completions") return false;
  return !["claude", "gemini"].includes(config.provider);
}

async function runAiToolLoop(
  input: AiRequestInput,
  userMessages: api.AiMessage[],
  maxTokens: number,
  temperature: number,
  onReasoningDelta?: (delta: string) => void,
  onToolTrace?: (trace: AiToolTrace) => void,
  onRelationRequest?: AiRelationRequestHandler,
  onTableChoiceRequest?: AiTableChoiceRequestHandler,
  onColumnChoiceRequest?: AiColumnChoiceRequestHandler,
  onEvent?: AiWorkflowEventHandler,
  mainNodeId?: string,
  onDelta?: (delta: string) => void,
): Promise<string | undefined> {
  if (!supportsAiSchemaToolLoop(input.config, input.context)) return undefined;

  const isZh = currentLocale() === "zh-CN";
  const messages: any[] = userMessages.map((message) => ({ role: message.role, content: message.content }));
  const tools = buildAiSchemaTools({ scope: "main" });
  const budget = createAiSchemaToolBudget();
  let pendingEvidenceGate: SchemaResearchEvidenceGate | undefined;
  let evidenceGateInstructionUsed = false;

  for (let round = 0; round < MAX_AI_TOOL_ROUNDS; round += 1) {
    if (mainNodeId) {
      emitAiWorkflowEvent(onEvent, {
        type: "node.update",
        nodeId: mainNodeId,
        status: "loading",
        description: isZh
          ? `主模型正在决定下一步（第 ${round + 1} 轮）`
          : `Main model is deciding the next step (round ${round + 1})`,
      });
    }
    const response = await runRawChatForToolLoop(
      {
        config: input.config,
        systemPrompt: buildToolSystemPrompt(input.action, input.context, input.mode),
        messages,
        tools,
        toolChoice: "auto",
        maxTokens,
        temperature,
      },
      {
        mainNodeId,
        onEvent,
        onReasoningDelta,
        onDelta,
      },
    );
    const assistantMessage = normalizeRawAssistantMessage(response.rawMessage, response.content, response.toolCalls);
    messages.push(assistantMessage);
    const reasoningContent = response.__reasoningStreamed ? "" : rawMessageReasoningContent(response.rawMessage);
    if (reasoningContent) {
      if (mainNodeId)
        emitAiWorkflowEvent(onEvent, { type: "node.delta", nodeId: mainNodeId, delta: `${reasoningContent}\n\n` });
      onReasoningDelta?.(`${reasoningContent}\n\n`);
    }
    if (!response.toolCalls.length) {
      const gateInstruction = buildSchemaResearchEvidenceGateInstruction(pendingEvidenceGate, isZh);
      if (gateInstruction) {
        if (evidenceGateInstructionUsed) {
          return buildSchemaResearchEvidenceGateFallbackResponse(pendingEvidenceGate, isZh);
        }
        messages.push({
          role: "user",
          content: gateInstruction,
        });
        if (mainNodeId) {
          emitAiWorkflowEvent(onEvent, {
            type: "node.update",
            nodeId: mainNodeId,
            status: pendingEvidenceGate?.status === "need_user_choice" ? "waiting" : "loading",
            description: isZh
              ? "Schema Research 证据不足，要求主模型继续检索或向用户确认"
              : "Schema Research evidence is insufficient; asking the main model to continue or ask the user",
          });
        }
        evidenceGateInstructionUsed = true;
        continue;
      }
      return response.__contentStreamed ? "" : response.content;
    }

    for (const call of response.toolCalls) {
      const toolNodeId = call.id || uuid();
      emitAiWorkflowEvent(onEvent, {
        type: "tool.start",
        nodeId: toolNodeId,
        parentId: mainNodeId,
        name: call.name,
        arguments: formatSchemaToolArguments(call),
      });
      if (isUserChoiceSchemaTool(call.name)) {
        emitAiWorkflowEvent(onEvent, {
          type: "user.input.required",
          nodeId: `${toolNodeId}:input`,
          parentId: toolNodeId,
          requestKind: userChoiceSchemaToolKind(call.name),
          title: userChoiceSchemaToolTitle(call.name, isZh),
        });
      }
      onToolTrace?.(buildRunningSchemaToolTrace(call));
      const output = await executeAiSchemaToolCall(
        input,
        input.context,
        budget,
        call.name,
        call.arguments,
        onRelationRequest,
        onTableChoiceRequest,
        onColumnChoiceRequest,
        {
          onEvent,
          parentNodeId: toolNodeId,
        },
      ).catch((error) => ({
        error: error?.message || String(error),
      }));
      const completedTrace = buildCompletedSchemaToolTrace(call, output, isZh);
      const nextEvidenceGate = mergeSchemaResearchEvidenceGate(pendingEvidenceGate, call.name, output);
      if (nextEvidenceGate !== pendingEvidenceGate) evidenceGateInstructionUsed = false;
      pendingEvidenceGate = nextEvidenceGate;
      if (isUserChoiceSchemaTool(call.name)) {
        emitAiWorkflowEvent(onEvent, {
          type: "node.update",
          nodeId: `${toolNodeId}:input`,
          status: userChoiceSchemaToolResultStatus(completedTrace.status, output),
          description: completedTrace.summary,
        });
      }
      emitAiWorkflowEvent(onEvent, {
        type: "tool.end",
        nodeId: toolNodeId,
        status: completedTrace.status === "error" ? "error" : "success",
        summary: completedTrace.summary,
      });
      onToolTrace?.(completedTrace);
      if (isCancelledUserChoiceOutput(call.name, output)) return "";
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(stripUiOnlyToolOutput(output)),
      });
    }
  }

  messages.push({
    role: "user",
    content: isZh
      ? "工具调用预算已用完。请只基于已经返回的工具结果生成最终 SQL；如果信息不足，请明确说明缺少哪些表或字段。"
      : "The tool-call budget is exhausted. Generate the final SQL only from returned tool results; if information is insufficient, state which tables or columns are missing.",
  });
  const finalResponse = await runRawChatForToolLoop(
    {
      config: input.config,
      systemPrompt: buildToolSystemPrompt(input.action, input.context, input.mode),
      messages,
      tools: [],
      maxTokens,
      temperature,
    },
    {
      mainNodeId,
      onEvent,
      onReasoningDelta,
      onDelta,
    },
  );
  return finalResponse.__contentStreamed ? "" : finalResponse.content;
}

type AiRawChatToolLoopResponse = api.AiRawChatResponse & {
  __contentStreamed?: boolean;
  __reasoningStreamed?: boolean;
};

async function runRawChatForToolLoop(
  request: api.AiRawChatRequest,
  hooks: {
    mainNodeId?: string;
    onEvent?: AiWorkflowEventHandler;
    onReasoningDelta?: (delta: string) => void;
    onDelta?: (delta: string) => void;
  },
): Promise<AiRawChatToolLoopResponse> {
  if (!supportsDeepSeekRawChatStream(request.config)) {
    return api.aiRawChat(request);
  }

  const sid = uuid();
  const canStreamContentLive = request.tools.length === 0;
  let contentStreamed = false;
  let reasoningStreamed = false;
  let sawToolCall = false;
  let response: api.AiRawChatResponse;
  try {
    response = await api.aiRawChatStream(sid, request, (chunk) => {
      if (chunk.done) return;
      if (chunk.reasoning_delta) {
        reasoningStreamed = true;
        emitAiWorkflowEvent(hooks.onEvent, {
          type: "node.delta",
          nodeId: hooks.mainNodeId || sid,
          delta: chunk.reasoning_delta,
        });
        hooks.onReasoningDelta?.(chunk.reasoning_delta);
      }
      if (chunk.tool_call_delta) {
        sawToolCall = true;
        emitAiWorkflowEvent(hooks.onEvent, {
          type: "node.update",
          nodeId: hooks.mainNodeId || sid,
          status: "loading",
          description:
            currentLocale() === "zh-CN" ? "模型正在准备工具调用参数" : "Model is preparing tool-call arguments",
        });
      }
      if (chunk.delta && canStreamContentLive && !sawToolCall) {
        contentStreamed = true;
        hooks.onDelta?.(chunk.delta);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const description =
      currentLocale() === "zh-CN"
        ? `DeepSeek 流式工具调用不可用，已退回非流式工具调用${message ? `：${message}` : ""}`
        : `DeepSeek streaming tool calls are unavailable; falling back to non-streaming tool calls${
            message ? `: ${message}` : ""
          }`;
    emitAiWorkflowEvent(hooks.onEvent, {
      type: "node.update",
      nodeId: hooks.mainNodeId || sid,
      status: "loading",
      description,
    });
    return api.aiRawChat(request);
  }

  return {
    ...response,
    __contentStreamed: contentStreamed && response.toolCalls.length === 0,
    __reasoningStreamed: reasoningStreamed,
  };
}

function supportsDeepSeekRawChatStream(config: AiConfig): boolean {
  return config.provider === "deepseek" && config.apiStyle === "completions";
}

const API_DOC_EXTRACTION_SECTIONS_PER_BATCH = 3;

interface ApiDocExtractionBatchMetadata {
  batchIndex: number;
  batchCount: number;
  totalSections: number;
  omittedBefore: boolean;
  omittedAfter: boolean;
  previousContext?: ApiDocExtractionContinuationContext;
}

interface ApiDocExtractionContinuationContext {
  recentTables: string[];
  recentColumns: string[];
}

function buildApiDocExtractionSystemPrompt(): string {
  const isZh = currentLocale() === "zh-CN";
  return isZh
    ? [
        "你是 DBX 表结构/数据字典参考文档 GraphRAG 抽取子任务模型。只输出 JSON 对象，不要 Markdown。",
        "用户文档可能是表结构文档、数据字典、字段说明、业务口径说明、Word/PDF 转 Markdown 后的随意表格，或任何跟数据库表、字段、关系有关的参考文档。",
        "你只能从用户提供的 Markdown 章节中抽取事实，不能标记 verified，不能编造文档里没有的表名或字段名。",
        "如果文档只说明中文业务含义，没有明确英文表名或字段名，就保留业务词并让 candidateTable/candidateColumn 为 null。",
        "如果当前批次开头缺少表名/表上下文，但 previousContext 提供了最近表名，并且当前字段明显延续上一批表格，可使用 previousContext 的表名作为 candidateTable。",
        "尽量识别随意表格里的列含义，例如表中文名、表英文名、字段中文名、字段英文名、字段说明、数据类型、主键、外键、关联表。",
        "多字段关联必须使用 leftColumns/rightColumns 数组，左右数量必须一致。",
        "顶层 apiFields、businessConcepts、joinCandidates、errors 四个数组必须永远存在，即使为空数组。",
        "数组元素只能使用用户提示 outputContract 中列出的字段；不要自创字段名，不要输出尾逗号或相邻对象漏逗号。",
        "sectionId 必须来自输入 sections[].id；candidateTable/candidateColumn 必须保留文档中的原始英文标识，不要翻译或改写大小写。",
        "输出必须精简：没有值的 key 不要输出；不要输出 null、空字符串、空数组字段；只保留必要字段。",
        '输出 JSON 结构：{"apiFields":[],"businessConcepts":[],"joinCandidates":[],"errors":[]}',
      ].join("\n")
    : [
        "You are the DBX table schema/data-dictionary reference document GraphRAG extraction subtask model. Output one JSON object only, no Markdown.",
        "The document may be a schema document, data dictionary, column description sheet, business-rule note, Word/PDF-to-Markdown table, or any informal reference about database tables, columns, and relationships.",
        "Extract facts only from the supplied Markdown sections. Do not mark facts verified and do not invent table or column names absent from the document.",
        "If the document gives only business meaning without an explicit English table or column name, keep the business term and set candidateTable/candidateColumn to null.",
        "If the current batch starts without table context but previousContext contains recent tables, and the fields clearly continue the previous table, use that table as candidateTable.",
        "Recognize informal table columns such as Chinese table name, English table name, Chinese column name, English column name, description, data type, primary key, foreign key, and related table.",
        "Multi-column relationships must use leftColumns/rightColumns arrays with equal length.",
        "Top-level apiFields, businessConcepts, joinCandidates, and errors arrays must always be present, even when empty.",
        "Array items may only use fields listed in outputContract. Do not invent field names, trailing commas, or adjacent objects without commas.",
        "sectionId must come from input sections[].id. candidateTable/candidateColumn must preserve the original documented English identifiers without translation or case rewriting.",
        "Keep output compact: omit keys with no value; do not emit null, empty string, or empty array properties; keep only necessary keys.",
        'Output JSON shape: {"apiFields":[],"businessConcepts":[],"joinCandidates":[],"errors":[]}',
      ].join("\n");
}

function buildApiDocExtractionUserPrompt(
  request: ApiDocExtractionRequest,
  metadata: ApiDocExtractionBatchMetadata = apiDocSingleBatchMetadata(request),
): string {
  const sections = request.sections.map((section) => ({
    id: section.id,
    titlePath: section.titlePath,
    text: section.text,
  }));
  return JSON.stringify(
    {
      sourceId: request.sourceId,
      sourcePath: request.sourcePath,
      schema: request.schema,
      batch: {
        batchIndex: metadata.batchIndex,
        batchCount: metadata.batchCount,
        totalSections: metadata.totalSections,
        omittedBefore: metadata.omittedBefore,
        omittedAfter: metadata.omittedAfter,
        note:
          metadata.omittedBefore || metadata.omittedAfter
            ? "This prompt contains only a slice of the full document. Do not infer facts from omitted chunks."
            : "This prompt contains the full extraction slice for this document.",
      },
      previousContext: metadata.previousContext || { recentTables: [], recentColumns: [] },
      instructions: {
        apiFields:
          "Return documented table/column fields with meaning and optional candidateTable/candidateColumn if the document states or strongly implies a database mapping.",
        businessConcepts:
          "Return business terms, Chinese table names, or entities that may map to a table or column. Do not invent targets.",
        joinCandidates: "Return candidate table relationships only when the document contains evidence for both sides.",
        continuation:
          "If this batch begins in the middle of a table and lacks table headers, inspect previousContext. Use previousContext only when the current fields clearly continue that same table.",
        outputCompaction:
          "Omit candidateSchema/candidateTable/candidateColumn/confidence/evidence/sectionId and any other optional key when there is no concrete value. Never output null or empty-string keys.",
      },
      outputContract: {
        topLevelKeys: ["apiFields", "businessConcepts", "joinCandidates", "errors"],
        apiFields: {
          required: ["name", "meaning", "sectionId"],
          optional: ["candidateSchema", "candidateTable", "candidateColumn", "confidence", "evidence"],
          item: {
            name: "Documented field name or business-facing field label. Prefer the explicit English column identifier when present.",
            meaning: "Chinese/English business meaning, field comment, or concise description from the document.",
            sectionId: "One of sections[].id from this prompt.",
            candidateSchema: "Only when the document explicitly states a schema.",
            candidateTable: "Original documented table identifier, for example MC_BIRTH_APPLY.",
            candidateColumn: "Original documented column identifier, for example APPLY_STATUS.",
            confidence: "Number from 0 to 1. Omit if unsure.",
            evidence: "Short source phrase from the section. Omit if it would be empty.",
          },
        },
        businessConcepts: {
          required: ["term", "description", "sectionId"],
          optional: ["candidateSchema", "candidateTable", "candidateColumn", "confidence", "evidence"],
          item: {
            term: "Business term, Chinese table name, entity name, metric name, or informal field/table label.",
            description: "Meaning or business rule stated by the document.",
            sectionId: "One of sections[].id from this prompt.",
            candidateSchema: "Only when explicitly stated.",
            candidateTable:
              "Mapped table identifier only when stated or strongly implied by the same table row/header.",
            candidateColumn:
              "Mapped column identifier only when stated or strongly implied by the same table row/header.",
            confidence: "Number from 0 to 1. Omit if unsure.",
            evidence: "Short source phrase from the section. Omit if it would be empty.",
          },
        },
        joinCandidates: {
          required: ["leftTable", "leftColumns", "rightTable", "rightColumns", "sectionId"],
          optional: ["leftSchema", "rightSchema", "relation", "confidence", "evidence"],
          item: {
            leftTable: "Original documented left/source table identifier.",
            leftColumns: "Array of one or more documented left/source column identifiers.",
            rightTable: "Original documented right/target table identifier.",
            rightColumns:
              "Array of one or more documented right/target column identifiers. Length must equal leftColumns length.",
            sectionId: "One of sections[].id from this prompt.",
            leftSchema: "Only when explicitly stated.",
            rightSchema: "Only when explicitly stated.",
            relation:
              "Short relationship description, for example foreign_key, parent_child, lookup, same_business_key.",
            confidence: "Number from 0 to 1. Omit if unsure.",
            evidence: "Short source phrase from the section. Omit if it would be empty.",
          },
        },
        errors: {
          item: "Short string only for extraction warnings, truncation uncertainty, or document ambiguity. Use [] when there is no warning.",
        },
        rules: [
          "Return exactly one valid JSON object and no Markdown fence.",
          "Top-level arrays must always be present: apiFields, businessConcepts, joinCandidates, errors.",
          "Do not output id, sourceId, extractedAt, status, verified, candidate, null, undefined, empty string, or empty optional arrays.",
          "Do not output optional keys when their values are unknown.",
          "Do not invent table or column identifiers that are absent from the supplied sections or previousContext continuation.",
          "Before final output, mentally validate that JSON.parse(output) would succeed: every array element must be comma-separated and there must be no trailing commas.",
        ],
      },
      outputExamples: {
        apiFields: [
          {
            name: "APPLY_STATUS",
            meaning: "申请状态",
            sectionId: sections[0]?.id || "section-id-from-input",
            candidateTable: "MC_BIRTH_APPLY",
            candidateColumn: "APPLY_STATUS",
            confidence: 0.86,
            evidence: "字段英文名 APPLY_STATUS，字段中文名 申请状态，表英文名 MC_BIRTH_APPLY",
          },
        ],
        businessConcepts: [
          {
            term: "出生证申请表",
            description: "出生证申请相关业务表",
            sectionId: sections[0]?.id || "section-id-from-input",
            candidateTable: "MC_BIRTH_APPLY",
            confidence: 0.82,
            evidence: "表中文名 出生证申请表，表英文名 MC_BIRTH_APPLY",
          },
        ],
        joinCandidates: [
          {
            leftTable: "MC_BIRTH_APPLY",
            leftColumns: ["MOTHER_ID", "CHILD_ID"],
            rightTable: "MC_BIRTH_CHILD",
            rightColumns: ["MOTHER_ID", "CHILD_ID"],
            sectionId: sections[0]?.id || "section-id-from-input",
            relation: "same_business_key",
            confidence: 0.78,
            evidence: "MOTHER_ID + CHILD_ID 关联出生证申请与儿童信息",
          },
        ],
        errors: [],
      },
      sections,
    },
    null,
    2,
  );
}

function apiDocSingleBatchMetadata(request: ApiDocExtractionRequest): ApiDocExtractionBatchMetadata {
  return {
    batchIndex: 1,
    batchCount: 1,
    totalSections: request.sections.length,
    omittedBefore: false,
    omittedAfter: false,
  };
}

function buildApiDocExtractionBatches(request: ApiDocExtractionRequest): Array<{
  request: ApiDocExtractionRequest;
  metadata: ApiDocExtractionBatchMetadata;
}> {
  const batchCount = Math.max(1, Math.ceil(request.sections.length / API_DOC_EXTRACTION_SECTIONS_PER_BATCH));
  const batches: Array<{ request: ApiDocExtractionRequest; metadata: ApiDocExtractionBatchMetadata }> = [];
  for (let start = 0; start < request.sections.length; start += API_DOC_EXTRACTION_SECTIONS_PER_BATCH) {
    const sections = request.sections.slice(start, start + API_DOC_EXTRACTION_SECTIONS_PER_BATCH);
    const batchIndex = batches.length + 1;
    batches.push({
      request: { ...request, sections },
      metadata: {
        batchIndex,
        batchCount,
        totalSections: request.sections.length,
        omittedBefore: start > 0,
        omittedAfter: start + sections.length < request.sections.length,
      },
    });
  }
  if (!batches.length) {
    batches.push({
      request: { ...request, sections: [] },
      metadata: apiDocSingleBatchMetadata(request),
    });
  }
  return batches;
}

export function buildApiDocExtractionBatchesForTest(request: ApiDocExtractionRequest) {
  return buildApiDocExtractionBatches(request);
}

export function buildApiDocExtractionUserPromptForTest(
  request: ApiDocExtractionRequest,
  metadata?: ApiDocExtractionBatchMetadata,
): string {
  return buildApiDocExtractionUserPrompt(request, metadata);
}

function buildApiDocExtractionJsonRepairSystemPrompt(): string {
  const isZh = currentLocale() === "zh-CN";
  return isZh
    ? [
        "你是 JSON 格式修复器。只输出合法 JSON 对象，不要 Markdown，不要解释。",
        "只能修复语法格式，不能新增、删除或改写事实。",
        '输出结构必须仍然是：{"apiFields":[],"businessConcepts":[],"joinCandidates":[],"errors":[]}',
      ].join("\n")
    : [
        "You are a JSON syntax repair tool. Output one valid JSON object only. No Markdown and no explanation.",
        "Repair syntax only. Do not add, remove, or rewrite factual content.",
        'The output shape must remain: {"apiFields":[],"businessConcepts":[],"joinCandidates":[],"errors":[]}',
      ].join("\n");
}

function buildApiDocExtractionJsonRepairPrompt(content: string, parseError: unknown): string {
  const isZh = currentLocale() === "zh-CN";
  const errorMessage = errorMessageText(parseError);
  const clippedContent = clipTextMiddle(content, 24000);
  return isZh
    ? [
        "下面是一次表结构/数据字典参考文档 GraphRAG 抽取的模型输出，但它不是合法 JSON。",
        "请只修复 JSON 语法错误，保留原有事实、字段名、表名、证据和数组内容。",
        "不要输出 Markdown 代码块，不要输出解释文字。",
        `解析错误：${errorMessage || "unknown"}`,
        "原始输出：",
        clippedContent,
      ].join("\n")
    : [
        "The following table schema/data-dictionary reference document GraphRAG extraction output is not valid JSON.",
        "Repair JSON syntax only while preserving the original facts, field names, table names, evidence, and arrays.",
        "Do not output Markdown fences and do not add explanatory text.",
        `Parse error: ${errorMessage || "unknown"}`,
        "Original output:",
        clippedContent,
      ].join("\n");
}

function normalizeApiDocExtractionResponse(
  request: ApiDocExtractionRequest,
  content: string,
): SchemaRagApiDocExtraction {
  const parsed = parseJsonObjectFromText(content);
  const extractedAt = new Date().toISOString();
  const apiFields = normalizeApiFieldFacts(request, parsed.apiFields, extractedAt);
  const businessConcepts = normalizeBusinessConceptFacts(request, parsed.businessConcepts, extractedAt);
  const joinCandidates = normalizeJoinCandidateFacts(request, parsed.joinCandidates, extractedAt);
  const errors = Array.isArray(parsed.errors)
    ? parsed.errors.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    sourceId: request.sourceId,
    extractedAt,
    status: summarizeFrontendExtractionStatus(apiFields, businessConcepts, joinCandidates, errors),
    apiFields,
    businessConcepts,
    joinCandidates,
    errors,
  };
}

function normalizeApiFieldFacts(
  request: ApiDocExtractionRequest,
  value: unknown,
  extractedAt: string,
): SchemaRagApiFieldFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = optionalToolString(data.name);
      const meaning = optionalToolString(data.meaning) || optionalToolString(data.description) || "";
      const sectionId = normalizeExtractionSectionId(request, data.sectionId);
      if (!name || !sectionId) return null;
      const fact: SchemaRagApiFieldFact = {
        id:
          optionalToolString(data.id) ||
          `api-field:${request.sourceId}:${index + 1}:${hashLite(`${name}:${extractedAt}`)}`,
        sourceId: request.sourceId,
        sectionId,
        name,
        meaning,
        candidateSchema: optionalToolString(data.candidateSchema) || null,
        candidateTable: optionalToolString(data.candidateTable) || null,
        candidateColumn: optionalToolString(data.candidateColumn) || null,
        status: "candidate" as const,
        confidence: clampConfidence(data.confidence),
        evidence: optionalToolString(data.evidence) || "",
      };
      return fact;
    })
    .filter((item): item is SchemaRagApiFieldFact => !!item);
}

function normalizeBusinessConceptFacts(
  request: ApiDocExtractionRequest,
  value: unknown,
  extractedAt: string,
): SchemaRagBusinessConceptFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const term = optionalToolString(data.term) || optionalToolString(data.name);
      const description = optionalToolString(data.description) || optionalToolString(data.meaning) || "";
      const sectionId = normalizeExtractionSectionId(request, data.sectionId);
      if (!term || !sectionId) return null;
      const fact: SchemaRagBusinessConceptFact = {
        id:
          optionalToolString(data.id) ||
          `api-concept:${request.sourceId}:${index + 1}:${hashLite(`${term}:${extractedAt}`)}`,
        sourceId: request.sourceId,
        sectionId,
        term,
        description,
        candidateSchema: optionalToolString(data.candidateSchema) || null,
        candidateTable: optionalToolString(data.candidateTable) || null,
        candidateColumn: optionalToolString(data.candidateColumn) || null,
        status: "candidate" as const,
        confidence: clampConfidence(data.confidence),
        evidence: optionalToolString(data.evidence) || "",
      };
      return fact;
    })
    .filter((item): item is SchemaRagBusinessConceptFact => !!item);
}

function normalizeJoinCandidateFacts(
  request: ApiDocExtractionRequest,
  value: unknown,
  extractedAt: string,
): SchemaRagJoinCandidateFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const leftTable = optionalToolString(data.leftTable);
      const rightTable = optionalToolString(data.rightTable);
      const leftColumns = stringArrayValue(data.leftColumns);
      const rightColumns = stringArrayValue(data.rightColumns);
      const sectionId = normalizeExtractionSectionId(request, data.sectionId);
      if (!leftTable || !rightTable || !leftColumns.length || !rightColumns.length || !sectionId) return null;
      const fact: SchemaRagJoinCandidateFact = {
        id:
          optionalToolString(data.id) ||
          `api-join:${request.sourceId}:${index + 1}:${hashLite(`${leftTable}:${rightTable}:${extractedAt}`)}`,
        sourceId: request.sourceId,
        sectionId,
        leftSchema: optionalToolString(data.leftSchema) || request.schema,
        leftTable,
        leftColumns,
        rightSchema: optionalToolString(data.rightSchema) || request.schema,
        rightTable,
        rightColumns,
        relation: optionalToolString(data.relation) || "",
        status: "candidate" as const,
        confidence: clampConfidence(data.confidence),
        evidence: optionalToolString(data.evidence) || "",
      };
      return fact;
    })
    .filter((item): item is SchemaRagJoinCandidateFact => !!item);
}

function summarizeFrontendExtractionStatus(
  apiFields: SchemaRagApiFieldFact[],
  businessConcepts: SchemaRagBusinessConceptFact[],
  joinCandidates: SchemaRagJoinCandidateFact[],
  errors: string[],
): ApiDocExtractionStatus {
  const facts = apiFields.length + businessConcepts.length + joinCandidates.length;
  if (!facts) return errors.length ? "failed" : "pending";
  return errors.length ? "partial" : "extracted";
}

function normalizeExtractionSectionId(request: ApiDocExtractionRequest, value: unknown): string | null {
  const id = optionalToolString(value);
  if (id && request.sections.some((section) => section.id === id)) return id;
  return request.sections[0]?.id || null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function parseJsonObjectFromText(text: string): Record<string, any> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return assertJsonObject(JSON.parse(trimmed));
  } catch (fullTextError) {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) throw fullTextError;
    return assertJsonObject(JSON.parse(match[0]));
  }
}

export function parseApiDocExtractionJsonForTest(text: string): Record<string, any> {
  return parseJsonObjectFromText(text);
}

type SchemaDocRawChatDebugLabel = "schema-doc-extraction" | "schema-doc-json-repair";

function schemaDocRawChatOptions(
  config: AiConfig,
  debugLabel: SchemaDocRawChatDebugLabel = "schema-doc-extraction",
): Pick<api.AiRawChatRequest, "debugLabel" | "responseFormat"> {
  return {
    debugLabel,
    responseFormat: config.provider === "deepseek" ? { type: "json_object" } : undefined,
  };
}

export function schemaDocRawChatOptionsForTest(
  config: AiConfig,
): Pick<api.AiRawChatRequest, "debugLabel" | "responseFormat"> {
  return schemaDocRawChatOptions(config);
}

function assertJsonObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as Record<string, any>;
}

function rawMessageContent(rawMessage: unknown): string {
  if (!rawMessage || typeof rawMessage !== "object") return "";
  const content = (rawMessage as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

function errorMessageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function clipTextMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n... DBX_JSON_REPAIR_INPUT_TRUNCATED ...\n${text.slice(-half)}`;
}

function hashLite(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function extractApiDocGraphFactsWithSchemaResearch(
  config: AiConfig,
  request: ApiDocExtractionRequest,
): Promise<SchemaRagApiDocExtraction> {
  const researchSettings = resolveSchemaResearchSettings(config);
  if (!researchSettings.enabled) {
    throw new Error("Schema Research model is disabled in AI settings.");
  }
  if (!supportsSchemaResearchModel(researchSettings.config)) {
    throw new Error("Schema Research API doc extraction requires a /chat/completions-compatible provider.");
  }
  const batches = buildApiDocExtractionBatches(request);
  const batchExtractions: SchemaRagApiDocExtraction[] = [];
  let previousContext: ApiDocExtractionContinuationContext = { recentTables: [], recentColumns: [] };

  for (const batch of batches) {
    const extraction = await extractApiDocGraphFactsBatchWithSchemaResearch(researchSettings, batch.request, {
      ...batch.metadata,
      previousContext,
    });
    batchExtractions.push(extraction);
    previousContext = summarizeApiDocExtractionContinuationContext(batchExtractions);
  }

  return mergeApiDocExtractionBatches(request, batchExtractions);
}

async function extractApiDocGraphFactsBatchWithSchemaResearch(
  researchSettings: ResolvedSchemaResearchSettings,
  request: ApiDocExtractionRequest,
  metadata: ApiDocExtractionBatchMetadata,
): Promise<SchemaRagApiDocExtraction> {
  const response = await runRawChatForToolLoop(
    {
      config: researchSettings.config,
      systemPrompt: buildApiDocExtractionSystemPrompt(),
      messages: [{ role: "user", content: buildApiDocExtractionUserPrompt(request, metadata) }],
      tools: [],
      toolChoice: "none",
      maxTokens: researchSettings.maxOutputTokens,
      temperature: 0,
      ...schemaDocRawChatOptions(researchSettings.config),
    },
    {},
  );
  const content = response.content || rawMessageContent(response.rawMessage);
  try {
    return normalizeApiDocExtractionResponse(request, content);
  } catch (parseError) {
    const repairedContent = await repairApiDocExtractionJson(researchSettings, content, parseError);
    try {
      return normalizeApiDocExtractionResponse(request, repairedContent);
    } catch (repairError) {
      const originalMessage = errorMessageText(parseError);
      const repairMessage = errorMessageText(repairError);
      throw new Error(
        `API document extraction returned invalid JSON${originalMessage ? `: ${originalMessage}` : ""}. JSON repair failed${
          repairMessage ? `: ${repairMessage}` : ""
        }`,
      );
    }
  }
}

function mergeApiDocExtractionBatches(
  request: ApiDocExtractionRequest,
  extractions: SchemaRagApiDocExtraction[],
): SchemaRagApiDocExtraction {
  const extractedAt = new Date().toISOString();
  const apiFields = uniqueBy(
    extractions.flatMap((extraction) => extraction.apiFields),
    (fact) =>
      [
        fact.sectionId,
        fact.name,
        fact.candidateSchema || "",
        fact.candidateTable || "",
        fact.candidateColumn || "",
        fact.meaning,
      ].join("\u0001"),
  );
  const businessConcepts = uniqueBy(
    extractions.flatMap((extraction) => extraction.businessConcepts),
    (fact) =>
      [
        fact.sectionId,
        fact.term,
        fact.candidateSchema || "",
        fact.candidateTable || "",
        fact.candidateColumn || "",
        fact.description,
      ].join("\u0001"),
  );
  const joinCandidates = uniqueBy(
    extractions.flatMap((extraction) => extraction.joinCandidates),
    (fact) =>
      [
        fact.sectionId,
        fact.leftSchema,
        fact.leftTable,
        fact.leftColumns.join(","),
        fact.rightSchema,
        fact.rightTable,
        fact.rightColumns.join(","),
        fact.relation,
      ].join("\u0001"),
  );
  const errors = extractions.flatMap((extraction) => extraction.errors).filter(Boolean);
  return {
    sourceId: request.sourceId,
    extractedAt,
    status: summarizeFrontendExtractionStatus(apiFields, businessConcepts, joinCandidates, errors),
    apiFields,
    businessConcepts,
    joinCandidates,
    errors,
  };
}

function summarizeApiDocExtractionContinuationContext(
  extractions: SchemaRagApiDocExtraction[],
): ApiDocExtractionContinuationContext {
  const recentTables: string[] = [];
  const recentColumns: string[] = [];
  for (const extraction of extractions.slice(-2)) {
    for (const fact of extraction.apiFields) {
      if (fact.candidateTable) {
        pushRecentUnique(recentTables, tableRef(fact.candidateSchema, fact.candidateTable));
      }
      if (fact.candidateTable && fact.candidateColumn) {
        pushRecentUnique(recentColumns, columnRef(fact.candidateSchema, fact.candidateTable, fact.candidateColumn));
      }
    }
    for (const fact of extraction.businessConcepts) {
      if (fact.candidateTable) {
        pushRecentUnique(recentTables, tableRef(fact.candidateSchema, fact.candidateTable));
      }
      if (fact.candidateTable && fact.candidateColumn) {
        pushRecentUnique(recentColumns, columnRef(fact.candidateSchema, fact.candidateTable, fact.candidateColumn));
      }
    }
    for (const fact of extraction.joinCandidates) {
      pushRecentUnique(recentTables, tableRef(fact.leftSchema, fact.leftTable));
      pushRecentUnique(recentTables, tableRef(fact.rightSchema, fact.rightTable));
    }
  }
  return {
    recentTables: recentTables.slice(-8),
    recentColumns: recentColumns.slice(-12),
  };
}

function tableRef(schema: string | null | undefined, table: string): string {
  return schema ? `${schema}.${table}` : table;
}

function columnRef(schema: string | null | undefined, table: string, column: string): string {
  return `${tableRef(schema, table)}.${column}`;
}

function pushRecentUnique(values: string[], value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const existing = values.findIndex((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (existing >= 0) values.splice(existing, 1);
  values.push(trimmed);
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function repairApiDocExtractionJson(
  researchSettings: ResolvedSchemaResearchSettings,
  content: string,
  parseError: unknown,
): Promise<string> {
  const response = await runRawChatForToolLoop(
    {
      config: researchSettings.config,
      systemPrompt: buildApiDocExtractionJsonRepairSystemPrompt(),
      messages: [{ role: "user", content: buildApiDocExtractionJsonRepairPrompt(content, parseError) }],
      tools: [],
      toolChoice: "none",
      maxTokens: researchSettings.maxOutputTokens,
      temperature: 0,
      ...schemaDocRawChatOptions(researchSettings.config, "schema-doc-json-repair"),
    },
    {},
  );
  return response.content || rawMessageContent(response.rawMessage);
}

function rawMessageReasoningContent(rawMessage: unknown): string {
  if (!rawMessage || typeof rawMessage !== "object") return "";
  const message = rawMessage as Record<string, any>;
  const value = message.reasoning_content ?? message.reasoningContent;
  return typeof value === "string" ? value.trim() : "";
}

function buildRunningSchemaToolTrace(call: api.AiRawToolCall): AiToolTrace {
  return {
    id: call.id,
    name: call.name,
    arguments: formatSchemaToolArguments(call),
    status: "running",
  };
}

function buildCompletedSchemaToolTrace(call: api.AiRawToolCall, output: unknown, isZh: boolean): AiToolTrace {
  const error = output && typeof output === "object" ? (output as Record<string, any>).error : undefined;
  const trace: AiToolTrace = {
    id: call.id,
    name: call.name,
    arguments: formatSchemaToolArguments(call),
    status: error ? "error" : "success",
    summary: formatSchemaToolResultSummary(call.name, output, isZh),
  };
  const childTraces =
    call.name === "dbx_schema_research_task" && output && typeof output === "object"
      ? (output as Record<string, any>).internalToolTraces
      : undefined;
  if (Array.isArray(childTraces)) {
    trace.children = childTraces.filter(isAiToolTraceLike).slice(0, 20);
  }
  return trace;
}

function isAiToolTraceLike(value: unknown): value is AiToolTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as Record<string, any>;
  return (
    typeof trace.id === "string" &&
    typeof trace.name === "string" &&
    typeof trace.arguments === "string" &&
    ["running", "success", "error"].includes(trace.status)
  );
}

function stripUiOnlyToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const { internalToolTraces: _internalToolTraces, ...rest } = output as Record<string, any>;
  return rest;
}

function formatSchemaToolArguments(call: api.AiRawToolCall): string {
  const args = safeParseToolArguments(call.arguments);
  if (call.name === "dbx_schema_research_task") {
    const constraints = args.constraints && typeof args.constraints === "object" ? args.constraints : {};
    return JSON.stringify({
      task: args.task || "",
      requiredEvidence: Array.isArray(args.requiredEvidence) ? args.requiredEvidence.length : 0,
      maxTables: constraints.maxTables,
      maxColumnsPerTable: constraints.maxColumnsPerTable,
      requireRelations: constraints.requireRelations === true,
    });
  }
  if (call.name === "dbx_search_schema") {
    return JSON.stringify({
      query: args.query || "",
      limit: args.limit,
    });
  }
  if (call.name === "dbx_list_tables") {
    return JSON.stringify({
      schema: args.schema || "",
      keyword: args.keyword || "",
      limit: args.limit,
    });
  }
  if (call.name === "dbx_find_columns") {
    return JSON.stringify({
      query: args.query || "",
      schema: args.schema || "",
      limit: args.limit,
    });
  }
  if (call.name === "dbx_request_table_choice") {
    return JSON.stringify({
      question: args.question || "",
      candidates: Array.isArray(args.candidates) ? args.candidates.length : 0,
      allowManual: true,
    });
  }
  if (call.name === "dbx_search_table_columns") {
    return JSON.stringify({
      schema: args.schema || "",
      table: args.table || "",
      query: args.query || "",
      limit: args.limit,
      includePrimaryKey: args.includePrimaryKey !== false,
    });
  }
  if (call.name === "dbx_get_column_details") {
    return JSON.stringify({
      schema: args.schema || "",
      table: args.table || "",
      columns: Array.isArray(args.columns) ? args.columns : [],
    });
  }
  if (call.name === "dbx_load_table_schema") {
    return JSON.stringify({
      schema: args.schema || "",
      table: args.table || "",
    });
  }
  if (call.name === "dbx_request_column_choice") {
    return JSON.stringify({
      schema: args.schema || "",
      table: args.table || "",
      question: args.question || "",
      candidates: Array.isArray(args.candidates) ? args.candidates.length : 0,
      multiple: args.multiple === true,
      allowManual: true,
    });
  }
  if (call.name === "dbx_save_schema_enrichment") {
    return JSON.stringify({
      confirmationSource: args.confirmationSource || "",
      aliases: Array.isArray(args.aliases) ? args.aliases.length : 0,
    });
  }
  if (call.name === "dbx_get_related_tables") {
    return JSON.stringify({
      schema: args.schema || "",
      table: args.table || "",
    });
  }
  if (call.name === "dbx_expand_schema_graph") {
    return JSON.stringify({
      seeds: Array.isArray(args.seeds) ? args.seeds.length : 0,
      includeCandidates: args.includeCandidates !== false,
      limit: args.limit,
    });
  }
  if (call.name === "dbx_request_relation") {
    return JSON.stringify({
      leftSchema: args.leftSchema || "",
      leftTable: args.leftTable || "",
      rightSchema: args.rightSchema || "",
      rightTable: args.rightTable || "",
      candidatePairs: Array.isArray(args.candidatePairs) ? args.candidatePairs.length : undefined,
    });
  }
  return call.arguments;
}

function formatSchemaToolResultSummary(name: string, output: unknown, isZh: boolean): string {
  if (!output || typeof output !== "object") return "";
  const data = output as Record<string, any>;
  if (data.error) return isZh ? `失败：${String(data.error)}` : String(data.error);
  if (name === "dbx_schema_research_task") {
    const evidence = data.evidence && typeof data.evidence === "object" ? (data.evidence as Record<string, any>) : {};
    const tables = Array.isArray(evidence.tables) ? evidence.tables : [];
    const relations = Array.isArray(evidence.relations) ? evidence.relations : [];
    const status = typeof data.status === "string" ? data.status : "partial";
    return isZh
      ? `Schema Research ${status}：${tables.length} 张表，${relations.length} 条关系`
      : `Schema Research ${status}: ${tables.length} table(s), ${relations.length} relation(s)`;
  }
  if (name === "dbx_search_schema") {
    const tables = Array.isArray(data.tables) ? data.tables : [];
    const names = tables
      .slice(0, 5)
      .map((table) => [table.schema, table.name].filter(Boolean).join("."))
      .filter(Boolean)
      .join(", ");
    return isZh
      ? `${tables.length} 张表${names ? `：${names}` : ""}`
      : `${tables.length} table(s)${names ? `: ${names}` : ""}`;
  }
  if (name === "dbx_list_tables") {
    const tables = Array.isArray(data.tables) ? data.tables : [];
    const totalMatched = Number.isFinite(Number(data.totalMatched)) ? Number(data.totalMatched) : tables.length;
    const truncated = data.truncated === true && totalMatched > tables.length;
    if (truncated) {
      return isZh
        ? `${tables.length}/${totalMatched} 张表，已截断`
        : `${tables.length}/${totalMatched} table(s), truncated`;
    }
    return isZh ? `${tables.length} 张表` : `${tables.length} table(s)`;
  }
  if (name === "dbx_find_columns") {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return isZh ? `${matches.length} 个字段匹配` : `${matches.length} column match(es)`;
  }
  if (name === "dbx_request_table_choice") {
    if (data.cancelled) return isZh ? "表选择已取消" : "Table choice cancelled";
    if (data.confirmed && data.selectedTable) {
      const table = [data.selectedTable.schema, data.selectedTable.table].filter(Boolean).join(".");
      return isZh ? `用户选择表：${table}` : `Table selected by user: ${table}`;
    }
    return isZh ? "用户跳过表选择" : "Table choice skipped";
  }
  if (name === "dbx_search_table_columns") {
    const columns = Array.isArray(data.columns) ? data.columns : [];
    const totalColumns = Number.isFinite(Number(data.totalColumns)) ? Number(data.totalColumns) : columns.length;
    const truncated = data.truncated === true && totalColumns > columns.length;
    const table = [data.schema, data.table].filter(Boolean).join(".");
    if (truncated) {
      return isZh
        ? `${table || "表"}，${columns.length}/${totalColumns} 个字段候选，已截断`
        : `${table || "table"} with ${columns.length}/${totalColumns} column candidate(s), truncated`;
    }
    return isZh
      ? `${table || "表"}，${columns.length} 个字段候选`
      : `${table || "table"} with ${columns.length} column candidate(s)`;
  }
  if (name === "dbx_get_column_details") {
    const columns = Array.isArray(data.columns) ? data.columns : [];
    const table = [data.schema, data.table].filter(Boolean).join(".");
    return isZh
      ? `${table || "表"}，${columns.length} 个字段详情`
      : `${table || "table"} with ${columns.length} column detail(s)`;
  }
  if (name === "dbx_load_table_schema") {
    const columns = Array.isArray(data.columns) ? data.columns.length : 0;
    const table = [data.schema, data.table].filter(Boolean).join(".");
    return isZh ? `${table || "表"}，${columns} 个字段` : `${table || "table"} with ${columns} column(s)`;
  }
  if (name === "dbx_request_column_choice") {
    if (data.cancelled) return isZh ? "字段选择已取消" : "Column choice cancelled";
    const columns = Array.isArray(data.selectedColumns) ? data.selectedColumns : [];
    if (data.confirmed)
      return isZh ? `用户选择 ${columns.length} 个字段` : `${columns.length} column(s) selected by user`;
    return isZh ? "用户跳过字段选择" : "Column choice skipped";
  }
  if (name === "dbx_save_schema_enrichment") {
    const savedAliases = Number.isFinite(Number(data.savedAliases)) ? Number(data.savedAliases) : 0;
    return isZh ? `已沉淀 ${savedAliases} 个业务别名` : `${savedAliases} business alias(es) saved`;
  }
  if (name === "dbx_get_related_tables") {
    const relations = Array.isArray(data.relations) ? data.relations : [];
    return isZh ? `${relations.length} 条关系` : `${relations.length} relation(s)`;
  }
  if (name === "dbx_expand_schema_graph") {
    const verified = Array.isArray(data.verifiedMappings) ? data.verifiedMappings.length : 0;
    const candidates = Array.isArray(data.candidateMappings) ? data.candidateMappings.length : 0;
    const joins = Array.isArray(data.joinCandidates) ? data.joinCandidates.length : 0;
    const concepts = Array.isArray(data.concepts) ? data.concepts.length : 0;
    return isZh
      ? `图扩展：verified ${verified}，candidate ${candidates}，关系 ${joins}，概念 ${concepts}`
      : `Graph expansion: ${verified} verified, ${candidates} candidate(s), ${joins} join(s), ${concepts} concept(s)`;
  }
  if (name === "dbx_request_relation") {
    if (data.cancelled) return isZh ? "关系确认已取消" : "Relation confirmation cancelled";
    return data.confirmed
      ? isZh
        ? "用户已确认关联关系"
        : "Relation confirmed by user"
      : isZh
        ? "用户跳过关联确认"
        : "Relation confirmation skipped";
  }
  return "";
}

function isCancelledUserChoiceOutput(name: string, output: unknown): boolean {
  return (
    ["dbx_request_relation", "dbx_request_table_choice", "dbx_request_column_choice"].includes(name) &&
    !!output &&
    typeof output === "object" &&
    (output as Record<string, any>).cancelled === true
  );
}

function isUserChoiceSchemaTool(name: string): boolean {
  return ["dbx_request_relation", "dbx_request_table_choice", "dbx_request_column_choice"].includes(name);
}

function userChoiceSchemaToolKind(name: string): "table" | "column" | "relation" {
  if (name === "dbx_request_table_choice") return "table";
  if (name === "dbx_request_column_choice") return "column";
  return "relation";
}

function userChoiceSchemaToolTitle(name: string, isZh: boolean): string {
  if (name === "dbx_request_table_choice") return isZh ? "等待用户选择表" : "Waiting for table choice";
  if (name === "dbx_request_column_choice") return isZh ? "等待用户选择字段" : "Waiting for column choice";
  return isZh ? "等待用户确认关系" : "Waiting for relation confirmation";
}

function userChoiceSchemaToolResultStatus(
  status: AiToolTrace["status"],
  output: unknown,
): "success" | "error" | "abort" {
  if (status === "error") return "error";
  if (output && typeof output === "object" && (output as Record<string, any>).cancelled === true) return "abort";
  return "success";
}

function mergeSchemaResearchEvidenceGate(
  current: SchemaResearchEvidenceGate | undefined,
  toolName: string,
  output: unknown,
): SchemaResearchEvidenceGate | undefined {
  if (toolName === "dbx_schema_research_task") {
    return schemaResearchEvidenceGateFromToolOutput(output);
  }
  if (!current) return undefined;
  if (current.status === "need_user_choice") {
    return isUserChoiceSchemaTool(toolName) ? undefined : current;
  }
  return isSchemaEvidenceContinuationTool(toolName) ? undefined : current;
}

function schemaResearchEvidenceGateFromToolOutput(output: unknown): SchemaResearchEvidenceGate | undefined {
  if (!output || typeof output !== "object") return undefined;
  const data = output as Record<string, any>;
  if (data.error) {
    return {
      status: "error",
      summary: String(data.error),
      uncertainties: [],
    };
  }
  const status = String(data.status || "").trim() as SchemaResearchStatus;
  if (status === "sufficient") return undefined;
  if (!["partial", "need_user_choice", "not_found", "error"].includes(status)) return undefined;
  const uncertainties = Array.isArray(data.uncertainties)
    ? data.uncertainties
        .map((item: unknown) => {
          const uncertainty = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            kind: optionalToolString(uncertainty.kind),
            message: optionalToolString(uncertainty.message),
          };
        })
        .filter((item: { kind?: string; message?: string }) => item.kind || item.message)
    : [];
  return {
    status,
    summary: optionalToolString(data.summary) || `Schema Research returned ${status}.`,
    uncertainties,
    promptSummary: optionalToolString(data.promptSummary),
  };
}

function isSchemaEvidenceContinuationTool(name: string): boolean {
  return [
    "dbx_schema_research_task",
    "dbx_request_table_choice",
    "dbx_request_column_choice",
    "dbx_request_relation",
  ].includes(name);
}

export function buildSchemaResearchEvidenceGateInstruction(
  gate: SchemaResearchEvidenceGate | undefined,
  isZh: boolean,
): string | undefined {
  if (!gate) return undefined;
  const uncertaintyText = formatSchemaResearchGateUncertainties(gate, isZh);
  if (gate.status === "need_user_choice") {
    return isZh
      ? [
          "Schema Research 返回 need_user_choice，不能直接生成最终 SQL。",
          "必须调用 dbx_request_table_choice、dbx_request_column_choice 或 dbx_request_relation 让用户确认不确定的表、字段或关联关系。",
          `摘要：${gate.summary}`,
          uncertaintyText,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Schema Research returned need_user_choice. Do not generate final SQL yet.",
          "You must call dbx_request_table_choice, dbx_request_column_choice, or dbx_request_relation so the user can confirm the uncertain table, column, or relationship.",
          `Summary: ${gate.summary}`,
          uncertaintyText,
        ]
          .filter(Boolean)
          .join("\n");
  }
  if (gate.status === "partial") {
    return isZh
      ? [
          "Schema Research 返回 partial，证据不足，不能直接生成最终 SQL。",
          "必须继续调用更窄的 dbx_schema_research_task 补齐实时证据；如果仍无法确定，调用用户选择/关系确认工具。",
          "最终 SQL 只能使用 Schema Research 返回的 verified 字段、当前明确 @table 上下文中的字段，或用户确认后再次由 Schema Research 验证过的字段。",
          `摘要：${gate.summary}`,
          uncertaintyText,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Schema Research returned partial evidence. Do not generate final SQL yet.",
          "You must continue with a narrower dbx_schema_research_task to complete real-time evidence. If still uncertain, call a user-choice or relation-confirmation tool.",
          "Final SQL may use only columns verified by Schema Research, columns in the current explicit @table context, or user-confirmed candidates that were verified again by Schema Research.",
          `Summary: ${gate.summary}`,
          uncertaintyText,
        ]
          .filter(Boolean)
          .join("\n");
  }
  return isZh
    ? [
        `Schema Research 返回 ${gate.status}，不能编造表、字段或关系，也不能直接生成最终 SQL。`,
        "请继续调用更窄的 dbx_schema_research_task 寻找证据；如果没有足够候选，向用户说明缺少哪些表、字段或关系，让用户用 @table 或明确字段补充。",
        `摘要：${gate.summary}`,
        uncertaintyText,
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `Schema Research returned ${gate.status}. Do not invent tables, columns, or relationships, and do not generate final SQL yet.`,
        "Continue with a narrower dbx_schema_research_task. If there are not enough candidates, explain which tables, columns, or relationships are missing and ask the user to provide an @table mention or explicit fields.",
        `Summary: ${gate.summary}`,
        uncertaintyText,
      ]
        .filter(Boolean)
        .join("\n");
}

function buildSchemaResearchEvidenceGateFallbackResponse(
  gate: SchemaResearchEvidenceGate | undefined,
  isZh: boolean,
): string {
  if (!gate) return "";
  const uncertaintyText = formatSchemaResearchGateUncertainties(gate, isZh);
  if (isZh) {
    return [
      "我还不能生成可靠 SQL，因为 Schema 证据没有达到可用标准。",
      `当前状态：${gate.status}`,
      `摘要：${gate.summary}`,
      uncertaintyText,
      "请用 @table 指定相关表，或确认候选表、字段、关联关系后我再生成 SQL。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "I cannot generate reliable SQL yet because the schema evidence is not sufficient.",
    `Current status: ${gate.status}`,
    `Summary: ${gate.summary}`,
    uncertaintyText,
    "Please mention the relevant table with @table, or confirm the candidate tables, columns, and relationships before I generate SQL.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSchemaResearchGateUncertainties(gate: SchemaResearchEvidenceGate, isZh: boolean): string {
  if (!gate.uncertainties.length) return "";
  const lines = gate.uncertainties
    .slice(0, 4)
    .map((item) => `- ${[item.kind, item.message].filter(Boolean).join(": ")}`)
    .join("\n");
  return `${isZh ? "不确定项" : "Uncertainties"}:\n${lines}`;
}

function safeParseToolArguments(rawArguments: string): Record<string, any> {
  try {
    return parseToolArguments(rawArguments);
  } catch {
    return {};
  }
}

function normalizeRawAssistantMessage(rawMessage: unknown, content: string, toolCalls: api.AiRawToolCall[]): any {
  if (rawMessage && typeof rawMessage === "object") return rawMessage;
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    })),
  };
}

export function buildToolSystemPrompt(action: AiAction, context: AiContext, mode: AiAssistantMode = "ask"): string {
  const isZh = currentLocale() === "zh-CN";
  const seedSchema = context.tables.length
    ? `\n${isZh ? "初始 Schema 上下文，仅来自当前表或用户明确 @table 提到的表：" : "Initial schema context, from current tab or explicit @table mentions only:"}\n${formatSchema(context)}\n`
    : "";
  const toolRules = isZh
    ? [
        "你是 DBX 内置的数据库助手。用中文回复。",
        "精确、保守，根据当前数据库方言生成 SQL。",
        "严格使用当前数据库方言；标识符引用、分页、日期函数、字符串拼接、LIMIT/TOP/OFFSET 语法必须匹配数据库类型。",
        ...buildModePromptLines(mode, isZh),
        ...buildActionPromptLines(action, isZh),
        "当前没有预加载完整 Schema。只有工具返回的实时表结构、当前表上下文、用户明确 @table 提到的表可以作为最终 SQL 的表列依据。",
        "查询表、字段、字段详情、表关系或文档映射时，只能调用 dbx_schema_research_task；这是你唯一的 Schema 查询入口。",
        "dbx_schema_research_task 会让 Schema Research 子任务内部消化低级工具结果并返回压缩证据；主对话不能直接调用低级 schema tools。",
        "dbx_schema_research_task 返回的 promptSummary 是给你生成最终 SQL 用的压缩证据；最终 SQL 只能使用其中已 verified 的字段、当前明确 @table 上下文中的字段，或用户确认后再次由 Schema Research 验证过的字段。",
        "当用户用中文业务词查表或字段时，工具 query 要同时包含原始中文词和可能的英文业务词、表名/字段名片段，例如：评价 review rating comment feedback score。",
        "当问题涉及当前上下文未提供的表、字段或关系时，调用 dbx_schema_research_task，并把业务意图、表角色、字段角色、关系需求和可能的中英文检索词写清楚。",
        "Schema Research 返回 partial 时，继续发起更窄的 dbx_schema_research_task；如果仍无法确定，调用用户选择/关系确认工具。",
        "拿到候选表后，若不能确定用户想要哪张表，调用 dbx_request_table_choice 让用户确认。用户选择或手动输入后，仍要把该候选交给新的 dbx_schema_research_task 做实时验证。",
        "拿到字段候选后，若不能确定用户想要哪个字段，调用 dbx_request_column_choice 让用户确认。用户选择或手动输入后，仍要把该候选交给新的 dbx_schema_research_task 做实时验证。",
        "只有当用户明确要求沉淀/记住某个业务词到表或字段的映射，或用户刚刚通过表/字段选择器确认了映射并同意沉淀时，才可以调用 dbx_save_schema_enrichment。禁止保存模型自己猜测的映射。",
        "需要 JOIN 两张表时，先通过 dbx_schema_research_task 获取关系证据；如果没有可靠关系，不要猜测，调用 dbx_request_relation 让用户确认字段对应关系。联合键或多字段关联必须使用多个 candidatePairs，并在最终 JOIN 中用 AND 使用用户确认的全部 columnPairs。",
        "不要编造工具结果中不存在的表、字段或关联关系。工具预算有限，缺什么查什么，不要重复查同一个意图。",
        "返回 SQL 时放在 ```sql 代码块中。额外说明简短实用。",
      ]
    : [
        "You are DBX's built-in database assistant. Reply in English.",
        "Be precise, conservative, and adapt SQL to the active database dialect.",
        "Strictly use the active database dialect; identifier quoting, pagination, date functions, string concatenation, and LIMIT/TOP/OFFSET syntax must match the database type.",
        ...buildModePromptLines(mode, isZh),
        ...buildActionPromptLines(action, isZh),
        "A complete schema is not preloaded. Only tool-returned real-time schemas, current table context, and explicit @table mentions may be used as table/column facts for final SQL.",
        "To query tables, columns, column details, table relationships, or document mappings, call only dbx_schema_research_task. It is your only schema-query entrypoint.",
        "dbx_schema_research_task lets the Schema Research subtask digest low-level tool results and return compact evidence. The main conversation must not call low-level schema tools directly.",
        "The promptSummary returned by dbx_schema_research_task is compact evidence for final SQL generation. Final SQL may use only columns marked verified there, columns in the current explicit @table context, or user-confirmed candidates that were verified again by Schema Research.",
        "When a Chinese business term is used to search tables or columns, include the original Chinese term plus likely English business terms and identifier fragments in tool queries, for example: 评价 review rating comment feedback score.",
        "When the request needs tables, columns, or relationships not already in context, call dbx_schema_research_task and include the business intent, table roles, column roles, relation needs, and likely Chinese/English search terms.",
        "When Schema Research returns partial evidence, start a narrower dbx_schema_research_task. If the result remains ambiguous, call a user-choice or relation-confirmation tool.",
        "After candidate tables are found, call dbx_request_table_choice if you cannot determine which table the user means. After the user chooses or manually enters a table, send that candidate to a new dbx_schema_research_task for real-time verification.",
        "After column candidates are found, call dbx_request_column_choice if you cannot determine which column the user means. After the user chooses or manually enters columns, send those candidates to a new dbx_schema_research_task for real-time verification.",
        "Call dbx_save_schema_enrichment only when the user explicitly asks to save/remember a business term to table/column mapping, or when the user has just confirmed the mapping through a table/column choice UI and agreed to save it. Never save model-guessed mappings.",
        "Before joining two tables, use dbx_schema_research_task to get relation evidence. If no reliable relation exists, do not guess; call dbx_request_relation so the user can confirm matching columns. For composite-key or multi-column relationships, provide multiple candidatePairs and use all user-confirmed columnPairs with AND in the final JOIN.",
        "Never invent tables, columns, or relationships that are not present in tool results. Tool budget is limited; retrieve only what is missing and avoid duplicate searches.",
        "Put SQL in a fenced ```sql code block. Keep extra explanation short and practical.",
      ];
  const resultPreview = context.lastResultPreview ? `\nLast result preview:\n${context.lastResultPreview}\n` : "";
  const lastError = context.lastError ? `\nLast error:\n${context.lastError}\n` : "";
  return [
    ...toolRules,
    "",
    `Database type: ${context.databaseType}`,
    `Connection: ${context.connectionName}`,
    `Database: ${context.database}`,
    context.schema ? `Schema: ${context.schema}` : "",
    `Current SQL:\n${context.currentSql.trim() || "(empty)"}`,
    lastError,
    resultPreview,
    seedSchema,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface AiSchemaToolsOptions {
  scope?: "main" | "schema_research";
  includeResearchTask?: boolean;
  includeUserChoiceTools?: boolean;
  includeEnrichmentTool?: boolean;
  includeLoadTableSchema?: boolean;
}

const MAIN_SCHEMA_TOOL_NAMES = new Set([
  "dbx_schema_research_task",
  "dbx_request_table_choice",
  "dbx_request_column_choice",
  "dbx_save_schema_enrichment",
  "dbx_request_relation",
]);

const SCHEMA_RESEARCH_TOOL_NAMES = new Set([
  "dbx_search_schema",
  "dbx_list_tables",
  "dbx_find_columns",
  "dbx_search_table_columns",
  "dbx_get_column_details",
  "dbx_load_table_schema",
  "dbx_get_related_tables",
  "dbx_expand_schema_graph",
]);

export function buildAiSchemaTools(options: AiSchemaToolsOptions = {}): unknown[] {
  const isZh = currentLocale() === "zh-CN";
  const tools: unknown[] = [
    {
      type: "function",
      function: {
        name: "dbx_schema_research_task",
        description: isZh
          ? "发起一个 AI Schema Research 子任务。子任务会内部调用低级 schema tools，消化候选表/字段/关系，只把压缩后的结构化证据返回给主模型。优先用于复杂查表、找字段、判断关系。"
          : "Start an AI Schema Research subtask. The subtask internally calls low-level schema tools, digests candidate tables/columns/relations, and returns compact structured evidence to the main model. Prefer this for complex table, column, and relation research.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: isZh
                ? "主模型交给子任务的具体 schema research 目标。必须写清业务意图、需要的表角色、字段角色和关系需求。"
                : "Concrete schema research goal from the main model. Include business intent, table roles, column roles, and relation needs.",
            },
            requiredEvidence: {
              type: "array",
              description: isZh
                ? "需要子任务找齐的证据清单，例如订单表、用户关联字段、时间筛选字段。"
                : "Evidence checklist the subtask should collect, such as order table, user relation column, or time filter column.",
              items: { type: "string" },
            },
            knownContext: {
              type: "object",
              description: isZh
                ? "主模型已经知道但仍需子任务参考的上下文。"
                : "Context already known by the main model.",
              properties: {
                currentSql: { type: "string", description: isZh ? "当前 SQL，可为空。" : "Current SQL, optional." },
                mentionedTables: {
                  type: "array",
                  description: isZh ? "用户明确提到或主模型已确认的表。" : "Tables explicitly mentioned or confirmed.",
                  items: {
                    type: "object",
                    properties: {
                      schema: { type: "string" },
                      table: { type: "string" },
                    },
                    required: ["table"],
                  },
                },
              },
            },
            constraints: {
              type: "object",
              description: isZh ? "子任务输出和检索预算约束。" : "Subtask output and retrieval constraints.",
              properties: {
                maxTables: {
                  type: "integer",
                  minimum: 1,
                  maximum: 6,
                  description: isZh ? "最多返回的证据表数量。" : "Maximum evidence tables to return.",
                },
                maxColumnsPerTable: {
                  type: "integer",
                  minimum: 1,
                  maximum: 20,
                  description: isZh ? "每张表最多返回的证据字段数量。" : "Maximum evidence columns per table.",
                },
                requireRelations: {
                  type: "boolean",
                  description: isZh ? "是否必须查找表关系。" : "Whether table relations are required.",
                },
                allowUserChoice: {
                  type: "boolean",
                  description: isZh
                    ? "子任务不能直接弹 UI；为 true 时可返回 need_user_choice 让主模型发起选择工具。"
                    : "The subtask cannot open UI directly; when true, it may return need_user_choice for the main model to ask the user.",
                },
              },
            },
          },
          required: ["task"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_search_schema",
        description: isZh
          ? "在当前已分析的 Schema 中检索相关表、字段和关系。"
          : "Search the current analyzed schema for relevant tables, columns, and relationships.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: isZh
                ? "自然语言 Schema 检索词。包含需要的业务词、表角色和字段。"
                : "Natural language schema retrieval query. Include needed business terms, table roles, and columns.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 8,
              description: isZh ? "最多返回的表数量。" : "Maximum tables to return.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_list_tables",
        description: isZh
          ? "不依赖向量索引，按 schema 和关键词列出实时表/视图。用于没有 Schema 智能索引或需要浏览候选表时。"
          : "List live tables/views by schema and keyword without using the vector index. Use when no smart schema index exists or when browsing candidates.",
        parameters: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: isZh
                ? "Schema 名称。省略时使用当前 schema。"
                : "Schema name. Defaults to the current schema.",
            },
            keyword: {
              type: "string",
              description: isZh ? "按表名过滤的关键词，可为空。" : "Optional table-name keyword filter.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              description: isZh ? "最多返回的表数量。" : "Maximum tables to return.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_find_columns",
        description: isZh
          ? "不依赖向量索引，在实时元数据中按字段名/注释搜索字段，并返回所属表。"
          : "Search live metadata for columns by name/comment without using the vector index, returning owning tables.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: isZh ? "字段名、注释或业务关键词。" : "Column name, comment, or business keyword.",
            },
            schema: {
              type: "string",
              description: isZh
                ? "Schema 名称。省略时使用当前 schema。"
                : "Schema name. Defaults to the current schema.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 80,
              description: isZh ? "最多返回的字段数量。" : "Maximum column matches to return.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_request_table_choice",
        description: isZh
          ? "当候选表过多或语义接近，无法确定用户想要哪张表时，让用户从候选表中选择，或手动输入都不是的表。"
          : "Ask the user to choose the intended table from candidates, or manually enter another table, when table candidates are ambiguous.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: isZh ? "展示给用户的简短问题。" : "Short question to show to the user.",
            },
            reason: {
              type: "string",
              description: isZh ? "为什么需要用户选择表。" : "Why table selection is needed.",
            },
            allowManual: {
              type: "boolean",
              description: isZh
                ? "是否允许用户选择都不是并手动输入表名。"
                : "Whether the user may choose none and manually enter a table.",
            },
            candidates: {
              type: "array",
              description: isZh
                ? "候选表列表，必须来自已有工具结果。"
                : "Candidate tables, all from previous tool results.",
              items: {
                type: "object",
                properties: {
                  schema: { type: "string", description: isZh ? "Schema 名称。" : "Schema name." },
                  table: { type: "string", description: isZh ? "表名。" : "Table name." },
                  tableType: { type: "string", description: isZh ? "表类型。" : "Table type." },
                  comment: { type: "string", description: isZh ? "表注释。" : "Table comment." },
                  score: { type: "number", description: isZh ? "候选分数。" : "Candidate score." },
                  reason: { type: "string", description: isZh ? "候选原因。" : "Candidate reason." },
                },
                required: ["schema", "table"],
              },
            },
          },
          required: ["question", "candidates"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_search_table_columns",
        description: isZh
          ? "在指定表内使用字段文档向量召回相关字段，只返回字段名、注释、分数和命中原因等轻量摘要。"
          : "Use vector retrieval over column documents inside one table, returning only lightweight summaries such as name, comment, score, and reason.",
        parameters: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: isZh
                ? "Schema 名称。省略时使用当前 schema。"
                : "Schema name. Defaults to the current schema.",
            },
            table: {
              type: "string",
              description: isZh ? "已确认或候选的表名。" : "Confirmed or candidate table name.",
            },
            query: {
              type: "string",
              description: isZh
                ? "字段召回查询词。中文业务词应同时带可能的英文词和字段名片段，例如：评价 review rating comment score。"
                : "Column retrieval query. Include original business terms plus likely English terms and identifier fragments.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              description: isZh ? "最多返回的字段候选数量。" : "Maximum column candidates to return.",
            },
            includePrimaryKey: {
              type: "boolean",
              description: isZh
                ? "是否在字段摘要中包含 primaryKey 标记。默认包含。"
                : "Whether to include the primaryKey flag in column summaries. Defaults to true.",
            },
          },
          required: ["table", "query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_get_column_details",
        description: isZh
          ? "获取指定表中指定字段的实时详情。字段要进入最终 SQL 前使用；必须指定 columns，不会返回整表详情。"
          : "Get real-time details for specified columns in a table before using them in final SQL. Requires columns and never returns whole-table details.",
        parameters: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: isZh
                ? "Schema 名称。省略时使用当前 schema。"
                : "Schema name. Defaults to the current schema.",
            },
            table: { type: "string", description: isZh ? "表名。" : "Table name." },
            columns: {
              type: "array",
              description: isZh ? "需要获取详情的字段名列表。" : "Column names to load details for.",
              items: { type: "string" },
              minItems: 1,
            },
          },
          required: ["table", "columns"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_load_table_schema",
        description: isZh
          ? "在 SQL 使用某张表之前，加载该表的实时字段、索引和外键。"
          : "Load real-time columns, indexes, and foreign keys for a table before using it in SQL.",
        parameters: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: isZh ? "dbx_search_schema 返回的 Schema 名称。" : "Schema name from dbx_search_schema.",
            },
            table: { type: "string", description: isZh ? "要核对的表名。" : "Table name to verify." },
          },
          required: ["schema", "table"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_request_column_choice",
        description: isZh
          ? "当已确认表但无法确定用户想要哪个字段时，让用户从候选字段中选择，或手动输入都不是的字段。"
          : "Ask the user to choose intended column(s) from candidates, or manually enter other columns, when columns are ambiguous.",
        parameters: {
          type: "object",
          properties: {
            schema: { type: "string", description: isZh ? "Schema 名称。" : "Schema name." },
            table: { type: "string", description: isZh ? "表名。" : "Table name." },
            question: {
              type: "string",
              description: isZh ? "展示给用户的简短问题。" : "Short question to show to the user.",
            },
            reason: {
              type: "string",
              description: isZh ? "为什么需要用户选择字段。" : "Why column selection is needed.",
            },
            multiple: {
              type: "boolean",
              description: isZh ? "是否允许选择多个字段。" : "Whether multiple columns may be selected.",
            },
            allowManual: {
              type: "boolean",
              description: isZh
                ? "是否允许用户选择都不是并手动输入字段名。"
                : "Whether the user may choose none and manually enter columns.",
            },
            candidates: {
              type: "array",
              description: isZh
                ? "候选字段列表，必须来自已有工具结果。"
                : "Candidate columns, all from previous tool results.",
              items: {
                type: "object",
                properties: {
                  column: { type: "string", description: isZh ? "字段名。" : "Column name." },
                  dataType: { type: "string", description: isZh ? "字段类型。" : "Column data type." },
                  nullable: { type: "boolean", description: isZh ? "是否可空。" : "Whether the column is nullable." },
                  primaryKey: {
                    type: "boolean",
                    description: isZh ? "是否主键。" : "Whether the column is a primary key.",
                  },
                  comment: { type: "string", description: isZh ? "字段注释。" : "Column comment." },
                  score: { type: "number", description: isZh ? "候选分数。" : "Candidate score." },
                  reason: { type: "string", description: isZh ? "候选原因。" : "Candidate reason." },
                },
                required: ["column"],
              },
            },
          },
          required: ["schema", "table", "question", "candidates"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_get_related_tables",
        description: isZh
          ? "读取某张表的已知关系。当前包含数据库真实外键；没有外键时可能为空，应考虑请求用户确认关系。"
          : "Read known relationships for a table. Currently includes real database foreign keys; may be empty when no FK exists, in which case ask the user to confirm relationships.",
        parameters: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: isZh
                ? "Schema 名称。省略时使用当前 schema。"
                : "Schema name. Defaults to the current schema.",
            },
            table: { type: "string", description: isZh ? "表名。" : "Table name." },
          },
          required: ["table"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_expand_schema_graph",
        description: isZh
          ? "根据表、字段、接口文档章节、接口字段或业务概念种子扩展 Schema Graph，返回验证过或候选的接口文档映射、业务概念和关联候选。只供 Schema Research 子任务内部使用。"
          : "Expand the Schema Graph from table, column, API document section, API field, or business concept seeds, returning verified/candidate API doc mappings, concepts, and join candidates. Internal to Schema Research only.",
        parameters: {
          type: "object",
          properties: {
            seeds: {
              type: "array",
              description: isZh ? "图扩展种子。" : "Graph expansion seeds.",
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
                  id: {
                    type: "string",
                    description: isZh ? "文档 source/section/fact id，可选。" : "Optional source, section, or fact id.",
                  },
                  schema: { type: "string", description: isZh ? "Schema 名称。" : "Schema name." },
                  table: { type: "string", description: isZh ? "表名。" : "Table name." },
                  column: { type: "string", description: isZh ? "字段名。" : "Column name." },
                },
                required: ["kind"],
              },
            },
            includeCandidates: {
              type: "boolean",
              description: isZh
                ? "是否返回 candidate 状态事实。candidate 不能直接作为最终 SQL verified 证据。"
                : "Whether to include candidate facts. Candidates are not verified final-SQL evidence.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              description: isZh ? "最多返回的图事实数量。" : "Maximum graph facts to return.",
            },
          },
          required: ["seeds"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_save_schema_enrichment",
        description: isZh
          ? "在用户明确要求沉淀/记住，或用户刚刚确认表/字段选择后，保存业务词到表/字段的映射到 Schema 图索引。禁止保存模型自行猜测。"
          : "Save user-confirmed business-term to table/column mappings into the schema graph index. Use only after an explicit user save request or a just-confirmed table/column choice; never save model guesses.",
        parameters: {
          type: "object",
          properties: {
            confirmationSource: {
              type: "string",
              enum: ["explicit_user_request", "user_choice_confirmed"],
              description: isZh
                ? "确认来源。必须是用户明确要求沉淀，或用户刚刚通过选择器确认。"
                : "Confirmation source. Must be an explicit user save request or a just-confirmed user choice.",
            },
            aliases: {
              type: "array",
              description: isZh
                ? "要保存的业务词映射。只支持表或字段别名，不支持保存 JOIN 关系。"
                : "Business-term mappings to save. Supports table or column aliases only, not JOIN relationships.",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  term: {
                    type: "string",
                    description: isZh ? "用户使用的业务词或别名。" : "The business term or alias used by the user.",
                  },
                  targetKind: {
                    type: "string",
                    enum: ["table", "column"],
                    description: isZh ? "映射目标类型：表或字段。" : "Mapping target type: table or column.",
                  },
                  schema: {
                    type: "string",
                    description: isZh
                      ? "Schema 名称。省略时使用当前 schema。"
                      : "Schema name. Defaults to current schema.",
                  },
                  table: { type: "string", description: isZh ? "目标表名。" : "Target table name." },
                  column: {
                    type: "string",
                    description: isZh
                      ? "目标字段名。targetKind 为 column 时必填。"
                      : "Target column name. Required for targetKind=column.",
                  },
                  note: {
                    type: "string",
                    description: isZh
                      ? "可选备注，说明确认来源或业务含义。"
                      : "Optional note about the confirmation or business meaning.",
                  },
                },
                required: ["term", "targetKind", "table"],
              },
            },
          },
          required: ["confirmationSource", "aliases"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dbx_request_relation",
        description: isZh
          ? "当两张表需要 JOIN 但没有可靠外键或已知关系时，向用户发起结构化关系确认。"
          : "Ask the user to confirm a structured relationship when two tables need a JOIN but no reliable FK or known relation exists.",
        parameters: {
          type: "object",
          properties: {
            leftSchema: { type: "string", description: isZh ? "左表 Schema。" : "Left table schema." },
            leftTable: { type: "string", description: isZh ? "左表名。" : "Left table name." },
            rightSchema: { type: "string", description: isZh ? "右表 Schema。" : "Right table schema." },
            rightTable: { type: "string", description: isZh ? "右表名。" : "Right table name." },
            reason: {
              type: "string",
              description: isZh ? "为什么需要确认这两张表的关系。" : "Why this table relationship needs confirmation.",
            },
            candidatePairs: {
              type: "array",
              description: isZh
                ? "可选。模型认为可能正确的一个或多个字段对应关系，适用于联合主键或多字段 JOIN。"
                : "Optional. Candidate column pair(s) the model thinks may be correct, including composite-key or multi-column joins.",
              items: {
                type: "object",
                properties: {
                  leftColumn: { type: "string", description: isZh ? "左表字段名。" : "Left table column name." },
                  rightColumn: { type: "string", description: isZh ? "右表字段名。" : "Right table column name." },
                  reason: {
                    type: "string",
                    description: isZh ? "为什么认为这两个字段有关联。" : "Why these two columns may be related.",
                  },
                },
                required: ["leftColumn", "rightColumn"],
              },
            },
          },
          required: ["leftTable", "rightTable"],
        },
      },
    },
  ];
  return filterAiSchemaTools(tools, options);
}

function filterAiSchemaTools(tools: unknown[], options: AiSchemaToolsOptions): unknown[] {
  const scope = options.scope || "main";
  const includeResearchTask = options.includeResearchTask !== false;
  const includeUserChoiceTools = options.includeUserChoiceTools !== false;
  const includeEnrichmentTool = options.includeEnrichmentTool !== false;
  const includeLoadTableSchema = options.includeLoadTableSchema !== false;
  return tools.filter((tool: any) => {
    const name = tool?.function?.name;
    if (scope === "main" && !MAIN_SCHEMA_TOOL_NAMES.has(name)) return false;
    if (scope === "schema_research" && !SCHEMA_RESEARCH_TOOL_NAMES.has(name)) return false;
    if (!includeResearchTask && name === "dbx_schema_research_task") return false;
    if (!includeLoadTableSchema && name === "dbx_load_table_schema") return false;
    if (
      !includeUserChoiceTools &&
      ["dbx_request_table_choice", "dbx_request_column_choice", "dbx_request_relation"].includes(name)
    ) {
      return false;
    }
    if (!includeEnrichmentTool && name === "dbx_save_schema_enrichment") return false;
    return true;
  });
}

async function executeSchemaResearchTaskTool(
  input: AiRequestInput,
  parentBudget: AiSchemaToolBudget,
  args: Record<string, any>,
  hooks?: AiSchemaToolWorkflowHooks,
): Promise<SchemaResearchTaskResult & { promptSummary: string; internalToolTraces?: AiToolTrace[] }> {
  const researchSettings = resolveSchemaResearchSettings(input.config);
  if (!researchSettings.enabled) {
    const result = normalizeSchemaResearchTaskResult({
      status: "error",
      summary: "Schema Research model is disabled in AI settings.",
      evidence: {},
    });
    return {
      ...result,
      promptSummary: formatSchemaResearchTaskResultForPrompt(result, { isZh: currentLocale() === "zh-CN" }),
    };
  }
  if (!supportsSchemaResearchModel(researchSettings.config)) {
    const result = normalizeSchemaResearchTaskResult({
      status: "error",
      summary:
        "Schema Research requires a /chat/completions-compatible provider that supports tool calls. Use OpenAI, Qwen, DeepSeek, Ollama, OpenAI Compatible, or Custom completions.",
      evidence: {},
    });
    return {
      ...result,
      promptSummary: formatSchemaResearchTaskResultForPrompt(result, { isZh: currentLocale() === "zh-CN" }),
    };
  }
  if (parentBudget.schemaResearchTasks >= MAX_AI_SCHEMA_RESEARCH_TASKS) {
    return {
      ...normalizeSchemaResearchTaskResult({
        status: "error",
        summary: `Schema research task budget exceeded (${MAX_AI_SCHEMA_RESEARCH_TASKS}).`,
        evidence: {},
      }),
      promptSummary: `Schema research task budget exceeded (${MAX_AI_SCHEMA_RESEARCH_TASKS}).`,
    };
  }
  parentBudget.schemaResearchTasks += 1;

  const task = String(args.task || "").trim();
  if (!task) {
    return {
      ...normalizeSchemaResearchTaskResult({
        status: "error",
        summary: "task is required",
        evidence: {},
      }),
      promptSummary: "task is required",
    };
  }

  const limits = schemaResearchLimits(args);
  const { result, internalToolTraces } = await runSchemaResearchSubtask(input, args, limits, researchSettings, hooks);
  const promptSummary = formatSchemaResearchTaskResultForPrompt(result, { isZh: currentLocale() === "zh-CN" });
  return {
    ...result,
    promptSummary,
    internalToolTraces,
  };
}

async function runSchemaResearchSubtask(
  input: AiRequestInput,
  args: Record<string, any>,
  limits: SchemaResearchResultLimits,
  researchSettings: ResolvedSchemaResearchSettings,
  hooks?: AiSchemaToolWorkflowHooks,
): Promise<{ result: SchemaResearchTaskResult; internalToolTraces: AiToolTrace[] }> {
  const context = input.context;
  const isZh = currentLocale() === "zh-CN";
  const agentNodeId = uuid();
  emitAiWorkflowEvent(hooks?.onEvent, {
    type: "node.start",
    nodeId: agentNodeId,
    parentId: hooks?.parentNodeId,
    kind: "agent",
    title: isZh ? "SQL助手分析中" : "SQL assistant analyzing",
    description: String(args.task || "").trim(),
    status: "loading",
  });
  const messages: any[] = [
    {
      role: "user",
      content: buildSchemaResearchUserPrompt(input, args, limits),
    },
  ];
  const tools = buildAiSchemaTools({
    scope: "schema_research",
    includeResearchTask: false,
    includeUserChoiceTools: false,
    includeEnrichmentTool: false,
  });
  const budget = createAiSchemaToolBudget();
  const internalToolTraces: AiToolTrace[] = [];
  let usedRounds = 0;

  for (let round = 0; round < researchSettings.maxToolRounds; round += 1) {
    usedRounds = round + 1;
    emitAiWorkflowEvent(hooks?.onEvent, {
      type: "node.update",
      nodeId: agentNodeId,
      status: "loading",
      description: isZh
        ? `Schema Research 正在检索证据（第 ${usedRounds} 轮）`
        : `Schema Research is collecting evidence (round ${usedRounds})`,
    });
    const response = await runRawChatForToolLoop(
      {
        config: researchSettings.config,
        systemPrompt: buildSchemaResearchSystemPrompt(input, args, limits),
        messages,
        tools,
        toolChoice: "auto",
        maxTokens: researchSettings.maxOutputTokens,
        temperature: 0.05,
      },
      {
        mainNodeId: agentNodeId,
        onEvent: hooks?.onEvent,
      },
    );
    messages.push(normalizeRawAssistantMessage(response.rawMessage, response.content, response.toolCalls));
    const reasoningContent = supportsDeepSeekRawChatStream(researchSettings.config)
      ? ""
      : rawMessageReasoningContent(response.rawMessage);
    if (reasoningContent) {
      emitAiWorkflowEvent(hooks?.onEvent, {
        type: "node.delta",
        nodeId: agentNodeId,
        delta: `${reasoningContent}\n\n`,
      });
    }

    if (!response.toolCalls.length) {
      const result = withSchemaResearchBudget(
        parseSchemaResearchTaskResultText(response.content, limits),
        budget,
        usedRounds,
        limits,
      );
      emitSchemaResearchEvidenceEvents(hooks?.onEvent, agentNodeId, result, isZh);
      emitAiWorkflowEvent(hooks?.onEvent, {
        type: "node.update",
        nodeId: agentNodeId,
        status: schemaResearchWorkflowStatus(result.status),
        description: result.summary,
      });
      return {
        result,
        internalToolTraces,
      };
    }

    for (const call of response.toolCalls) {
      const toolNodeId = call.id || uuid();
      emitAiWorkflowEvent(hooks?.onEvent, {
        type: "tool.start",
        nodeId: toolNodeId,
        parentId: agentNodeId,
        name: call.name,
        arguments: formatSchemaToolArguments(call),
      });
      const output = isSchemaResearchSubtaskToolAllowed(call.name)
        ? await executeAiSchemaToolCall(
            input,
            context,
            budget,
            call.name,
            call.arguments,
            undefined,
            undefined,
            undefined,
            {
              onEvent: hooks?.onEvent,
              parentNodeId: toolNodeId,
            },
          ).catch((error) => ({ error: error?.message || String(error) }))
        : { error: `Tool ${call.name} is not available inside schema research subtask.` };
      const completedTrace = buildCompletedSchemaToolTrace(call, output, isZh);
      emitAiWorkflowEvent(hooks?.onEvent, {
        type: "tool.end",
        nodeId: toolNodeId,
        status: completedTrace.status === "error" ? "error" : "success",
        summary: completedTrace.summary,
      });
      internalToolTraces.push(completedTrace);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(compactSchemaResearchToolOutput(call.name, output)),
      });
    }
  }

  messages.push({
    role: "user",
    content: isZh
      ? "Schema Research 工具轮次已用完。请只基于已经返回的工具结果输出最终 JSON，不要再调用工具。"
      : "The schema research tool-round budget is exhausted. Return final JSON using only the tool results already returned. Do not call tools.",
  });
  const finalResponse = await runRawChatForToolLoop(
    {
      config: researchSettings.config,
      systemPrompt: buildSchemaResearchSystemPrompt(input, args, limits),
      messages,
      tools: [],
      maxTokens: researchSettings.maxOutputTokens,
      temperature: 0.05,
    },
    {
      mainNodeId: agentNodeId,
      onEvent: hooks?.onEvent,
    },
  );

  const result = withSchemaResearchBudget(
    parseSchemaResearchTaskResultText(finalResponse.content, limits),
    budget,
    usedRounds,
    limits,
  );
  emitSchemaResearchEvidenceEvents(hooks?.onEvent, agentNodeId, result, isZh);
  emitAiWorkflowEvent(hooks?.onEvent, {
    type: "node.update",
    nodeId: agentNodeId,
    status: schemaResearchWorkflowStatus(result.status),
    description: result.summary,
  });

  return {
    result,
    internalToolTraces,
  };
}

function schemaResearchWorkflowStatus(status: SchemaResearchStatus): "success" | "error" | "waiting" {
  if (status === "error" || status === "not_found") return "error";
  if (status === "need_user_choice") return "waiting";
  return "success";
}

function emitSchemaResearchEvidenceEvents(
  onEvent: AiWorkflowEventHandler | undefined,
  parentNodeId: string,
  result: SchemaResearchTaskResult,
  isZh: boolean,
) {
  const tableCount = result.evidence.tables.length;
  const relationCount = result.evidence.relations.length;
  const uncertaintyCount = result.uncertainties.length;
  emitAiWorkflowEvent(onEvent, {
    type: "evidence",
    nodeId: uuid(),
    parentId: parentNodeId,
    status: result.status,
    summary: isZh
      ? `${result.summary}。证据：${tableCount} 张表，${relationCount} 条关系，${uncertaintyCount} 个不确定项。`
      : `${result.summary}. Evidence: ${tableCount} table(s), ${relationCount} relation(s), ${uncertaintyCount} uncertainty item(s).`,
  });
}

interface ResolvedSchemaResearchSettings {
  enabled: boolean;
  config: AiConfig;
  maxToolRounds: number;
  maxOutputTokens: number;
}

function resolveSchemaResearchSettings(config: AiConfig): ResolvedSchemaResearchSettings {
  const schemaResearch = config.schemaResearch;
  if (!schemaResearch) {
    return {
      enabled: true,
      config,
      maxToolRounds: MAX_SCHEMA_RESEARCH_TOOL_ROUNDS,
      maxOutputTokens: MAX_SCHEMA_RESEARCH_OUTPUT_TOKENS,
    };
  }
  if (!schemaResearch.enabled) {
    return {
      enabled: false,
      config,
      maxToolRounds: schemaResearch.maxToolRounds || MAX_SCHEMA_RESEARCH_TOOL_ROUNDS,
      maxOutputTokens: schemaResearch.maxOutputTokens || MAX_SCHEMA_RESEARCH_OUTPUT_TOKENS,
    };
  }
  if (schemaResearch.useMainModel) {
    return {
      enabled: true,
      config,
      maxToolRounds: schemaResearch.maxToolRounds || MAX_SCHEMA_RESEARCH_TOOL_ROUNDS,
      maxOutputTokens: schemaResearch.maxOutputTokens || MAX_SCHEMA_RESEARCH_OUTPUT_TOKENS,
    };
  }
  return {
    enabled: true,
    config: {
      provider: schemaResearch.provider,
      apiKey: schemaResearch.apiKey,
      endpoint: schemaResearch.endpoint,
      model: schemaResearch.model,
      apiStyle: schemaResearch.apiStyle,
      proxyEnabled: schemaResearch.proxyEnabled,
      proxyUrl: schemaResearch.proxyUrl,
      enableThinking: false,
      schemaResearch,
    },
    maxToolRounds: schemaResearch.maxToolRounds || MAX_SCHEMA_RESEARCH_TOOL_ROUNDS,
    maxOutputTokens: schemaResearch.maxOutputTokens || MAX_SCHEMA_RESEARCH_OUTPUT_TOKENS,
  };
}

export function resolveSchemaResearchAiConfig(config: AiConfig): AiConfig {
  return resolveSchemaResearchSettings(config).config;
}

function supportsSchemaResearchModel(config: AiConfig): boolean {
  if (config.apiStyle !== "completions") return false;
  return !["claude", "gemini"].includes(config.provider);
}

function buildSchemaResearchSystemPrompt(
  input: AiRequestInput,
  args: Record<string, any>,
  limits: SchemaResearchResultLimits,
): string {
  const isZh = currentLocale() === "zh-CN";
  const constraints =
    args.constraints && typeof args.constraints === "object" ? (args.constraints as Record<string, unknown>) : {};
  const requireRelations = constraints.requireRelations === true;
  const allowUserChoice = constraints.allowUserChoice === true;
  const jsonContract = schemaResearchJsonContract(limits);
  const lines = isZh
    ? [
        "你是 DBX Schema Research 子任务模型。用中文写 summary/reason/message，但只输出 JSON。",
        "你的职责是查找表、字段、关系证据；不是生成最终 SQL。",
        "优先使用 dbx_search_schema 查表；如果没有索引或结果不足，使用 dbx_list_tables/dbx_find_columns。",
        "当 dbx_search_schema 命中接口文档、接口文档事实、业务概念或多个候选表时，调用 dbx_expand_schema_graph 扩展 Kuzu 图关系。",
        "dbx_expand_schema_graph 返回 candidate 时不能直接当 verified 使用；需要 dbx_get_column_details 或 verified graph fact 支撑。",
        "确认表后，优先使用 dbx_search_table_columns 获取字段摘要；只有字段要作为证据返回时，必须调用 dbx_get_column_details 获取实时详情并把 verified 设为 true。",
        "只有确实需要整表索引或外键时才调用 dbx_load_table_schema。",
        "需要 JOIN 或主任务要求关系时，调用 dbx_get_related_tables 查真实外键；没有可靠关系时，不要猜测为 high confidence。",
        "中文业务词检索时，同时加入英文业务词和标识符片段，例如：评价 review rating comment feedback score。",
        allowUserChoice
          ? "如果候选表/字段/关系无法确定，返回 status=need_user_choice，并在 uncertainties 写清要主模型让用户确认什么。"
          : "如果候选无法确定，返回 status=partial，不要假装确定。",
        "不要调用用户选择工具，不要调用沉淀工具，不要编造工具结果中没有的表、字段或关系。",
        `最多返回 ${limits.maxTables ?? MAX_SCHEMA_RESEARCH_TABLES} 张表，每张表最多 ${limits.maxColumnsPerTable ?? MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE} 个字段。`,
        requireRelations ? "本任务要求关系证据；如果关系不足，status 不要返回 sufficient。" : "",
        "输出必须是单个 JSON 对象，不要 Markdown，不要解释性前后缀。",
        jsonContract,
      ]
    : [
        "You are the DBX Schema Research subtask model. Write summary/reason/message in English and output JSON only.",
        "Your job is to find table, column, and relation evidence; do not generate final SQL.",
        "Prefer dbx_search_schema for table search; if no index or results are insufficient, use dbx_list_tables/dbx_find_columns.",
        "When dbx_search_schema hits API documents, API document facts, business concepts, or multiple candidate tables, call dbx_expand_schema_graph to expand Kuzu graph relationships.",
        "Candidate facts from dbx_expand_schema_graph are not verified SQL evidence; support them with dbx_get_column_details or verified graph facts.",
        "After confirming a table, prefer dbx_search_table_columns for column summaries; before returning a column as evidence, call dbx_get_column_details and set verified=true.",
        "Call dbx_load_table_schema only when full indexes or foreign keys are truly needed.",
        "For JOIN needs or relation requirements, call dbx_get_related_tables for real foreign keys; do not mark guessed relations as high confidence.",
        "For Chinese business terms, include English business terms and identifier fragments, for example: 评价 review rating comment feedback score.",
        allowUserChoice
          ? "If table/column/relation candidates remain ambiguous, return status=need_user_choice and state what the main model should ask the user to confirm in uncertainties."
          : "If candidates remain ambiguous, return status=partial rather than pretending certainty.",
        "Do not call user-choice tools, do not call enrichment tools, and do not invent tables, columns, or relations not present in tool results.",
        `Return at most ${limits.maxTables ?? MAX_SCHEMA_RESEARCH_TABLES} tables and ${limits.maxColumnsPerTable ?? MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE} columns per table.`,
        requireRelations
          ? "This task requires relation evidence; do not return sufficient if relations remain missing."
          : "",
        "Output exactly one JSON object. No Markdown and no explanatory prefix/suffix.",
        jsonContract,
      ];

  return [
    ...lines,
    "",
    `Database type: ${input.context.databaseType}`,
    `Database: ${input.context.database}`,
    input.context.schema ? `Schema: ${input.context.schema}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSchemaResearchUserPrompt(
  input: AiRequestInput,
  args: Record<string, any>,
  limits: SchemaResearchResultLimits,
): string {
  const requiredEvidence = Array.isArray(args.requiredEvidence)
    ? args.requiredEvidence.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const knownContext = args.knownContext && typeof args.knownContext === "object" ? args.knownContext : {};
  return JSON.stringify(
    {
      task: String(args.task || "").trim(),
      requiredEvidence,
      constraints: args.constraints || {},
      limits: {
        maxTables: limits.maxTables ?? MAX_SCHEMA_RESEARCH_TABLES,
        maxColumnsPerTable: limits.maxColumnsPerTable ?? MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE,
      },
      currentSql: String((knownContext as Record<string, unknown>).currentSql || input.context.currentSql || "").trim(),
      mentionedTables: Array.isArray((knownContext as Record<string, unknown>).mentionedTables)
        ? (knownContext as Record<string, unknown>).mentionedTables
        : input.context.tables.map((table) => ({
            schema: table.schema || input.context.schema || "",
            table: table.name,
          })),
    },
    null,
    2,
  );
}

function schemaResearchJsonContract(limits: SchemaResearchResultLimits): string {
  return JSON.stringify(
    {
      status: "sufficient | partial | need_user_choice | not_found | error",
      summary: "short result summary",
      evidence: {
        tables: `array, max ${limits.maxTables ?? MAX_SCHEMA_RESEARCH_TABLES}; each item has schema, table, tableType, comment, reason, confidence, columns`,
        columns:
          "inside each table, max per table; each item has name, dataType, nullable, primaryKey, comment, usage, reason, verified",
        relations:
          "array; each item has leftSchema, leftTable, leftColumn, rightSchema, rightTable, rightColumn, source, confidence",
        rejectedCandidates: [{ schema: "schema", table: "table", column: "optional", reason: "why rejected" }],
        notes: ["short note"],
      },
      uncertainties: [{ kind: "table | column | relation", message: "what is uncertain", candidates: [] }],
      toolBudget: {
        usedRounds: 0,
        schemaSearches: 0,
        columnSearches: 0,
        tableLoads: 0,
        columnDetails: 0,
        relationLookups: 0,
      },
    },
    null,
    2,
  );
}

function schemaResearchLimits(args: Record<string, any>): SchemaResearchResultLimits {
  const constraints =
    args.constraints && typeof args.constraints === "object" ? (args.constraints as Record<string, unknown>) : {};
  return {
    maxTables: clampToolLimit(constraints.maxTables, 1, 6, MAX_SCHEMA_RESEARCH_TABLES),
    maxColumnsPerTable: clampToolLimit(constraints.maxColumnsPerTable, 1, 20, MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE),
    maxRelations: 8,
    maxRejectedCandidates: 8,
    maxUncertainties: 6,
    maxNotes: 8,
  };
}

function withSchemaResearchBudget(
  result: SchemaResearchTaskResult,
  budget: AiSchemaToolBudget,
  usedRounds: number,
  limits: SchemaResearchResultLimits,
): SchemaResearchTaskResult {
  return normalizeSchemaResearchTaskResult(
    {
      ...result,
      toolBudget: {
        usedRounds,
        schemaSearches: budget.schemaSearches,
        columnSearches: budget.columnSearches,
        tableLoads: budget.tableLoads,
        columnDetails: budget.columnDetails,
        relationLookups: budget.relationLookups,
      },
    },
    {
      maxTables: limits.maxTables ?? MAX_SCHEMA_RESEARCH_TABLES,
      maxColumnsPerTable: limits.maxColumnsPerTable ?? MAX_SCHEMA_RESEARCH_COLUMNS_PER_TABLE,
      maxRelations: limits.maxRelations,
      maxRejectedCandidates: limits.maxRejectedCandidates,
      maxUncertainties: limits.maxUncertainties,
      maxNotes: limits.maxNotes,
    },
  );
}

const SCHEMA_RESEARCH_SUBTASK_ALLOWED_TOOL_NAMES = [
  "dbx_search_schema",
  "dbx_list_tables",
  "dbx_find_columns",
  "dbx_search_table_columns",
  "dbx_get_column_details",
  "dbx_load_table_schema",
  "dbx_get_related_tables",
  "dbx_expand_schema_graph",
];

export function schemaResearchSubtaskAllowedToolNamesForTest(): string[] {
  return [...SCHEMA_RESEARCH_SUBTASK_ALLOWED_TOOL_NAMES];
}

export function schemaRagScopeForContextForTest(context: AiContext, schema?: string): SchemaRagToolScope {
  return schemaRagScopeForContext(context, schema);
}

function isSchemaResearchSubtaskToolAllowed(name: string): boolean {
  return SCHEMA_RESEARCH_SUBTASK_ALLOWED_TOOL_NAMES.includes(name);
}

function compactSchemaResearchToolOutput(name: string, output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const data = output as Record<string, any>;
  if (data.error) return { error: data.error };
  if (name === "dbx_search_schema") {
    const tables = Array.isArray(data.tables) ? data.tables : [];
    return {
      indexed: data.indexed,
      tables: tables.slice(0, 6).map((table) => ({
        schema: table.schema,
        name: table.name,
        tableType: table.tableType,
        score: table.score,
        reason: table.reason,
        matchedColumns: Array.isArray(table.matchedColumns)
          ? table.matchedColumns.slice(0, 8).map((column: any) => ({
              name: column.name,
              comment: column.comment,
              primaryKey: column.primaryKey,
              dataType: column.dataType,
              score: column.score,
              reason: column.reason,
            }))
          : [],
        relatedTables: Array.isArray(table.relatedTables) ? table.relatedTables.slice(0, 4) : [],
      })),
      message: data.message,
    };
  }
  if (name === "dbx_list_tables") {
    const tables = Array.isArray(data.tables) ? data.tables : [];
    return {
      schema: data.schema,
      keyword: data.keyword,
      totalMatched: data.totalMatched,
      truncated: data.truncated,
      tables: tables.slice(0, 20),
    };
  }
  if (name === "dbx_find_columns") {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return {
      schema: data.schema,
      query: data.query,
      matches: matches.slice(0, 30),
    };
  }
  if (name === "dbx_search_table_columns") {
    const columns = Array.isArray(data.columns) ? data.columns : [];
    return {
      indexed: data.indexed,
      indexUnavailable: data.indexUnavailable,
      schema: data.schema,
      table: data.table,
      query: data.query,
      totalColumns: data.totalColumns,
      truncated: data.truncated,
      columns: columns.slice(0, 15),
      message: data.message,
    };
  }
  if (name === "dbx_get_column_details") {
    return {
      schema: data.schema,
      table: data.table,
      columns: Array.isArray(data.columns) ? data.columns : [],
      missingColumns: Array.isArray(data.missingColumns) ? data.missingColumns : [],
    };
  }
  if (name === "dbx_load_table_schema") {
    return {
      schema: data.schema,
      table: data.table,
      columns: Array.isArray(data.columns) ? data.columns.slice(0, 40) : [],
      indexes: Array.isArray(data.indexes) ? data.indexes.slice(0, 12) : [],
      foreignKeys: Array.isArray(data.foreignKeys) ? data.foreignKeys.slice(0, 12) : [],
    };
  }
  if (name === "dbx_get_related_tables") {
    return {
      schema: data.schema,
      table: data.table,
      relations: Array.isArray(data.relations) ? data.relations.slice(0, 12) : [],
      message: data.message,
    };
  }
  if (name === "dbx_expand_schema_graph") {
    return {
      verifiedMappings: Array.isArray(data.verifiedMappings) ? data.verifiedMappings.slice(0, 12) : [],
      candidateMappings: Array.isArray(data.candidateMappings) ? data.candidateMappings.slice(0, 12) : [],
      joinCandidates: Array.isArray(data.joinCandidates) ? data.joinCandidates.slice(0, 12) : [],
      concepts: Array.isArray(data.concepts) ? data.concepts.slice(0, 12) : [],
      sourceEvidence: Array.isArray(data.sourceEvidence) ? data.sourceEvidence.slice(0, 12) : [],
      message: data.message,
    };
  }
  return output;
}

async function executeAiSchemaToolCall(
  input: AiRequestInput,
  context: AiContext,
  budget: AiSchemaToolBudget,
  name: string,
  rawArguments: string,
  onRelationRequest?: AiRelationRequestHandler,
  onTableChoiceRequest?: AiTableChoiceRequestHandler,
  onColumnChoiceRequest?: AiColumnChoiceRequestHandler,
  hooks?: AiSchemaToolWorkflowHooks,
): Promise<unknown> {
  const args = parseToolArguments(rawArguments);
  if (name === "dbx_schema_research_task") {
    return executeSchemaResearchTaskTool(input, budget, args, hooks);
  }
  if (name === "dbx_search_schema") {
    return executeSchemaSearchTool(context, budget, args);
  }
  if (name === "dbx_list_tables") {
    return executeListTablesTool(context, budget, args);
  }
  if (name === "dbx_find_columns") {
    return executeFindColumnsTool(context, budget, args);
  }
  if (name === "dbx_request_table_choice") {
    return executeRequestTableChoiceTool(budget, args, onTableChoiceRequest);
  }
  if (name === "dbx_search_table_columns") {
    return executeSearchTableColumnsTool(context, budget, args);
  }
  if (name === "dbx_get_column_details") {
    return executeGetColumnDetailsTool(context, budget, args);
  }
  if (name === "dbx_load_table_schema") {
    return executeLoadTableSchemaTool(context, budget, args);
  }
  if (name === "dbx_request_column_choice") {
    return executeRequestColumnChoiceTool(context, budget, args, onColumnChoiceRequest);
  }
  if (name === "dbx_save_schema_enrichment") {
    return executeSaveSchemaEnrichmentTool(context, budget, args);
  }
  if (name === "dbx_get_related_tables") {
    return executeGetRelatedTablesTool(context, budget, args);
  }
  if (name === "dbx_expand_schema_graph") {
    return executeExpandSchemaGraphTool(context, args);
  }
  if (name === "dbx_request_relation") {
    return executeRequestRelationTool(context, budget, args, onRelationRequest);
  }
  return { error: `Unknown tool: ${name}` };
}

function parseToolArguments(rawArguments: string): Record<string, any> {
  if (!rawArguments.trim()) return {};
  const parsed = JSON.parse(rawArguments);
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function executeSchemaSearchTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId || !context.schema) return { error: "No active connection/schema for Schema RAG." };
  if (budget.schemaSearches >= MAX_AI_SCHEMA_SEARCH_CALLS) {
    return { error: `Schema search budget exceeded (${MAX_AI_SCHEMA_SEARCH_CALLS}).` };
  }
  const query = String(args.query || "").trim();
  if (!query) return { error: "query is required" };
  const queryKey = normalizeSchemaToolKey(query);
  if (budget.searchedQueries.has(queryKey)) {
    return {
      error: "Duplicate schema search skipped. Reuse the previous result or ask for a narrower query.",
      budget: {
        schemaSearches: budget.schemaSearches,
        maxSchemaSearches: MAX_AI_SCHEMA_SEARCH_CALLS,
      },
    };
  }
  budget.searchedQueries.add(queryKey);
  budget.schemaSearches += 1;

  const scope = schemaRagScopeForContext(context);
  const status = await api.loadSchemaRagStatus(scope);
  if (!status.indexed) return { indexed: false, tables: [], message: "Current schema has not been analyzed." };
  const result = await api.searchSchemaRag({
    ...scope,
    query,
    limit: clampToolLimit(args.limit, 1, 8, 6),
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
      relatedTables: table.relatedTables.slice(0, MAX_SCHEMA_RAG_RELATED_TABLES),
    })),
    budget: {
      schemaSearches: budget.schemaSearches,
      maxSchemaSearches: MAX_AI_SCHEMA_SEARCH_CALLS,
    },
  };
}

async function executeListTablesTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for table listing." };
  if (budget.tableLists >= MAX_AI_TABLE_LIST_CALLS) {
    return { error: `Table list budget exceeded (${MAX_AI_TABLE_LIST_CALLS}).` };
  }
  budget.tableLists += 1;

  const schema = String(args.schema || context.schema || context.database || "").trim();
  if (!schema) return { error: "schema is required" };
  const keyword = String(args.keyword || "").trim() || undefined;
  const limit = clampToolLimit(args.limit, 1, 50, 20);
  const tables = await api.listTables(context.connectionId, context.database, schema, keyword, limit);
  const filteredTables = keyword
    ? tables.filter((table) => table.name.toLowerCase().includes(keyword.toLowerCase()))
    : tables;
  const returnedTables = filteredTables.slice(0, limit);
  return {
    schema,
    keyword: keyword || "",
    limit,
    totalMatched: filteredTables.length,
    truncated: filteredTables.length > returnedTables.length,
    tables: returnedTables.map((table) => ({
      schema,
      name: table.name,
      tableType: table.table_type,
      comment: table.comment,
    })),
    budget: {
      tableLists: budget.tableLists,
      maxTableLists: MAX_AI_TABLE_LIST_CALLS,
    },
  };
}

async function executeFindColumnsTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for column search." };
  if (budget.columnSearches >= MAX_AI_COLUMN_SEARCH_CALLS) {
    return { error: `Column search budget exceeded (${MAX_AI_COLUMN_SEARCH_CALLS}).` };
  }
  const query = String(args.query || "").trim();
  if (!query) return { error: "query is required" };
  budget.columnSearches += 1;

  const schema = String(args.schema || context.schema || context.database || "").trim();
  if (!schema) return { error: "schema is required" };
  const limit = clampToolLimit(args.limit, 1, 80, 40);
  const terms = query
    .toLowerCase()
    .split(/[\s,.;:/\\|]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const tables = await api.listTables(context.connectionId, context.database, schema, undefined, 200);
  const matches: Array<Record<string, unknown>> = [];
  for (const table of tables) {
    if (matches.length >= limit) break;
    const columns = await api
      .getColumns(context.connectionId, context.database, schema, table.name)
      .catch(() => [] as ColumnInfo[]);
    for (const column of columns) {
      const haystack = [table.name, table.comment, column.name, column.comment, column.data_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!terms.length || terms.some((term) => haystack.includes(term))) {
        matches.push({
          schema,
          table: table.name,
          tableType: table.table_type,
          tableComment: table.comment,
          column: column.name,
          dataType: column.data_type,
          nullable: column.is_nullable,
          primaryKey: column.is_primary_key,
          comment: column.comment,
        });
      }
      if (matches.length >= limit) break;
    }
  }
  return {
    schema,
    query,
    matches,
    budget: {
      columnSearches: budget.columnSearches,
      maxColumnSearches: MAX_AI_COLUMN_SEARCH_CALLS,
    },
  };
}

async function executeRequestTableChoiceTool(
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
  onTableChoiceRequest?: AiTableChoiceRequestHandler,
): Promise<unknown> {
  if (!onTableChoiceRequest) return { confirmed: false, skipped: true, message: "Table choice UI is not available." };
  if (budget.tableChoiceRequests >= MAX_AI_TABLE_CHOICE_REQUESTS) {
    return { error: `Table choice budget exceeded (${MAX_AI_TABLE_CHOICE_REQUESTS}).` };
  }
  budget.tableChoiceRequests += 1;
  const candidates = parseTableChoiceCandidates(args.candidates);
  if (!candidates.length) return { error: "candidates are required" };
  const request: AiTableChoiceRequest = {
    id: uuid(),
    question: String(
      args.question || (currentLocale() === "zh-CN" ? "请选择要使用的表" : "Choose the table to use"),
    ).trim(),
    reason: typeof args.reason === "string" ? args.reason : undefined,
    allowManual: true,
    candidates,
  };
  return onTableChoiceRequest(request);
}

async function executeSearchTableColumnsTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for column vector search." };
  if (budget.columnSearches >= MAX_AI_COLUMN_SEARCH_CALLS) {
    return { error: `Column search budget exceeded (${MAX_AI_COLUMN_SEARCH_CALLS}).` };
  }
  const schema = String(args.schema || context.schema || "").trim();
  const table = String(args.table || "").trim();
  const query = String(args.query || "").trim();
  if (!schema || !table || !query) return { error: "schema, table, and query are required" };
  budget.columnSearches += 1;

  const scope = schemaRagScopeForContext(context, schema);
  const status = await api.loadSchemaRagStatus(scope);
  if (!status.indexed) {
    return {
      indexed: false,
      indexUnavailable: true,
      schema,
      table,
      query,
      columns: [],
      message:
        "Current schema has not been analyzed. Use dbx_find_columns or dbx_get_column_details as a live metadata fallback.",
      budget: {
        columnSearches: budget.columnSearches,
        maxColumnSearches: MAX_AI_COLUMN_SEARCH_CALLS,
      },
    };
  }

  const result = await api.searchTableColumnsRag({
    ...scope,
    table,
    query,
    limit: clampToolLimit(args.limit, 1, 30, 12),
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
      score: column.score,
      reason: column.reason,
    })),
    budget: {
      columnSearches: budget.columnSearches,
      maxColumnSearches: MAX_AI_COLUMN_SEARCH_CALLS,
    },
  };
}

async function executeGetColumnDetailsTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for column details." };
  if (budget.columnDetails >= MAX_AI_COLUMN_DETAIL_CALLS) {
    return { error: `Column detail budget exceeded (${MAX_AI_COLUMN_DETAIL_CALLS}).` };
  }
  const schema = String(args.schema || context.schema || "").trim();
  const table = String(args.table || "").trim();
  const requestedColumns = Array.isArray(args.columns)
    ? args.columns.map((column) => String(column || "").trim()).filter(Boolean)
    : [];
  if (!schema || !table) return { error: "schema and table are required" };
  if (!requestedColumns.length) return { error: "columns are required" };
  budget.columnDetails += 1;

  const liveColumns = await api.getColumns(context.connectionId, context.database, schema, table);
  const byName = new Map(liveColumns.map((column) => [normalizeSchemaToolKey(column.name), column]));
  const columns = requestedColumns
    .map((name) => byName.get(normalizeSchemaToolKey(name)))
    .filter((column): column is ColumnInfo => !!column)
    .map((column) => ({
      name: column.name,
      dataType: column.data_type,
      nullable: column.is_nullable,
      primaryKey: column.is_primary_key,
      default: column.column_default,
      extra: column.extra,
      comment: column.comment,
    }));
  const missingColumns = requestedColumns.filter((name) => !byName.has(normalizeSchemaToolKey(name)));
  return {
    schema,
    table,
    columns,
    missingColumns,
    budget: {
      columnDetails: budget.columnDetails,
      maxColumnDetails: MAX_AI_COLUMN_DETAIL_CALLS,
    },
  };
}

async function executeLoadTableSchemaTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for schema loading." };
  if (budget.tableLoads >= MAX_AI_SCHEMA_TABLE_LOADS) {
    return { error: `Table schema load budget exceeded (${MAX_AI_SCHEMA_TABLE_LOADS}).` };
  }
  const schema = String(args.schema || context.schema || "").trim();
  const table = String(args.table || "").trim();
  if (!schema || !table) return { error: "schema and table are required" };
  const tableKey = normalizeSchemaToolKey(`${schema}.${table}`);
  if (budget.loadedTables.has(tableKey)) {
    return {
      error: "Duplicate table schema load skipped. Reuse the previously loaded table schema.",
      budget: {
        tableLoads: budget.tableLoads,
        maxTableLoads: MAX_AI_SCHEMA_TABLE_LOADS,
      },
    };
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
    columns: columns.map((column) => ({
      name: column.name,
      dataType: column.data_type,
      nullable: column.is_nullable,
      primaryKey: column.is_primary_key,
      default: column.column_default,
      extra: column.extra,
    })),
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
    budget: {
      tableLoads: budget.tableLoads,
      maxTableLoads: MAX_AI_SCHEMA_TABLE_LOADS,
    },
  };
}

async function executeRequestColumnChoiceTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
  onColumnChoiceRequest?: AiColumnChoiceRequestHandler,
): Promise<unknown> {
  if (!onColumnChoiceRequest) return { confirmed: false, skipped: true, message: "Column choice UI is not available." };
  if (!context.connectionId) return { error: "No active connection for column choice." };
  if (budget.columnChoiceRequests >= MAX_AI_COLUMN_CHOICE_REQUESTS) {
    return { error: `Column choice budget exceeded (${MAX_AI_COLUMN_CHOICE_REQUESTS}).` };
  }
  budget.columnChoiceRequests += 1;

  const schema = String(args.schema || context.schema || "").trim();
  const table = String(args.table || "").trim();
  if (!schema || !table) return { error: "schema and table are required" };
  const columns = await api.getColumns(context.connectionId, context.database, schema, table);
  const request: AiColumnChoiceRequest = {
    id: uuid(),
    schema,
    table,
    question: String(
      args.question || (currentLocale() === "zh-CN" ? "请选择要使用的字段" : "Choose the column(s) to use"),
    ).trim(),
    reason: typeof args.reason === "string" ? args.reason : undefined,
    multiple: args.multiple === true,
    allowManual: true,
    candidates: mergeColumnChoiceCandidates(parseColumnChoiceCandidates(args.candidates, columns), columns),
  };
  return onColumnChoiceRequest(request);
}

function parseTableChoiceCandidates(value: unknown): AiTableChoiceCandidate[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, AiTableChoiceCandidate>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    const schema = String(data.schema || data.schemaName || "").trim();
    const table = String(data.table || data.name || data.tableName || "").trim();
    if (!schema || !table) continue;
    const key = normalizeSchemaToolKey(`${schema}.${table}`);
    if (unique.has(key)) continue;
    unique.set(key, {
      schema,
      table,
      tableType: optionalToolString(data.tableType),
      comment: optionalToolString(data.comment) ?? null,
      score: optionalToolNumber(data.score),
      reason: optionalToolString(data.reason),
    });
  }
  return [...unique.values()].slice(0, MAX_AI_TABLE_CHOICE_CANDIDATES);
}

function parseColumnChoiceCandidates(value: unknown, columns: ColumnInfo[]): AiColumnChoiceCandidate[] {
  if (!Array.isArray(value)) return [];
  const liveColumns = new Map(columns.map((column) => [normalizeSchemaToolKey(column.name), column]));
  const unique = new Map<string, AiColumnChoiceCandidate>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    const rawColumn = String(data.column || data.name || data.columnName || "").trim();
    const liveColumn = liveColumns.get(normalizeSchemaToolKey(rawColumn));
    if (!liveColumn) continue;
    const key = normalizeSchemaToolKey(liveColumn.name);
    if (unique.has(key)) continue;
    unique.set(key, {
      column: liveColumn.name,
      dataType: optionalToolString(data.dataType) || liveColumn.data_type,
      nullable: typeof data.nullable === "boolean" ? data.nullable : liveColumn.is_nullable,
      primaryKey: typeof data.primaryKey === "boolean" ? data.primaryKey : liveColumn.is_primary_key,
      comment: optionalToolString(data.comment) ?? liveColumn.comment,
      score: optionalToolNumber(data.score),
      reason: optionalToolString(data.reason),
    });
  }
  return [...unique.values()].slice(0, MAX_AI_COLUMN_CHOICE_CANDIDATES);
}

function mergeColumnChoiceCandidates(
  candidates: AiColumnChoiceCandidate[],
  columns: ColumnInfo[],
): AiColumnChoiceCandidate[] {
  if (candidates.length) return candidates.slice(0, MAX_AI_COLUMN_CHOICE_CANDIDATES);
  return columns.slice(0, MAX_AI_COLUMN_CHOICE_CANDIDATES).map((column) => ({
    column: column.name,
    dataType: column.data_type,
    nullable: column.is_nullable,
    primaryKey: column.is_primary_key,
    comment: column.comment,
  }));
}

async function executeSaveSchemaEnrichmentTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId || !context.schema) return { error: "No active connection/schema for schema enrichment." };
  if (budget.enrichmentSaves >= MAX_AI_ENRICHMENT_SAVES) {
    return { error: `Schema enrichment save budget exceeded (${MAX_AI_ENRICHMENT_SAVES}).` };
  }
  const confirmationSource = String(args.confirmationSource || "").trim();
  if (!["explicit_user_request", "user_choice_confirmed"].includes(confirmationSource)) {
    return {
      error:
        "confirmationSource must be explicit_user_request or user_choice_confirmed. Do not save model-guessed mappings.",
    };
  }
  const aliases = parseSchemaEnrichmentAliases(args.aliases, context.schema);
  if (!aliases.length) return { error: "aliases are required" };
  budget.enrichmentSaves += 1;
  const response = await api.saveSchemaRagEnrichment({
    connectionId: context.connectionId,
    database: context.database,
    schema: context.schema,
    aliases: aliases.slice(0, MAX_AI_ENRICHMENT_ALIASES).map((alias) => ({
      term: alias.term,
      targetKind: alias.targetKind,
      table: alias.table,
      column: alias.column,
      note: alias.note,
      confidence: 1,
      source: confirmationSource,
    })),
  });
  return {
    savedAliases: response.savedAliases,
    confirmationSource,
    aliases: aliases.map((alias) => ({
      term: alias.term,
      targetKind: alias.targetKind,
      schema: context.schema,
      table: alias.table,
      column: alias.column,
    })),
    budget: {
      enrichmentSaves: budget.enrichmentSaves,
      maxEnrichmentSaves: MAX_AI_ENRICHMENT_SAVES,
    },
  };
}

function parseSchemaEnrichmentAliases(value: unknown, defaultSchema: string): api.SchemaRagBusinessAliasInput[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, api.SchemaRagBusinessAliasInput>();
  for (const item of value.slice(0, MAX_AI_ENRICHMENT_ALIASES)) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    const term = String(data.term || data.alias || data.businessTerm || "").trim();
    const targetKind = String(data.targetKind || data.target_kind || (data.column ? "column" : "table")).trim();
    const schema = String(data.schema || defaultSchema || "").trim();
    const table = String(data.table || data.name || data.tableName || "").trim();
    const column = optionalToolString(data.column || data.columnName) ?? null;
    if (!term || !schema || !table) continue;
    if (normalizeSchemaToolKey(schema) !== normalizeSchemaToolKey(defaultSchema)) continue;
    if (!["table", "column"].includes(targetKind)) continue;
    if (targetKind === "column" && !column) continue;
    if (targetKind === "table" && column) continue;
    const key = normalizeSchemaToolKey(`${term}:${targetKind}:${schema}.${table}.${column || ""}`);
    if (unique.has(key)) continue;
    unique.set(key, {
      term,
      targetKind: targetKind as "table" | "column",
      table,
      column,
      note: optionalToolString(data.note) ?? null,
      confidence: 1,
    });
  }
  return [...unique.values()];
}

function optionalToolString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalToolNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function executeGetRelatedTablesTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
): Promise<unknown> {
  if (!context.connectionId) return { error: "No active connection for relation lookup." };
  if (budget.relationLookups >= MAX_AI_RELATION_LOOKUPS) {
    return { error: `Relation lookup budget exceeded (${MAX_AI_RELATION_LOOKUPS}).` };
  }
  budget.relationLookups += 1;

  const schema = String(args.schema || context.schema || "").trim();
  const table = String(args.table || "").trim();
  if (!schema || !table) return { error: "schema and table are required" };
  const foreignKeys = await api
    .listForeignKeys(context.connectionId, context.database, schema, table)
    .catch(() => [] as ForeignKeyInfo[]);
  return {
    schema,
    table,
    relations: foreignKeys.map((fk) => ({
      source: "database-foreign-key",
      name: fk.name,
      leftSchema: schema,
      leftTable: table,
      leftColumn: fk.column,
      rightTable: fk.ref_table,
      rightColumn: fk.ref_column,
    })),
    message: foreignKeys.length
      ? undefined
      : "No database foreign keys were found for this table. Ask the user to confirm join columns if a join is required.",
    budget: {
      relationLookups: budget.relationLookups,
      maxRelationLookups: MAX_AI_RELATION_LOOKUPS,
    },
  };
}

async function executeExpandSchemaGraphTool(context: AiContext, args: Record<string, any>): Promise<unknown> {
  if (!context.connectionId || !context.schema) return { error: "No active connection/schema for graph expansion." };
  const seeds = Array.isArray(args.seeds)
    ? args.seeds
        .map((seed) => normalizeSchemaGraphSeed(seed))
        .filter((seed): seed is NonNullable<ReturnType<typeof normalizeSchemaGraphSeed>> => !!seed)
    : [];
  if (!seeds.length) return { error: "seeds are required" };
  const scope = schemaRagScopeForContext(context);
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
    limit: clampToolLimit(args.limit, 1, 100, 20),
  });
  return {
    indexed: true,
    verifiedMappings: result.verifiedMappings.slice(0, 20),
    candidateMappings: result.candidateMappings.slice(0, 20),
    joinCandidates: result.joinCandidates.slice(0, 20),
    concepts: result.concepts.slice(0, 20),
    sourceEvidence: result.sourceEvidence.slice(0, 20),
    message:
      result.verifiedMappings.length ||
      result.candidateMappings.length ||
      result.joinCandidates.length ||
      result.concepts.length
        ? undefined
        : "No graph facts matched the provided seeds.",
  };
}

function normalizeSchemaGraphSeed(value: unknown): {
  kind: "table" | "column" | "api_doc_source" | "api_doc_section" | "api_field" | "business_concept" | "join_candidate";
  id?: string | null;
  schema?: string | null;
  table?: string | null;
  column?: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind || "").trim();
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
  return {
    kind: kind as any,
    id: optionalToolString(raw.id) ?? null,
    schema: optionalToolString(raw.schema) ?? null,
    table: optionalToolString(raw.table) ?? null,
    column: optionalToolString(raw.column) ?? null,
  };
}

async function executeRequestRelationTool(
  context: AiContext,
  budget: AiSchemaToolBudget,
  args: Record<string, any>,
  onRelationRequest?: AiRelationRequestHandler,
): Promise<unknown> {
  if (!onRelationRequest)
    return { confirmed: false, skipped: true, message: "Relation confirmation UI is not available." };
  if (!context.connectionId) return { error: "No active connection for relation confirmation." };
  if (budget.relationRequests >= MAX_AI_RELATION_REQUESTS) {
    return { error: `Relation confirmation budget exceeded (${MAX_AI_RELATION_REQUESTS}).` };
  }
  budget.relationRequests += 1;

  const leftSchema = String(args.leftSchema || args.schema || context.schema || "").trim();
  const rightSchema = String(args.rightSchema || args.schema || context.schema || "").trim();
  const leftTable = String(args.leftTable || "").trim();
  const rightTable = String(args.rightTable || "").trim();
  if (!leftSchema || !rightSchema || !leftTable || !rightTable) {
    return { error: "leftSchema, leftTable, rightSchema, and rightTable are required" };
  }

  const [leftColumns, rightColumns] = await Promise.all([
    api.getColumns(context.connectionId, context.database, leftSchema, leftTable),
    api.getColumns(context.connectionId, context.database, rightSchema, rightTable),
  ]);
  const request: AiRelationRequest = {
    id: uuid(),
    left: {
      schema: leftSchema,
      table: leftTable,
      columns: leftColumns.map(toRelationRequestColumn),
    },
    right: {
      schema: rightSchema,
      table: rightTable,
      columns: rightColumns.map(toRelationRequestColumn),
    },
    reason: typeof args.reason === "string" ? args.reason : undefined,
    candidates: mergeRelationCandidates(
      parseRelationCandidatePairs(args.candidatePairs, leftColumns, rightColumns),
      suggestRelationCandidates(leftColumns, rightColumns),
    ),
  };
  return onRelationRequest(request);
}

function clampToolLimit(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function toRelationRequestColumn(column: ColumnInfo): AiRelationRequestColumn {
  return {
    name: column.name,
    dataType: column.data_type,
    nullable: column.is_nullable,
    primaryKey: column.is_primary_key,
    comment: column.comment,
  };
}

function suggestRelationCandidates(leftColumns: ColumnInfo[], rightColumns: ColumnInfo[]): AiRelationCandidatePair[] {
  const candidates: AiRelationCandidatePair[] = [];
  const rightByName = new Map(rightColumns.map((column) => [normalizeRelationColumnName(column.name), column]));
  for (const left of leftColumns) {
    const exact = rightByName.get(normalizeRelationColumnName(left.name));
    if (exact) {
      candidates.push({ leftColumn: left.name, rightColumn: exact.name, reason: "same-name", source: "auto" });
      continue;
    }
    if (left.name.toLowerCase().endsWith("_id")) {
      const idColumn = rightByName.get("id");
      if (idColumn) {
        candidates.push({ leftColumn: left.name, rightColumn: idColumn.name, reason: "left-fk-to-id", source: "auto" });
      }
    }
  }
  const unique = new Map<string, AiRelationCandidatePair>();
  for (const candidate of candidates) {
    unique.set(`${candidate.leftColumn}:${candidate.rightColumn}`.toLowerCase(), candidate);
  }
  return [...unique.values()].slice(0, 6);
}

function parseRelationCandidatePairs(
  value: unknown,
  leftColumns: ColumnInfo[],
  rightColumns: ColumnInfo[],
): AiRelationCandidatePair[] {
  if (!Array.isArray(value)) return [];
  const leftColumnNames = new Map(leftColumns.map((column) => [normalizeRelationColumnName(column.name), column.name]));
  const rightColumnNames = new Map(
    rightColumns.map((column) => [normalizeRelationColumnName(column.name), column.name]),
  );
  const candidates: AiRelationCandidatePair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    const leftColumn = leftColumnNames.get(normalizeRelationColumnName(String(data.leftColumn || "")));
    const rightColumn = rightColumnNames.get(normalizeRelationColumnName(String(data.rightColumn || "")));
    if (!leftColumn || !rightColumn) continue;
    candidates.push({
      leftColumn,
      rightColumn,
      reason: typeof data.reason === "string" ? data.reason : undefined,
      source: "model",
    });
  }
  return candidates;
}

function mergeRelationCandidates(...groups: AiRelationCandidatePair[][]): AiRelationCandidatePair[] {
  const unique = new Map<string, AiRelationCandidatePair>();
  for (const group of groups) {
    for (const candidate of group) {
      const key = `${candidate.leftColumn}:${candidate.rightColumn}`.toLowerCase();
      if (!unique.has(key)) unique.set(key, candidate);
    }
  }
  return [...unique.values()].slice(0, 8);
}

function normalizeRelationColumnName(name: string): string {
  return name.trim().toLowerCase();
}

interface AiSchemaToolBudget {
  schemaSearches: number;
  tableLoads: number;
  tableLists: number;
  columnSearches: number;
  columnDetails: number;
  schemaResearchTasks: number;
  tableChoiceRequests: number;
  columnChoiceRequests: number;
  relationLookups: number;
  relationRequests: number;
  enrichmentSaves: number;
  searchedQueries: Set<string>;
  loadedTables: Set<string>;
}

function createAiSchemaToolBudget(): AiSchemaToolBudget {
  return {
    schemaSearches: 0,
    tableLoads: 0,
    tableLists: 0,
    columnSearches: 0,
    columnDetails: 0,
    schemaResearchTasks: 0,
    tableChoiceRequests: 0,
    columnChoiceRequests: 0,
    relationLookups: 0,
    relationRequests: 0,
    enrichmentSaves: 0,
    searchedQueries: new Set<string>(),
    loadedTables: new Set<string>(),
  };
}

function normalizeSchemaToolKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function schemaRagScopeForContext(context: AiContext, schemaOverride?: string): SchemaRagToolScope {
  const connectionId = context.connectionId || "";
  const schema = (schemaOverride || context.schema || "").trim();
  const database =
    defaultDatabaseTargetsSchema({ db_type: context.databaseType }) && schema ? schema : context.database;
  return { connectionId, database, schema };
}

function formatSchema(context: AiContext): string {
  if (!context.tables.length) return "(No table schema loaded.)";

  return context.tables
    .map((table) => {
      const name = table.schema ? `${table.schema}.${table.name}` : table.name;
      const lines: string[] = [`${name} (${table.tableType})`];

      for (const column of table.columns) {
        const flags = [
          column.is_primary_key ? "PK" : "",
          column.is_nullable ? "nullable" : "NOT NULL",
          column.column_default ? `default ${column.column_default}` : "",
          column.extra || "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`  - ${column.name}: ${column.data_type}${flags ? ` (${flags})` : ""}`);
      }

      if (table.indexes?.length) {
        for (const idx of table.indexes) {
          if (idx.is_primary) continue;
          const unique = idx.is_unique ? "UNIQUE " : "";
          lines.push(`  Index: ${unique}${idx.name}(${idx.columns.join(", ")})`);
        }
      }

      if (table.foreignKeys?.length) {
        for (const fk of table.foreignKeys) {
          lines.push(`  FK: ${fk.column} → ${fk.ref_table}.${fk.ref_column}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export async function buildAiContext(
  tab: QueryTab,
  connection: ConnectionConfig,
  options: {
    maxTables?: number;
    maxColumnsPerTable?: number;
    mentionedTables?: AiTableMention[];
    instruction?: string;
    preloadCandidateSchema?: boolean;
  } = {},
): Promise<AiContext> {
  const maxTables = options.maxTables ?? 50;
  const maxColumnsPerTable = options.maxColumnsPerTable ?? 40;
  const tables: AiSchemaTable[] = [];
  const tableKeys = new Set<string>();
  let truncated = false;
  let schemaRagContext = "";
  let schemaScope: AiContext["schemaScope"] = "database";
  const preferredSchema = activeTabSchema(tab);

  if (tab.tableMeta) {
    schemaScope = "focused_table";
    const s = tab.tableMeta.schema ?? "";
    const tName = tab.tableMeta.tableName;
    const [indexes, foreignKeys] = await Promise.all([
      api.listIndexes(tab.connectionId, tab.database, s, tName).catch(() => [] as IndexInfo[]),
      api.listForeignKeys(tab.connectionId, tab.database, s, tName).catch(() => [] as ForeignKeyInfo[]),
    ]);
    tables.push({
      schema: tab.tableMeta.schema,
      name: tName,
      tableType: "TABLE",
      columns: tab.tableMeta.columns.slice(0, maxColumnsPerTable),
      indexes,
      foreignKeys,
    });
    tableKeys.add(aiTableMentionKey(tab.tableMeta.schema, tName));
    truncated = tab.tableMeta.columns.length > maxColumnsPerTable;
  }

  for (const mention of options.mentionedTables ?? []) {
    const key = aiTableMentionKey(mention.schema, mention.table);
    if (tableKeys.has(key)) continue;
    const entry = await loadMentionedTableContext(tab, connection, mention, maxColumnsPerTable).catch(() => undefined);
    if (!entry) continue;
    tableKeys.add(aiTableMentionKey(entry.schema, entry.name));
    tables.push(entry);
  }

  if (
    (options.preloadCandidateSchema ?? true) &&
    !tab.tableMeta &&
    !tables.length &&
    !["redis", "mongodb"].includes(connection.db_type)
  ) {
    try {
      const schemas = await loadCandidateSchemas(tab, connection, preferredSchema);
      for (const schema of schemas) {
        const tableList = await api.listTables(tab.connectionId, tab.database, schema);
        const candidates = tableList.slice(0, maxTables - tables.length);
        if (candidates.length < tableList.length) truncated = true;

        const metaResults = await Promise.all(
          candidates.map((table) =>
            Promise.all([
              api.getColumns(tab.connectionId, tab.database, schema, table.name),
              api.listIndexes(tab.connectionId, tab.database, schema, table.name).catch(() => [] as IndexInfo[]),
              api
                .listForeignKeys(tab.connectionId, tab.database, schema, table.name)
                .catch(() => [] as ForeignKeyInfo[]),
            ]).then(([columns, indexes, foreignKeys]) => ({
              schema: schema === tab.database && !isSchemaAware(connection.db_type) ? undefined : schema,
              name: table.name,
              tableType: table.table_type,
              columns: columns.slice(0, maxColumnsPerTable),
              indexes,
              foreignKeys,
              _truncatedCols: columns.length > maxColumnsPerTable,
            })),
          ),
        );

        for (const meta of metaResults) {
          if (meta._truncatedCols) truncated = true;
          const { _truncatedCols, ...entry } = meta;
          const key = aiTableMentionKey(entry.schema, entry.name);
          if (tableKeys.has(key)) continue;
          tableKeys.add(key);
          tables.push(entry);
        }
        if (tables.length >= maxTables) break;
      }
    } catch {
      truncated = true;
    }
  }

  return {
    connectionName: connection.name,
    databaseType: connection.db_type,
    connectionId: tab.connectionId,
    database: tab.database,
    schema: resolveCurrentSchemaForRag(tab, connection),
    currentSql: tab.sql,
    lastError: extractLastError(tab.result),
    lastResultPreview: formatResultPreview(tab.result),
    tables,
    schemaRagContext,
    schemaScope,
    truncated,
  };
}

function resolveCurrentSchemaForRag(tab: QueryTab, connection: ConnectionConfig): string | undefined {
  const schema = activeTabSchema(tab);
  if (schema) return schema;
  if (!isSchemaAware(connection.db_type)) return tab.database || connection.database || "main";
  return undefined;
}

async function loadMentionedTableContext(
  tab: QueryTab,
  connection: ConnectionConfig,
  mention: AiTableMention,
  maxColumnsPerTable: number,
): Promise<AiSchemaTable | undefined> {
  const schema = await resolveMentionedTableSchema(tab, connection, mention);
  const [columns, indexes, foreignKeys] = await Promise.all([
    api.getColumns(tab.connectionId, tab.database, schema, mention.table),
    api.listIndexes(tab.connectionId, tab.database, schema, mention.table).catch(() => [] as IndexInfo[]),
    api.listForeignKeys(tab.connectionId, tab.database, schema, mention.table).catch(() => [] as ForeignKeyInfo[]),
  ]);
  return {
    schema: schema === tab.database && !isSchemaAware(connection.db_type) ? undefined : schema,
    name: mention.table,
    tableType: "TABLE",
    columns: columns.slice(0, maxColumnsPerTable),
    indexes,
    foreignKeys,
  };
}

async function resolveMentionedTableSchema(
  tab: QueryTab,
  connection: ConnectionConfig,
  mention: AiTableMention,
): Promise<string> {
  if (mention.schema) return mention.schema;
  if (tab.tableMeta?.tableName.toLowerCase() === mention.table.toLowerCase() && tab.tableMeta.schema) {
    return tab.tableMeta.schema;
  }
  if (isSchemaAware(connection.db_type)) {
    const schemas = await loadCandidateSchemas(tab, connection, activeTabSchema(tab));
    for (const schema of schemas) {
      const tables = await api.listTables(tab.connectionId, tab.database, schema, mention.table, 10).catch(() => []);
      if (tables.some((table) => table.name.toLowerCase() === mention.table.toLowerCase())) return schema;
    }
  }
  return tab.database || connection.database || "main";
}

function activeTabSchema(tab: QueryTab): string | undefined {
  return tab.tableMeta?.schema || tab.schema || tab.objectBrowser?.schema || tab.objectSource?.schema;
}

async function loadCandidateSchemas(
  tab: QueryTab,
  connection: ConnectionConfig,
  preferredSchema?: string,
): Promise<string[]> {
  if (isSchemaAware(connection.db_type)) {
    const schemas = await api.listSchemas(tab.connectionId, tab.database);
    return prioritizeSchemas(schemas, preferredSchema);
  }
  return [tab.database || resolveDefaultDatabase(connection, []) || "main"];
}

export function prioritizeAiCandidateSchemasForTest(schemas: string[], preferredSchema?: string): string[] {
  return prioritizeSchemas(schemas, preferredSchema);
}

function prioritizeSchemas(schemas: string[], preferredSchema?: string): string[] {
  const preferred = ["public", "dbo", "main"];
  return [...schemas].sort((a, b) => {
    const normalizedPreferred = preferredSchema?.trim().toLowerCase();
    if (normalizedPreferred) {
      const aIsPreferred = a.toLowerCase() === normalizedPreferred;
      const bIsPreferred = b.toLowerCase() === normalizedPreferred;
      if (aIsPreferred || bIsPreferred) return aIsPreferred ? -1 : 1;
    }
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : 99) - (bi >= 0 ? bi : 99);
    return a.localeCompare(b);
  });
}

function extractLastError(result?: QueryResult): string | undefined {
  if (!result?.columns.includes("Error")) return undefined;
  return result.rows[0]?.[0] == null ? undefined : String(result.rows[0][0]);
}

function formatResultPreview(result?: QueryResult): string | undefined {
  if (!result || result.columns.includes("Error") || !result.rows.length) return undefined;
  const rows = result.rows.slice(0, 5).map((row) => {
    return result.columns.map((column, index) => `${column}=${JSON.stringify(row[index] ?? null)}`).join(", ");
  });
  return rows.join("\n");
}
