# DBX Schema Research Subtask 规划

## 目标

把当前 DBX AI schema function calling 升级为“主模型发起子任务，子任务模型消化工具结果并返回压缩证据”的架构。

核心目标不是替换 Schema RAG，而是减少强模型上下文消耗：

- 强模型负责理解用户目标、发起 schema research 子任务、判断证据是否足够、生成最终 SQL。
- 子任务模型负责调用低级 schema tools、消化工具返回、筛选表/字段/关系、输出结构化证据。
- 强模型只看到压缩后的 `SchemaEvidencePackage`，不再直接吃完整工具调用过程和大量候选结果。

## 命名

内部名称建议：

- `Schema Research Subtask`
- 对外显示：`AI Schema Research`
- 主模型工具名：`dbx_schema_research_task`

不要叫 LangChain。这里是 DBX 自己实现的 Agentic Schema RAG / function calling 编排，不引入 LangChain 框架。

## 当前架构问题

当前强模型直接参与低级 schema function calling：

```text
用户问题
  -> 强模型
  -> dbx_search_schema
  -> 工具结果进入强模型上下文
  -> dbx_search_table_columns / dbx_load_table_schema / dbx_get_column_details
  -> 更多工具结果进入强模型上下文
  -> 强模型生成 SQL
```

问题：

- 工具结果、候选表、候选字段、重复调用记录都会进入强模型上下文。
- 强模型需要同时承担“检索规划、结果筛选、SQL 生成”三个角色。
- 生产库表多、字段多时，候选噪音会明显干扰最终 SQL。
- function calling 轮次越多，强模型 token 成本越高。

## 目标架构

```text
用户问题
  -> 主 AI 强模型
  -> function call: dbx_schema_research_task(task, constraints)
  -> Schema Research 子任务运行器
      -> 子任务模型
      -> 低级 schema tools
      -> 工具结果压缩与校验
  -> SchemaEvidencePackage
  -> 主 AI 强模型判断证据是否足够
      -> 足够：生成最终 SQL
      -> 不足：继续发起更窄的子任务，或请求用户确认
```

主模型仍然掌控任务。子任务模型只负责回答主模型提出的 schema research 问题。

## 配置规划

### 1. 主聊天模型配置

现有 AI 配置继续作为主模型配置：

- provider
- endpoint
- apiKey
- model
- apiStyle
- enableThinking
- proxyEnabled
- proxyUrl

用途：

- 理解用户请求。
- 发起 `dbx_schema_research_task`。
- 判断子任务证据是否足够。
- 生成最终 SQL。

### 2. Schema Research 模型配置

新增独立配置，默认复用主聊天模型。

建议字段：

```ts
interface SchemaResearchModelConfig {
  enabled: boolean;
  useMainModel: boolean;
  provider: AiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  apiStyle: AiApiStyle;
  proxyEnabled: boolean;
  proxyUrl: string;
  maxToolRounds: number;
  maxOutputTokens: number;
}
```

默认值：

```ts
{
  enabled: true,
  useMainModel: true,
  provider: settings.aiConfig.provider,
  endpoint: settings.aiConfig.endpoint,
  apiKey: settings.aiConfig.apiKey,
  model: settings.aiConfig.model,
  apiStyle: settings.aiConfig.apiStyle,
  proxyEnabled: settings.aiConfig.proxyEnabled,
  proxyUrl: settings.aiConfig.proxyUrl,
  maxToolRounds: 4,
  maxOutputTokens: 1800
}
```

用户可以把这里换成便宜模型，比如轻量 OpenAI-compatible 模型。

### 3. Embedding / Rerank 配置

继续使用现有 Schema RAG 独立配置，不复用聊天模型：

- embeddingProvider
- embeddingEndpoint
- embeddingModel
- embeddingApiKey
- embeddingDimension
- embeddingBatchSize
- embeddingConcurrency
- rerankProvider
- rerankEndpoint
- rerankModel
- rerankApiKey
- proxyEnabled
- proxyUrl

用途：

- `dbx_search_schema`
- `dbx_search_table_columns`
- Graph/Kuzu schema vector retrieval

注意：Schema Research 模型配置不替代 embedding/rerank。它只负责消化工具结果和做候选筛选。

## 主模型可调用工具

主模型优先只暴露高级工具：

### `dbx_schema_research_task`

用途：让子任务模型查找和压缩 schema 证据。

参数：

```ts
interface DbxSchemaResearchTaskArgs {
  task: string;
  requiredEvidence?: string[];
  knownContext?: {
    currentSql?: string;
    mentionedTables?: Array<{
      schema?: string;
      table: string;
    }>;
  };
  constraints?: {
    maxTables?: number;
    maxColumnsPerTable?: number;
    requireRelations?: boolean;
    allowUserChoice?: boolean;
  };
}
```

示例：

```json
{
  "task": "找出和商品评价、评分、评论相关的表和字段",
  "requiredEvidence": [
    "评价内容字段",
    "评分字段",
    "商品关联字段",
    "用户关联字段"
  ],
  "constraints": {
    "maxTables": 3,
    "maxColumnsPerTable": 8,
    "requireRelations": true,
    "allowUserChoice": true
  }
}
```

返回：

```ts
interface SchemaResearchTaskResult {
  status: "sufficient" | "partial" | "need_user_choice" | "not_found" | "error";
  summary: string;
  evidence: SchemaEvidencePackage;
  uncertainties: SchemaResearchUncertainty[];
  toolBudget: {
    usedRounds: number;
    schemaSearches: number;
    columnSearches: number;
    tableLoads: number;
    columnDetails: number;
    relationLookups: number;
  };
}
```

### 用户确认工具

这些工具仍可直接暴露给主模型，因为它们是交互边界，不只是 schema 检索：

- `dbx_request_table_choice`
- `dbx_request_column_choice`
- `dbx_request_relation`

主模型可以在子任务返回 `need_user_choice` 时调用它们，也可以由子任务运行器内部触发。

## 子任务模型可调用工具

子任务模型可调用低级 schema tools：

- `dbx_search_schema`
- `dbx_search_table_columns`
- `dbx_find_columns`
- `dbx_list_tables`
- `dbx_get_column_details`
- `dbx_load_table_schema`
- `dbx_get_related_tables`

子任务模型不允许调用：

- SQL 执行工具
- 写数据工具
- 最终 SQL 自动执行工具
- 主聊天回复工具

## 子任务输出结构

### `SchemaEvidencePackage`

```ts
interface SchemaEvidencePackage {
  tables: SchemaEvidenceTable[];
  relations: SchemaEvidenceRelation[];
  rejectedCandidates: SchemaRejectedCandidate[];
  notes: string[];
}

interface SchemaEvidenceTable {
  schema: string;
  table: string;
  tableType: string;
  comment?: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  columns: SchemaEvidenceColumn[];
}

interface SchemaEvidenceColumn {
  name: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  comment?: string;
  usage: "select" | "filter" | "join" | "group" | "order" | "insert" | "update" | "unknown";
  reason: string;
  verified: boolean;
}

interface SchemaEvidenceRelation {
  leftSchema: string;
  leftTable: string;
  leftColumn: string;
  rightSchema: string;
  rightTable: string;
  rightColumn: string;
  source: "foreign_key" | "user_confirmed" | "known_enrichment";
  confidence: "high" | "medium" | "low";
}

interface SchemaRejectedCandidate {
  schema: string;
  table: string;
  reason: string;
}

interface SchemaResearchUncertainty {
  kind: "table" | "column" | "relation";
  message: string;
  candidates?: unknown[];
}
```

### 给主模型的压缩文本

程序应把 `SchemaEvidencePackage` 转成简短文本，避免主模型吃 JSON 噪音：

```text
Schema research result: sufficient

Relevant tables:
- public.product_reviews: high confidence. Reason: review/comment/rating matched user request.
  Columns:
  - product_id uuid NOT NULL, usage: join, verified
  - rating int NOT NULL, usage: select/filter, verified
  - comment text NULL, usage: select, verified
  - created_at timestamp NOT NULL, usage: filter/order, verified

Relations:
- public.product_reviews.product_id = public.products.id, source: foreign_key

Uncertainties:
- none
```

主模型只看到压缩文本和必要结构，不看到完整低级工具结果。

## 执行流程

### 场景 1：普通查表写 SQL

```text
用户：查询每个商品最近 30 天的评价数量和平均评分

主模型：
  调用 dbx_schema_research_task:
    task = 找出商品、评价、评分相关表字段及关系

子任务：
  调用 dbx_search_schema("商品 product item sku 评价 review rating comment score")
  调用 dbx_search_table_columns(product_reviews, "评分 rating score 评论 comment content")
  调用 dbx_get_column_details(product_reviews, ["product_id", "rating", "created_at"])
  调用 dbx_get_related_tables(product_reviews)
  返回 SchemaEvidencePackage

主模型：
  判断 sufficient
  基于证据生成 SQL
```

### 场景 2：候选表不确定

```text
子任务返回：
status = need_user_choice
uncertainties = [
  {
    kind: "table",
    message: "评价可能对应 product_reviews 或 comments",
    candidates: [...]
  }
]

主模型或子任务运行器：
  调用 dbx_request_table_choice

用户选择后：
  子任务继续验证字段
  返回 sufficient evidence
```

### 场景 3：无外键，需要确认关联

```text
子任务：
  找到 orders 和 users
  dbx_get_related_tables 无结果
  模型候选为 orders.user_id = users.id

返回：
status = need_user_choice
uncertainties.kind = relation

主模型或子任务运行器：
  调用 dbx_request_relation
```

## 预算与限制

建议默认预算：

```ts
const MAX_SCHEMA_RESEARCH_ROUNDS = 4;
const MAX_SCHEMA_RESEARCH_SCHEMA_SEARCHES = 3;
const MAX_SCHEMA_RESEARCH_TABLE_LISTS = 2;
const MAX_SCHEMA_RESEARCH_COLUMN_SEARCHES = 5;
const MAX_SCHEMA_RESEARCH_TABLE_LOADS = 4;
const MAX_SCHEMA_RESEARCH_COLUMN_DETAILS = 12;
const MAX_SCHEMA_RESEARCH_RELATION_LOOKUPS = 4;
const MAX_SCHEMA_RESEARCH_RESULT_TABLES = 4;
const MAX_SCHEMA_RESEARCH_RESULT_COLUMNS_PER_TABLE = 10;
```

规则：

- 子任务必须去重相同 query、相同 table load、相同 column details。
- 子任务不能无限扩展候选。
- 子任务返回的 evidence 必须比原始工具结果更短。
- 如果预算耗尽，返回 `partial`，不要假装充分。

## 事实校验规则

必须保留现有原则：

- RAG 命中只是候选，不是事实。
- 最终 SQL 使用的字段必须来自实时详情：
  - `dbx_get_column_details`
  - 或 `dbx_load_table_schema`
  - 或当前已经加载的 live schema context
- 关系来源必须明确：
  - `foreign_key`
  - `user_confirmed`
  - `known_enrichment`
- 没有可靠关系时不能猜 JOIN。
- 子任务模型不得把自己的推测标记为 verified。

## Prompt 规划

### 主模型 system prompt 增补

```text
When schema evidence is missing, prefer dbx_schema_research_task instead of calling low-level schema tools directly.
The schema research task returns compressed, verified evidence.
Use only tables, columns, and relations present in the evidence package or current live schema context.
If the evidence package is partial or uncertain, ask for another schema research task or request user confirmation.
```

中文：

```text
当缺少表、字段或关系证据时，优先调用 dbx_schema_research_task，不要直接反复调用低级 schema 工具。
schema research 子任务会返回压缩后的已校验证据。
最终 SQL 只能使用证据包或当前 live schema context 中存在的表、字段和关系。
如果证据包是 partial 或存在 uncertainty，继续发起更窄的子任务，或请求用户确认。
```

### 子任务模型 system prompt

```text
You are DBX Schema Research Agent.
Your job is to find and verify schema evidence for the parent AI task.
You do not write final SQL.
You may call schema tools to search tables, search columns, load table schema, get column details, and inspect relationships.
RAG results are candidates only. Mark a column verified only after real-time column details or table schema confirms it.
Return compact structured evidence only.
Do not include raw tool output unless it is necessary for disambiguation.
If evidence is insufficient, return partial or need_user_choice.
```

中文：

```text
你是 DBX Schema Research Agent。
你的任务是为主 AI 的 SQL 任务查找并校验 schema 证据。
你不生成最终 SQL。
你可以调用 schema 工具搜索表、搜索字段、加载表结构、获取字段详情、检查关系。
RAG 结果只是候选。只有实时字段详情或实时表结构确认后，字段才能标记为 verified。
只返回紧凑的结构化证据。
不要返回原始工具结果，除非为了消歧必须保留。
如果证据不足，返回 partial 或 need_user_choice。
```

## 文件落点

建议分阶段落地，不要一次改太大。

### 前端 AI 编排

- `apps/desktop/src/lib/ai.ts`
  - 新增 `dbx_schema_research_task` 工具定义。
  - 新增 `executeSchemaResearchTaskTool(...)`。
  - 主 tool loop 中优先暴露高级工具。
  - 保留低级工具给子任务运行器使用。

- `apps/desktop/src/lib/schemaResearch.ts`
  - 新建。
  - 放 `SchemaEvidencePackage` 类型。
  - 放 evidence 压缩/格式化函数。
  - 放子任务结果校验函数。

- `packages/app-tests/schemaResearch.test.ts`
  - 新建。
  - 测 evidence 压缩、URL/字段校验、partial/need_user_choice 状态。

### AI 配置

- `apps/desktop/src/stores/settingsStore.ts`
  - 新增 `schemaResearchModelConfig`。
  - 默认 `useMainModel = true`。
  - 保存到现有 AI 配置或单独配置文件，需要实现时再按当前存储结构决定。

- `apps/desktop/src/components/editor/EditorSettingsDialog.vue`
  - AI 设置中新增 `Schema Research Model` 区域。
  - 默认折叠或默认勾选“复用聊天模型”。
  - 只有关闭复用时显示 provider/endpoint/apiKey/model/apiStyle。

### 子任务运行器

- `apps/desktop/src/lib/ai.ts`
  - 可以先在同文件内实现最小版本，后续再拆。
  - 子任务运行器调用现有 `api.aiRawChat(...)`。
  - 子任务运行器使用低级 schema tools 的 executor。

后续如果 `ai.ts` 过大，再拆：

- `apps/desktop/src/lib/aiSchemaResearchAgent.ts`
- `apps/desktop/src/lib/aiSchemaTools.ts`

## 实施顺序

### Phase 1：证据包类型与压缩

目标：先不接模型，只定义 evidence package 和 formatter。

任务：

- 新建 `apps/desktop/src/lib/schemaResearch.ts`。
- 定义 `SchemaEvidencePackage`、`SchemaResearchTaskResult`。
- 实现 `formatSchemaEvidenceForPrompt(result)`。
- 添加 `packages/app-tests/schemaResearch.test.ts`。

验收：

- 能把结构化 evidence 压缩成给主模型看的短文本。
- 不包含 raw tool result。
- verified、uncertainties、relations 表达清楚。

### Phase 2：主模型高级工具定义

目标：强模型能看到 `dbx_schema_research_task`。

任务：

- 在 `buildAiSchemaTools()` 中新增高级工具。
- 在主 prompt 中要求优先使用高级工具。
- 先让 executor 返回 mock/not implemented 结果，验证工具定义和 trace 展示。

验收：

- 工具列表中出现 `dbx_schema_research_task`。
- 主模型 prompt 不再鼓励直接反复调用低级 schema tools。

### Phase 3：子任务运行器

目标：`dbx_schema_research_task` 内部能启动子任务模型。

任务：

- 新增 schema research model config resolver：
  - `useMainModel = true` 时复用主 AI 配置。
  - 否则使用独立 schema research 配置。
- 实现 `runSchemaResearchSubtask(...)`。
- 子任务模型可调用低级 schema tools。
- 子任务返回 `SchemaResearchTaskResult`。

验收：

- 强模型只收到压缩 evidence。
- 低级工具结果不进入强模型 messages。
- 子任务预算生效。

### Phase 4：事实校验与用户确认

目标：防止子任务模型把猜测当事实。

任务：

- 对 evidence 中 `verified = true` 的字段做程序校验。
- 未校验字段降级为 `verified = false`。
- 无可靠关系时返回 `need_user_choice`。
- 接入现有 `dbx_request_table_choice`、`dbx_request_column_choice`、`dbx_request_relation`。

验收：

- 未经实时详情确认的字段不能作为 verified 字段。
- 无 FK/沉淀关系时不会静默生成 JOIN 关系。

### Phase 5：设置页

目标：允许用户配置便宜子任务模型。

任务：

- Settings > AI 增加 `Schema Research Model`。
- 默认“复用聊天模型”。
- 关闭复用后显示独立 provider/endpoint/apiKey/model/apiStyle。
- API key 输入框必须使用独立 name 和 `autocomplete="new-password"`。

验收：

- 默认不增加用户配置负担。
- 高级用户可以把子任务模型换成便宜模型。
- 保存后回显正确。

## 预期收益

- 强模型上下文减少：低级工具过程不再直接进入主上下文。
- 强模型成本下降：主模型只看压缩证据。
- 检索稳定性提升：子任务专注 schema research，主模型专注 SQL。
- 更适合生产库：大量候选表/字段被子任务阶段过滤。
- 可扩展：以后可以加入 schema enrichment、用户确认关系、历史成功查询模式。

## 风险

### 子任务模型太弱

风险：便宜模型理解错主任务，筛错表字段。

缓解：

- 主模型检查 evidence 是否满足需求。
- evidence 必须带 confidence 和 uncertainties。
- 子任务输出不直接生成 SQL。

### 成本未降反升

风险：多一次模型调用，低级模型 token 也有成本。

缓解：

- 只在 schema 不确定或候选较多时启用。
- 当前上下文已有足够 schema 时不调用子任务。
- 子任务预算严格限制。

### 工具链复杂度增加

风险：主模型、子任务模型、embedding/rerank 三套配置容易混乱。

缓解：

- 默认子任务模型复用聊天模型。
- 设置页把三类能力分区：
  - Chat / SQL Model
  - Schema Research Model
  - Schema RAG Embedding / Rerank

## 不做的事

- 不引入 LangChain。
- 不让子任务模型生成最终 SQL。
- 不让 RAG 命中直接作为最终字段事实。
- 不把数据写入主 SQLite。
- 不把 embedding/rerank 改成本地内置模型。

## 最小可行版本

MVP 可以只做：

- `dbx_schema_research_task`
- 默认复用主模型作为子任务模型
- 子任务可调用：
  - `dbx_search_schema`
  - `dbx_search_table_columns`
  - `dbx_get_column_details`
  - `dbx_get_related_tables`
- 返回压缩 `SchemaEvidencePackage`
- 强模型只看到 evidence summary

先不做独立模型配置 UI。等 MVP 证明上下文确实减少，再加设置页里的便宜模型配置。
