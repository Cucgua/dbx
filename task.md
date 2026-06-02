# Schema RAG 主线任务状态

> 状态：已完成当前主线实现。DBX 现在具备“分析当前 Schema -> 生成表/字段 embedding 文档 -> 并发调用外部 embedding -> 写入独立索引目录和 Kuzu 图库 -> 搜索时生成 query embedding -> 内置 AI 通过 tool/function call 按需召回并实时校验表结构”的闭环。

## 已实现范围

### 1. Embedding 并发与进度

- 新增独立配置 `embeddingConcurrency`，默认 `4`，范围 `1..=16`。
- 保留 `embeddingBatchSize`，语义为单个 embedding request 的输入条数。
- 对 Gitee AI 这类单条 `input` 平台，实际 batch size 强制为 `1`，但并发仍生效。
- `embed_texts` 已改为有限并发调度，任一 batch 失败会返回 batch 编号和 HTTP body。
- 进度事件增加：
  - `concurrency`
  - `inFlight`
  - `succeededBatches`
  - `failedBatches`
- `sidecar.log` 记录 embedding queued/start/done/failed/search query embedding 等调度信息。

### 2. 真正的 query embedding + 向量召回

- `search_schema` 搜索阶段会调用 embedding endpoint，为用户问题生成 query vector。
- 搜索使用 cosine similarity 为主，结合 lexical score，字段文档命中会反推所属表。
- 返回结果包含命中原因，例如：
  - 向量命中表级文档
  - 向量命中字段
  - 关键词命中字段名
  - 外键相关表
- 搜索失败不会伪装成向量召回成功；如果 query embedding 失败，调用方会收到明确错误。

注意：Schema RAG 只看元数据，不采样真实表数据。类似 `Office Chair 这个产品卖的咋样` 中的 `Office Chair` 是业务数据值，如果 schema 元数据没有这个词，召回强弱取决于模型能否从“产品/销售/订单明细”语义推到相关表，而不是直接命中数据值。

### 3. Kuzu 索引存储

- 新增 crate：`crates/dbx-schema-rag-sidecar`。
- DBX 主程序只通过 DTO 调 sidecar，不暴露 Kuzu 类型到 `dbx-core` 公共模型。
- 分析结果写入独立目录：

```text
<data_dir>/schema-rag/
  config.json
  indexes/
    <connection-id>/<database>/<schema>/
      manifest.json
      documents.json
      graph.kuzu
      sidecar.log
```

- `graph.kuzu` 是真实 Kuzu 数据库文件，不再是 placeholder。
- 这里和原计划有一个实现差异：Windows 下 Kuzu `0.11.3` 对传入目录路径会报 `Database path cannot be a directory`，所以当前使用文件型 `graph.kuzu`。这已用 Kuzu API 打开并查询 `SchemaDocument` 计数验证过。
- Kuzu 内建节点：
  - `SchemaScope`
  - `TableNode`
  - `ColumnNode`
  - `IndexNode`
  - `ForeignKeyNode`
  - `SchemaDocument`
  - `QueryPattern`
- Kuzu 内建关系：
  - `HAS_TABLE`
  - `HAS_COLUMN`
  - `HAS_INDEX`
  - `HAS_FOREIGN_KEY`
  - `FK_TO`
  - `RELATED_TO`
  - `DESCRIBES_TABLE`
  - `DESCRIBES_COLUMN`

当前搜索仍从 sidecar 内部文档结构读取向量并做 cosine，以保持 Windows 打包和 Kuzu vector extension 风险可控；Kuzu 已负责持久化图结构和向量数据。

### 4. AI tool/function call 主链路

- 新增 Tauri command：`ai_raw_chat`。
- 新增 OpenAI-compatible `chat/completions` raw chat 调用，支持 `tools/tool_choice/tool_calls`。
- 内置 AI 对支持 tool call 的 provider 启用按需 schema 工具：
  - `dbx_search_schema`
  - `dbx_load_table_schema`
- 模型先判断缺什么 schema，再调用 `dbx_search_schema`；拿到候选后必须调用 `dbx_load_table_schema` 实时确认表结构。
- 最终 SQL 只能使用实时 schema API 返回的表和列。
- `buildAiContext` 不再在 tool-call 主链路里预先加载前 N 张表，也不再自动把 RAG 结果塞进 prompt。
- 只有当前 schema 可解析且 provider 支持 OpenAI-compatible tool call 时，才关闭 legacy schema 预加载；否则保持旧 fallback，避免空上下文。

Provider 边界：

- 已启用：OpenAI-compatible `chat/completions` 风格，包括 `openai`、`deepseek`、`qwen`、`ollama`、`openai-compatible`、`custom` 这类走 OpenAI chat endpoint 的配置。
- 暂未启用：Claude、Gemini、Responses API。它们会回退旧流式路径。

### 5. 工具预算与防重复召回

当前每轮 AI 请求有硬限制：

- `MAX_AI_TOOL_ROUNDS = 6`
- `MAX_AI_SCHEMA_SEARCH_CALLS = 3`
- `MAX_AI_SCHEMA_TABLE_LOADS = 8`
- 每次 schema search 返回最多 8 张表。
- 每张表最多返回 5 个 related tables。
- 同一个 search query 不重复调用。
- 同一个 `schema.table` 不重复加载实时结构。
- 预算耗尽后会要求模型只基于已有工具结果生成 SQL，或说明缺少哪些表/字段。

### 6. UI 与配置

- 设置页新增 `Schema 智能索引` 区域：
  - embedding provider
  - endpoint
  - model
  - api key
  - dimension
  - batch size
  - concurrency
  - rerank provider/endpoint/model/api key
  - proxy 配置
- Schema 树右键菜单新增：
  - 分析 Schema
  - 查看 Schema 智能索引状态
  - 删除 Schema 智能索引
- 分析前有隐私确认：只上传表名、字段名、类型、注释、索引、外键等元数据，不上传表数据。
- Web mode 对 Schema RAG 和 AI tool call 返回“不支持”，避免第一版强行实现 Web 后端。

## 验证结果

### Rust

宿主 Windows VS Developer PowerShell：

```powershell
cargo fmt --check --all
cargo test -p dbx-schema-rag-sidecar --lib
cargo check --workspace --locked
```

结果：

- `cargo fmt --check --all` 通过。
- `cargo test -p dbx-schema-rag-sidecar --lib` 通过：13 passed。
- `cargo check --workspace --locked` 通过。
- 仍有两个既有 warning：
  - `crates\dbx-core\src\plugins.rs:359` unused import `CommandExt`
  - `crates\dbx-mcp\src\service.rs:24` field `tool_router` is never read

### 前端

宿主 Windows PowerShell：

```powershell
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
pnpm test
pnpm build
```

结果：

- `vue-tsc` 通过。
- `pnpm test` 通过：696 passed。
- `pnpm build` 通过。
- Vite 仍有既有 chunk size / dynamic import warning，不影响构建。

## 手工验证建议

1. `pnpm dev:tauri` 启动桌面端。
2. 设置页配置 Schema 智能索引 embedding：
   - Gitee AI 示例 endpoint：`https://ai.gitee.com/v1/embeddings`
   - provider：`openai-compatible`
   - batch size 可保持较大，但 Gitee 会自动按单条 input 请求。
   - concurrency 建议先用 `4`，不稳定再降到 `1` 或 `2`。
3. 右键当前 schema 节点，执行“分析 Schema”。
4. 观察 UI 进度和 `sidecar.log`：
   - 是否看到 embedding queued。
   - 是否看到 request start/done。
   - `inFlight` 是否符合 concurrency。
5. 分析完成后查看状态：
   - table/column/index/fk 计数是否符合当前 schema。
   - 索引目录是否有 `manifest.json`、`documents.json`、`graph.kuzu`、`sidecar.log`。
6. 在 AI 中问 schema 意图问题，例如：
   - `用户订单商品明细怎么查`
   - `统计每个产品销量`
   - `Bob 买了哪些产品`
7. 观察日志：
   - 应看到 `[schema-rag][search:start]`
   - sidecar.log 应看到 search query embedding request
   - DBX 日志应看到搜索完成和实时 schema 加载相关调用
8. 注意：问具体业务数据值时，最终 SQL 生成后仍需要执行 SQL 查真实数据；Schema RAG 不负责知道表数据内容。

## 仍未纳入 V1 的内容

- 不采样真实表数据。
- 不学习历史 SQL。
- 不接 MCP 工具。
- 不把 Kuzu 类型暴露给 `dbx-core`。
- 不实现 Claude/Gemini/Responses API 的 tool call 分支。
- 不做 Kuzu vector extension 依赖；当前向量检索在 sidecar 内做 cosine。
- 未做安装包体积 spike；正式发版前还需要验证 Kuzu 在 Windows/Tauri 打包、签名、CI 和安装包体积上的影响。

---

# Schema RAG / GraphRAG 下一阶段任务规划

> 记录日期：2026-06-02
>
> 背景：当前 V1 已经完成 Schema RAG sidecar、外部 embedding、表/字段文档召回、AI tool/function call、实时 schema 校验、工具调用展示、用户确认表/字段/关联关系等主线能力。下一阶段目标是把 Kuzu 从“已写入但未参与召回的图索引文件”推进为真正参与召回、关系扩展和知识沉淀的 GraphRAG 层。

## 当前关键结论

### 1. 召回数据源现状

- 历史 V1 曾经从 `documents.json` 读取 `stored.documents` 和 `stored.tables` 做召回。
- 本轮已将搜索主路径切到 `graph.kuzu`：搜索时打开 Kuzu 图，读取 `SchemaDocument`、`TableNode`、`ColumnNode`、`IndexNode`、`ForeignKeyNode` 后再做向量/关键词/alias 加权。
- 当前搜索流程：

```text
dbx_search_schema
  -> sidecar search_schema
  -> load_search_index(... graph.kuzu ...)
  -> embed query
  -> search_documents_vector(...)
  -> vector score + lexical score + user-confirmed alias bonus + column bonus
  -> 聚合到 table
```

- `documents.json` 仍写入索引目录，保留为调试/导出文件；不再作为搜索 fallback。

### 2. Kuzu / GraphRAG 的真实价值

Kuzu 不应该只被理解为“换一个地方存 documents”。它真正有价值的是把这些结构变成可扩展的图：

```text
SchemaScope
  -> TableNode
  -> ColumnNode
  -> IndexNode
  -> ForeignKeyNode
  -> SchemaDocument
```

以及：

```text
TableNode - HAS_COLUMN -> ColumnNode
ColumnNode - FK_TO -> ColumnNode
TableNode - RELATED_TO -> TableNode
SchemaDocument - DESCRIBES_TABLE -> TableNode
SchemaDocument - DESCRIBES_COLUMN -> ColumnNode
```

GraphRAG 的价值不是凭空理解业务，而是：

- 向量命中文档后，沿图找到所属表和字段。
- 命中表后，沿外键、用户确认关系、历史 SQL 关系扩展邻居表。
- 通过字段、索引、外键、已确认关系提高 JOIN 路径可靠性。
- 对候选表、候选字段、候选关系给出更可解释的推荐原因。

### 3. Schema 不清晰时的边界

如果生产库存在以下情况：

- 表名不表达业务含义。
- 字段名是 `col1`、`value1`、`t_001` 这类弱语义。
- 没有表注释。
- 没有字段注释。
- 没有外键。
- 没有历史 SQL。
- 没有用户确认关系。

那么 GraphRAG 也不能魔法般变准。它最多能根据字段名相似、类型相似、索引形态做低置信候选，不能直接作为最终 SQL 事实。

因此下一阶段必须引入 **schema enrichment / graph curation**：

- AI 可以总结缺失信息和提出补充建议。
- 用户审核、编辑、确认。
- 确认后的知识写入 graph。
- 后续召回和 JOIN 关系判断使用这些已确认知识。

### 4. 中英文召回现状

当前索引文档里已经包含真实英文标识符：

- 表名。
- 字段名。
- 索引名。
- 外键字段。
- DDL。

因此如果用户问题或 AI 工具查询里包含英文词，例如 `review`、`rating`、`comment`、`score`，`dbx_search_schema` 可以通过 embedding 和 lexical score 命中这些英文标识符。

但当前还没有稳定的“中文业务词自动扩展成英文提示词/英文同义词”的机制：

- `dbx_search_schema` 目前只 embed 单个 `query`。
- 工具提示词只要求包含业务词、表角色和字段，没有明确要求同时带上英文候选词。
- lexical score 主要匹配 query 中已有 token，不能自动把“评价”变成 `review/rating/comment/score/feedback`。
- 表名/字段名中的 `snake_case`、`camelCase`、缩写词也还没有系统拆词后加入召回文本。

所以目前属于“英文标识符可被命中，但中英双语扩展不系统、不保证”的状态。

## 已开发的 AI Schema Tools

当前内置 AI schema tool loop 已有 8 个工具。

| 工具 | 作用 | 是否依赖向量索引 |
| --- | --- | --- |
| `dbx_search_schema` | 用 Schema 智能索引检索相关表、字段、关系候选。当前从 `graph.kuzu` 读取图索引后做召回。 | 是 |
| `dbx_list_tables` | 不走向量，按 schema + 表名关键词列出实时表/视图。适合没有索引、索引不准、需要浏览候选表时用。 | 否 |
| `dbx_find_columns` | 不走向量，在实时元数据里按字段名、字段注释、业务关键词搜索字段，并返回所属表。 | 否 |
| `dbx_request_table_choice` | 候选表太多或语义接近时，让用户从候选表中选择，也支持“都不是，手动输入表”。 | 否，用户交互工具 |
| `dbx_load_table_schema` | 加载某张表的实时字段、索引和外键。最终 SQL 用表字段前必须靠它核对。 | 否 |
| `dbx_request_column_choice` | 已确认表但字段不确定时，让用户选择字段，支持多选和“都不是，手动输入字段”。 | 否，用户交互工具 |
| `dbx_get_related_tables` | 读取某张表的已知关系。当前主要来自数据库真实外键；生产库没外键时可能为空。 | 否 |
| `dbx_request_relation` | 两张表需要 JOIN 但没有可靠关系时，让用户确认字段关联。支持多个字段对和 JOIN 类型。 | 否，用户交互工具 |

当前整体链路：

```text
用户问题
  -> AI 判断缺 schema 信息
  -> dbx_search_schema / dbx_list_tables / dbx_find_columns 找候选
  -> 候选不确定：dbx_request_table_choice / dbx_request_column_choice 问用户
  -> dbx_load_table_schema 校验真实表结构
  -> 需要 JOIN：dbx_get_related_tables 查关系
  -> 没可靠关系：dbx_request_relation 问用户确认字段关联
  -> 生成最终 SQL
```

## 下一阶段目标

### 总目标

把 Schema RAG 从“文档向量召回 + 实时 schema 校验”升级为“GraphRAG + schema enrichment + 用户确认关系沉淀”。

目标链路：

```text
dbx_search_schema
  -> embed query
  -> read graph.kuzu SchemaDocument
  -> vector + lexical score
  -> aggregate tables
  -> expand related tables from graph
  -> include confirmed annotations / aliases / relations
  -> return candidates
```

并且：

```text
AI 不确定
  -> 问用户确认表/字段/关系
  -> 用户确认
  -> 仅当用户明确选择“保存/沉淀”时写入 graph
  -> 下次召回和 JOIN 推断使用
```

## 任务 1：将召回数据源从 `documents.json` 切到 `graph.kuzu`

### 目标

`dbx_search_schema` 搜索时不再从 `documents.json` 读取 `stored.documents` 作为主召回数据源，而是打开 `graph.kuzu`，从 `SchemaDocument`、`TableNode`、`ColumnNode` 中读取搜索所需数据。

### 改造前实现

```text
search_schema
  -> load_stored_index(... documents.json ...)
  -> search_documents_vector(stored.documents, stored.tables)
```

### 当前实现

```text
search_schema
  -> load_search_index(... graph.kuzu ...)
  -> query SchemaDocument + TableNode + ColumnNode
  -> build in-memory search rows
  -> search_documents_vector(...)
```

### 设计约束

- 第一阶段不要求 Kuzu 自己计算 cosine similarity。
- query embedding 仍然通过外部 embedding endpoint 生成。
- cosine similarity 和 lexical score 仍然可以在 Rust 中计算。
- `documents.json` 可以暂时保留为调试、兼容和导出文件，但不能再作为主召回路径。
- 如果 `graph.kuzu` 不存在或读取失败，应返回明确错误，不要静默降级为 JSON，避免用户误以为已走 GraphRAG。

### 需要修改的文件

- `crates/dbx-schema-rag-sidecar/src/lib.rs`
  - 新增 Kuzu search index 读取函数。
  - 修改 `search_schema` 主路径。
  - 增加 Kuzu 召回相关单测。

### 验收标准

- `search_schema` 日志中能明确看到使用 `graph.kuzu`。
- 删除或重命名 `documents.json` 后，已有索引在 `graph.kuzu` 存在时仍能搜索。
- 删除或重命名 `graph.kuzu` 后，搜索返回明确错误。
- 搜索结果结构保持兼容：
  - `tables`
  - `matchedColumns`
  - `relatedTables`
  - `score`
  - `reason`

## 任务 2：让 `dbx_get_related_tables` 使用 Kuzu 图关系

### 目标

当前 `dbx_get_related_tables` 主要读取数据库实时外键。下一阶段应优先读取 Kuzu 图中的关系，包括真实外键和后续沉淀的用户确认关系。

### 当前实现

```text
dbx_get_related_tables
  -> api.listForeignKeys(...)
  -> 返回 database-foreign-key relations
```

### 目标实现

```text
dbx_get_related_tables
  -> query graph.kuzu
     - FK_TO
     - RELATED_TO
     - HAS_COLUMN
  -> 返回关系来源、字段对、置信度、原因
```

### 关系来源优先级

1. `database_foreign_key`
2. `user_confirmed`
3. `history_sql`
4. `ai_confirmed`
5. `heuristic`

### 验收标准

- 有真实外键时返回真实外键关系。
- 有用户确认关系时返回用户确认关系。
- 没有任何关系时返回空，并提示 AI 调用 `dbx_request_relation`。
- 返回结构必须支持多字段关系：

```json
{
  "leftTable": "orders",
  "rightTable": "customers",
  "columnPairs": [
    { "leftColumn": "tenant_id", "rightColumn": "tenant_id" },
    { "leftColumn": "customer_no", "rightColumn": "customer_no" }
  ],
  "source": "user_confirmed",
  "confidence": 1.0
}
```

## 任务 3：将用户确认的表关系沉淀到 graph

### 目标

`dbx_request_relation` 当前只解决本次 SQL 生成。下一阶段应支持用户在确认关系后，主动选择是否写入 Kuzu，避免下一次重复询问同一关系。

### 交互要求

当用户确认关系后，UI 应提供明确的二次动作：

```text
保存此关系，供以后使用
```

这个动作不能由 AI 自动触发，也不要默认勾选。用户没有主动点击“保存/沉淀”时，只能把关系用于本次 SQL 生成，不能写入 graph。

保存前必须让用户看到：

- 写入的是 DBX 的 schema graph overlay。
- 不会修改真实数据库。
- 保存的表、字段对、JOIN 类型和来源。
- 以后 AI 可能复用这个关系。

### 写入内容

```text
left_schema
left_table
right_schema
right_table
column_pairs
join_type
source = user_confirmed
confidence = 1.0
created_at
updated_at
note
```

### 设计约束

- 不修改真实数据库 schema。
- 不写入 DBX 主 SQLite。
- 写入 `graph.kuzu` 的 enrichment / overlay 层。
- 必须支持联合键和多字段关联。
- 用户取消或跳过时不保存。
- 用户只是确认本次 JOIN 时不保存。
- 用户明确点击“保存/沉淀”后才保存。
- AI 不能因为工具调用结果自行决定保存关系。

### 验收标准

- 用户确认关系但没有点击保存时，`graph.kuzu` 不新增 `RELATED_TO` 或关系证据节点。
- 用户确认并主动保存关系后，`graph.kuzu` 中能查到 `RELATED_TO` 或关系证据节点。
- 下一次 AI 查询同样两张表关系时，`dbx_get_related_tables` 能返回该关系。
- AI 不再重复调用 `dbx_request_relation` 问同一个已保存关系，除非用户问题需要不同 JOIN 语义。

## 任务 4：业务别名和表/字段选择沉淀

### 目标

当用户通过 `dbx_request_table_choice` 或 `dbx_request_column_choice` 明确选择表/字段后，可以提供“保存为业务别名/语义补充”的入口，把用户问题中的业务词与表/字段建立弱绑定。

这个沉淀必须由用户主动触发，不能因为用户选择了表/字段就自动保存。

### 示例

用户问：

```text
评价数据在哪里
```

AI 给候选表，用户选择：

```text
public.user_review
```

用户主动选择保存后，可以沉淀：

```text
业务词：评价
refers_to_table: public.user_review
source: user_confirmed
```

字段选择同理：

```text
手机号 -> customers.mobile_phone
出生证编号 -> mc_birth_apply.cert_no
```

### 设计约束

- 不要把整句用户问题全部当作业务词。
- 第一版可以让 AI 提取候选业务词，但必须让用户确认。
- 用户只是在本次对话中选择表/字段时，不自动沉淀业务别名。
- 必须有明确的“保存为业务别名/沉淀”动作。
- 沉淀后的别名用于召回排序和解释，不直接替代 live schema 校验。

### 验收标准

- 用户选择表/字段但未主动保存时，下次同义问题不应依赖该选择。
- 用户主动保存别名后，下次同义问题能优先召回对应表/字段。
- AI 工具结果能说明命中原因来自 `business_alias` 或 `user_confirmed_term`。

## 任务 5：Schema Enrichment 草稿与审核工具

### 目标

新增一组工具/能力，让 AI 可以总结当前 schema 缺失信息，并提出表注释、字段注释、表关系、字段枚举、业务别名等补充建议。建议必须经过用户审核后才能写入 graph。

### 建议新增工具

#### `dbx_get_schema_enrichment`

读取当前 graph 中已有补充信息。

返回内容：

```json
{
  "tableAnnotations": [],
  "columnAnnotations": [],
  "businessTerms": [],
  "confirmedRelations": []
}
```

#### `dbx_propose_schema_enrichment`

让 AI 根据当前 schema、用户问题、候选表字段、历史 SQL 信息生成补充建议草稿。

它只能生成草稿，不能保存。

示例返回：

```json
{
  "tableComments": [
    {
      "schema": "public",
      "table": "mc_birth_apply",
      "comment": "出生医学证明申请主表",
      "reason": "表名包含 birth_apply，字段包含 mother_name、apply_status"
    }
  ],
  "columnComments": [
    {
      "schema": "public",
      "table": "mc_birth_apply",
      "column": "mother_name",
      "comment": "母亲姓名"
    }
  ],
  "relations": [
    {
      "leftTable": "mc_birth_apply",
      "rightTable": "bd_hospital",
      "columnPairs": [
        ["hospital_id", "id"]
      ],
      "confidence": 0.72,
      "source": "heuristic"
    }
  ]
}
```

#### `dbx_request_schema_enrichment_review`

弹出 UI，让用户审核、编辑、删除或新增建议项。

用户可操作：

- 确认。
- 编辑。
- 删除。
- 标记为不确定。
- 新增一条。

#### `dbx_save_schema_enrichment`

保存用户明确要求沉淀、且已经审核确认后的补充信息到 `graph.kuzu`。

必须要求：

- 只能保存用户明确点击保存/沉淀后的内容。
- AI 草稿不能静默保存。
- AI 不能自动调用该工具完成写入。
- 如果要通过工具调用触发保存，必须先有 UI 层的用户确认事件作为前置条件。
- 保存内容不修改真实数据库。

### 可信度和来源分级

所有 enrichment 都必须记录来源和状态。

| 来源 | 可直接用于 SQL 事实吗 |
| --- | --- |
| `database_foreign_key` | 可以 |
| `user_confirmed` | 可以 |
| `history_sql` | 可以，但需要标明来自历史 SQL |
| `ai_confirmed` | 可以，但低于 user |
| `ai_draft` | 不可以，只能提示用户 |
| `heuristic` | 不可以，只能作为候选 |

### 验收标准

- AI 可以生成补充建议，但不会直接写入 graph。
- 用户审核确认后才写入 graph。
- 被保存的表/字段注释、业务别名、关系能参与下一次召回排序。
- 所有补充信息能在 UI 中查看来源、时间和状态。

## 任务 6：Schema 信息缺口分析

### 目标

提供一个入口让 AI 或系统统计当前 schema 缺少哪些信息，指导用户优先补充最有价值的 graph enrichment。

### 输出示例

```text
当前 schema 缺少：
1. 83% 的表没有中文注释。
2. 91% 的字段没有注释。
3. 只有 2 条真实外键，疑似生产库未维护外键。
4. 多张表存在 *_id 字段，但没有关系定义。
5. status/type/code 字段缺少枚举说明。
6. tenant_id / org_id 可能是全局过滤字段，但未确认。
```

### 可选补充动作

- 补表注释。
- 补字段注释。
- 补表关系。
- 补字段枚举。
- 补业务别名。
- 标记废弃表或优先表。

### 验收标准

- 能按 schema 统计表注释缺失比例。
- 能按 schema 统计字段注释缺失比例。
- 能列出疑似关系但未确认的表/字段组合。
- 能列出常见枚举字段候选，例如 `status`、`type`、`code`。
- 能进入 enrichment review 流程。

## 任务 7：历史 SQL JOIN 关系学习

### 目标

从用户执行过或保存过的 SQL 中提取稳定 JOIN 关系，作为 graph enrichment 的候选来源。

### 设计约束

- 第一版只做候选，不自动作为强事实。
- 用户确认后才能升级为 `user_confirmed`。
- 历史 SQL 来源关系标记为 `history_sql`。
- 需要保留 SQL 来源摘要和出现次数。

### 示例

历史 SQL 多次出现：

```sql
orders.customer_no = customers.customer_no
and orders.tenant_id = customers.tenant_id
```

生成候选：

```json
{
  "leftTable": "orders",
  "rightTable": "customers",
  "columnPairs": [
    ["customer_no", "customer_no"],
    ["tenant_id", "tenant_id"]
  ],
  "source": "history_sql",
  "evidenceCount": 7,
  "confidence": 0.86
}
```

### 验收标准

- 能从历史 SQL 解析出 JOIN 字段对。
- 多次出现的关系置信度更高。
- 用户可以确认、编辑或拒绝历史 SQL 关系候选。
- 确认后写入 graph，供 `dbx_get_related_tables` 和 `dbx_search_schema` 使用。

## 任务 8：召回排序接入 enrichment

### 目标

`dbx_search_schema` 排序时纳入 graph enrichment 信息，而不只依赖 embedding 和 lexical score。

### 可用信号

- 表/字段文档向量分数。
- lexical 分数。
- 字段文档命中 bonus。
- 用户确认业务别名命中。
- 用户确认注释命中。
- 真实外键关系扩展。
- 用户确认关系扩展。
- 历史 SQL 关系扩展。
- 索引/主键字段命中。
- 废弃表降权。

### 排序原则

强事实优先级：

```text
live schema existence
  > database_foreign_key
  > user_confirmed relation / alias / annotation
  > history_sql relation
  > ai_confirmed annotation
  > vector / lexical candidate
  > heuristic
```

### 验收标准

- 用户确认过的业务别名能明显提升对应表/字段排序。
- 用户确认过的表关系能让关联表进入候选结果。
- AI 草稿和 heuristic 不能直接作为最终 SQL 事实，只能影响候选排序或触发用户确认。
- 搜索结果 reason 能说明 enrichment 命中来源。

## 任务 9：工具调用展示与用户体验收口

### 已完成方向

- 思考过程和工具调用已经拆成 timeline：

```text
思考
工具调用
思考
工具调用
思考
```

- 工具调用不再塞进思考卡片里。
- 用户能看到工具名、参数、状态和摘要。

### 后续增强

- 对 schema enrichment 保存类操作，必须显示明确确认 UI，并且只能由用户主动触发。
- 对 graph 写入类工具，必须展示写入对象、来源、影响范围。

## 任务 10：中英文双语查询扩展与标识符拆词

### 目标

避免生产库没有中文表注释、字段注释时，中文问题无法召回英文表名/字段名。AI 查表时应尽量同时使用中文业务词和可能的英文标识符提示词。

### 当前问题

示例：

```text
用户问：评价数据在哪里？
理想查询：评价 review rating comment feedback score star product_review user_review
```

当前 `dbx_search_schema` 不会稳定自动生成这些英文提示词。是否能命中主要取决于：

- 模型自己是否想到英文同义词。
- embedding 模型的跨语言能力。
- 表名/字段名是否足够明显。
- query 是否刚好包含英文标识符。

这不适合作为生产能力依赖。

### 实现方向

第一阶段：提示词增强。

- 在 AI tool system prompt 中明确要求：当用户使用中文业务词查表/查字段时，`dbx_search_schema` 的 `query` 应同时包含原始中文词、可能的英文业务词、常见字段名和表名片段。
- 更新 `dbx_search_schema.query` 参数说明，让模型知道可以传入中英混合查询。
- 对 `dbx_find_columns.keyword` 也采用同样策略，因为很多生产库只有英文字段名。

第二阶段：索引文本增强。

- 生成 table/column embedding 文本时，额外加入标识符拆词：

```text
order_item -> order item
productReview -> product review
USER_ID -> user id
```

- 把拆出的 token 作为 `标识符词` 写入 `text_for_embedding`，提高 lexical 和 embedding 命中率。
- 对常见缩写保留原词，不强行错误翻译。

第三阶段：查询扩展能力。

- 保持 `dbx_search_schema.query` 兼容，同时允许内部生成 `expandedQuery` 或多 query 搜索后合并结果。
- 扩展词来源优先级：

```text
用户原始问题
  > AI 生成的英文候选词
  > 用户确认保存的业务别名
  > graph 中已审核 annotation / alias
  > 内置小型通用词表
```

- 内置词表只能作为低权重辅助，不能替代用户确认的业务别名。

### 边界

- 英文扩展词只能影响候选召回和排序，不能作为最终 SQL 事实。
- 最终 SQL 仍必须经过 `dbx_load_table_schema` 校验真实表字段。
- 不能因为 “评价 -> review” 就直接认定某张表是评价表；不确定时仍要调用 `dbx_request_table_choice` 让用户确认。
- 用户没有主动保存时，本次推断出的英文同义词不自动沉淀到 graph。

### 验收标准

- 用户问“评价数据”，AI 调用 `dbx_search_schema` 时 query 中包含类似 `评价 review rating comment feedback score` 的中英混合词。
- 没有中文注释但表名包含 `review`、`rating`、`comment`、`feedback`、`score` 时，候选表能进入召回结果。
- `snake_case` / `camelCase` 表字段名被拆词后参与召回。
- 用户确认并主动保存业务别名后，下次同义中文问题排序更靠前。
- 英文扩展未命中或多表歧义时，AI 会请求用户选择表/字段，而不是直接编造结论。

## 任务 11：字段摘要与字段详情分层加载

### 目标

减少 AI tool loop 的上下文占用。AI 在判断“某张表有哪些字段、哪些字段可能相关”时，先拿轻量字段摘要；只有当字段要进入最终 SQL、JOIN、过滤、排序、插入或更新时，再获取字段详情。

### 当前问题

当前 `dbx_load_table_schema` 一次返回：

- 字段名。
- 数据类型。
- 是否可空。
- 是否主键。
- 默认值。
- extra。
- 索引。
- 外键。

这对最终 SQL 校验有价值，但对“先判断字段是否相关”来说太重。生产库如果一张表几百个字段，模型上下文会被大量类型、默认值、索引细节占满。

另外，当前 `dbx_find_columns` 可以按关键词找字段，但它不是“在指定表内做字段级向量召回”。AI 如果已经确认了一张表，还缺一个低成本工具来按用户意图召回这张表里的相关字段，并且只返回字段摘要。

### 建议工具拆分

新增或调整为三层：

| 工具 | 作用 | 返回内容 |
| --- | --- | --- |
| `dbx_search_table_columns` | 在指定表内做字段级向量召回，用于判断字段是否可能相关。 | `schema`、`table`、`query`、`columns[{ name, comment, score, reason }]`，可选返回 `primaryKey` |
| `dbx_get_column_details` | 获取指定表的指定字段详情，用于最终 SQL 校验。 | `name`、`dataType`、`nullable`、`primaryKey`、`default`、`extra`、`comment` |
| `dbx_load_table_schema` | 保留为重工具，只在确实需要整表结构、索引、外键时使用。 | 字段详情 + 索引 + 外键 |

也可以不新增 `dbx_search_table_columns`，而是给 `dbx_load_table_schema` 增加 `mode`：

```json
{
  "schema": "public",
  "table": "orders",
  "mode": "columnSearch",
  "query": "评价 review rating comment score"
}
```

但从 tool 使用清晰度看，更推荐拆成独立工具：

```text
dbx_search_table_columns
dbx_get_column_details
dbx_load_table_schema
```

原因是模型更容易理解“先摘要、后详情”的调用顺序，也更容易在 UI timeline 中解释工具意图。

### 字段级召回主路径

字段摘要工具直接走向量召回，而不是先把全字段列表交给 AI 自己找。

目标流程：

```text
dbx_search_table_columns
  -> embed query
  -> 过滤 SchemaDocument(kind = Column, schema, table)
  -> vector score
  -> lexical / identifier token / alias score 作为补充
  -> 返回 top N 字段摘要
```

示例：

```json
{
  "schema": "public",
  "table": "product_review",
  "query": "评价 review rating comment feedback score star 商品 product user",
  "limit": 12
}
```

返回：

```json
{
  "schema": "public",
  "table": "product_review",
  "totalColumns": 126,
  "returnedColumns": 8,
  "truncated": true,
  "indexedAt": "2026-06-02T10:00:00Z",
  "columns": [
    {
      "name": "rating_score",
      "comment": "评分",
      "score": 0.84,
      "reason": "字段文档向量命中 rating/score，注释命中 评分"
    },
    {
      "name": "review_content",
      "comment": "评价内容",
      "score": 0.79,
      "reason": "字段文档向量命中 review/comment，注释命中 评价"
    }
  ]
}
```

### 数据源策略

- 第一阶段可以复用现有 `SchemaRagDocument(kind = Column)` 和字段 embedding。
- 当前已从 `graph.kuzu` 读取字段文档和字段元数据；`documents.json` 只保留为调试/导出文件。
- 向量分数是主信号。
- lexical、标识符拆词、中英文扩展词、用户确认 alias 只做加权或兜底，不作为主路径。
- 字段摘要可以来自索引，但最终字段详情必须来自当前仍有效的 live schema 证据或结构化 schema cache。
- 如果索引不可用，工具不能伪装成向量召回结果；应明确返回 `indexUnavailable`，再由 AI 改用 live metadata 兜底工具。

### 本轮已落地范围

- sidecar 新增 `searchTableColumns` 命令，复用现有 `SchemaRagDocument(kind = Column)` 和字段 embedding 做指定表内字段级向量召回。
- sidecar 搜索入口已改为从 `graph.kuzu` 读取 `TableNode` / `ColumnNode` / `IndexNode` / `ForeignKeyNode` / `SchemaDocument`；`documents.json` 不再作为召回 fallback。
- `graph.kuzu` 新增 `BusinessAlias`、`ALIAS_OF_TABLE`、`ALIAS_OF_COLUMN`，用于保存用户确认的业务别名。
- 新增显式保存入口 `saveSchemaRagEnrichment` / `save_schema_rag_enrichment` / sidecar `saveEnrichment`；AI 不会自动调用该入口，避免未经用户确认自动沉淀。
- 表/字段召回已接入用户确认 alias 加权：表 alias 只加权表文档，字段 alias 只加权对应字段文档。
- Tauri 新增 `search_table_columns_rag` 命令。
- 前端 API 新增 `searchTableColumnsRag`。
- AI tool loop 新增 `dbx_search_table_columns` 和 `dbx_get_column_details`。
- `dbx_search_table_columns` 返回轻量字段摘要：字段名、注释、可选主键标记、分数、命中原因，不返回数据类型、可空、默认值、extra。
- `includePrimaryKey` 参数已接入 `dbx_search_table_columns`，默认包含主键标记。
- `dbx_get_column_details` 必须指定 `columns[]`，从 live schema 获取字段类型、可空、主键、默认值、extra、注释。
- AI 提示词已调整为：确认表后优先字段级向量召回；字段进入最终 SQL 前再取字段详情；只有确实需要整表字段、索引和外键时才调用重型 `dbx_load_table_schema`。
- 中英文混合查询提示已加入工具提示词。

### 尚未落地范围

- 结构化 schema cache 的跨轮复用与失效策略还未实现。
- 用户确认 alias / 关系的前端可视化管理组件还未实现；当前只有显式 API 入口。
- 用户确认的多字段关联关系保存与 JOIN 关系加权还未实现；当前先支持表/字段业务别名。
- 未做 Windows 宿主完整构建和真实 AI tool loop 联调。

### 推荐调用链

```text
AI 确认候选表
  -> dbx_search_table_columns(schema, table, query)
  -> 如果字段不确定：dbx_request_column_choice
  -> 对用户确认或 AI 准备使用的字段：
       dbx_get_column_details(schema, table, columns[])
       或复用当前仍有效的字段详情 cache
  -> 最终 SQL 只能使用已有字段详情级证据的字段
```

如果需要 JOIN：

```text
左表/右表字段级向量召回
  -> AI 提出候选字段对
  -> dbx_request_relation 让用户确认
  -> dbx_get_column_details 获取确认字段对的详情，或复用有效 cache
  -> 生成 JOIN
```

### 字段详情触发条件

字段进入以下位置前必须有字段详情级证据。证据可以来自本轮 `dbx_get_column_details` / `dbx_load_table_schema` 的实时结果，也可以来自当前连接、数据库、schema、表和字段仍然匹配且未失效的结构化 schema cache。

- `SELECT` 输出字段。
- `WHERE` 过滤字段。
- `JOIN ON` 字段。
- `GROUP BY` / `ORDER BY` 字段。
- `INSERT` / `UPDATE` 字段。
- 需要判断空值、默认值、主键、类型转换、日期函数、字符串函数、数值比较时。

字段只用于候选判断、用户选择、业务语义判断时，只需要摘要：

- 字段英文名。
- 字段注释。
- 可选主键标记。

### 上下文控制策略

- `dbx_search_table_columns` 默认最多返回 top `N` 个字段，超出时返回 `truncated` 和 `totalColumns`。
- 必须要求 `query`，避免退化成“列出整表字段”。
- 支持 `includePrimaryKey`，让 AI 能看到主键字段，但不展开全部类型细节。
- 对超大表，AI 不应该一次拉全字段，而应通过更具体的 `query` 缩小范围。
- `dbx_get_column_details` 必须要求 `columns[]`，避免变成另一个整表详情工具。

### 边界

- 字段摘要只能用于候选判断，不能作为最终 SQL 的充分依据。
- 最终 SQL 仍必须保证字段来自 live schema。
- 如果没有字段详情级证据，不能在最终 SQL 中使用该字段。
- 不能为了省上下文跳过 JOIN 字段、过滤字段、写入字段的数据类型和可空性校验。
- 不要求每次重新打数据库；当前仍有效的结构化 schema cache 可以复用。
- 切换 connection、database、schema，执行 DDL，用户刷新表结构，表结构编辑保存，或缓存来源/时效不可信时，必须重新获取详情。

### 验收标准

- AI 确认表后，默认优先调用 `dbx_search_table_columns`，而不是直接 `dbx_load_table_schema`。
- `dbx_search_table_columns` 使用字段文档向量召回作为主路径，只返回字段名、注释、分数和命中原因等轻量信息。
- AI 准备使用某些字段时，会调用 `dbx_get_column_details` 获取这些字段的类型、是否可空、主键、默认值等详情，或复用当前仍有效的字段详情 cache。
- 一张大表字段很多时，tool result 不会把全部字段详情塞进上下文。
- 最终 SQL 中使用的字段都能追溯到 `dbx_get_column_details` 或重型 `dbx_load_table_schema` 的实时结果。
- AI 可以建议“是否沉淀”，但不能自动沉淀。
- 对 AI 草稿，使用 `draft` 状态，不要显示成已确认事实。
- 对已确认关系，应允许用户在 UI 中撤销或编辑。

### 验收标准

- 所有 graph 写入动作都有用户主动确认。
- 没有用户主动保存/沉淀动作时，不发生 graph 写入。
- 用户能区分：
  - AI 草稿。
  - 用户确认。
  - 历史 SQL 候选。
  - 真实外键。
- 工具调用 timeline 能清楚展示：
  - 为什么问用户。
  - 用户选择了什么。
  - 是否保存到 graph。

## 建议执行顺序

### Phase 1：Kuzu 召回主路径

1. 已将 `dbx_search_schema` / `dbx_search_table_columns` 数据源从 `documents.json` 切到 `graph.kuzu`。
2. 已保持 Rust 中 cosine + lexical scoring，不引入 Kuzu vector extension。
3. 已增加日志和测试，证明搜索确实依赖 `graph.kuzu`；宿主环境完整验证仍待执行。

### Phase 2：关系图查询

1. 让 `dbx_get_related_tables` 查 Kuzu 图。
2. 支持真实外键和 `RELATED_TO`。
3. 返回多字段关系。

### Phase 3：用户确认关系沉淀

1. `dbx_request_relation` 确认后，提供用户主动保存入口。
2. 用户点击保存后，写入 graph overlay。
3. 下次查询复用该关系。

### Phase 4：Schema Enrichment

1. 开发 enrichment 草稿生成。
2. 开发 review UI。
3. 开发保存到 graph。
4. 召回排序接入 enrichment。

### Phase 5：历史 SQL 学习

1. 从历史 SQL 提取 JOIN 候选。
2. 用户审核确认。
3. 写入 graph 并参与召回。

## 重要边界

- 不修改真实数据库 schema。
- 不写入主 SQLite 作为 GraphRAG 主存储。
- 不让 AI 草稿静默变成事实。
- 不让 AI 自动触发沉淀；沉淀必须来自用户明确的保存/沉淀动作。
- 最终 SQL 必须仍然经过 live schema 校验。
- 没有外键、没有注释、没有历史 SQL、没有用户确认关系时，GraphRAG 不能保证准确，只能降低搜索空间。
- 用户确认和历史 SQL 沉淀是生产库无外键场景下最重要的增强点。

## 验证要求

由于本仓在 `/mnt/d/gitproject/dbx`，真实构建和测试应在 Windows 宿主或 IDEA 环境执行。

建议验证命令：

```powershell
cargo fmt --check --all
cargo test -p dbx-schema-rag-sidecar --lib
cargo check --workspace --locked
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
pnpm test
pnpm build
```

手工验证：

1. 配置 Schema 智能索引 embedding。
2. 分析当前 schema。
3. 确认索引目录包含 `manifest.json`、`documents.json`、`graph.kuzu`、`sidecar.log`。
4. 删除或临时移走 `documents.json`，确认 `dbx_search_schema` 仍可通过 `graph.kuzu` 搜索。
5. 删除或临时移走 `graph.kuzu`，确认搜索报明确错误。
6. 让 AI 生成需要 JOIN 的 SQL。
7. 无外键时触发用户关系确认。
8. 用户主动点击保存/沉淀关系。
9. 下一次同类问题应复用已保存关系，而不是再次询问。
