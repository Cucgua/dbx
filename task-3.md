# DBX Schema RAG Maintenance And API Docs Index Plan

## 目标

把 DBX Schema RAG 从“一次性整库重建”升级为“按表维护的 Schema 索引 + 可导入人工接口文档的业务知识索引”。

核心目标：

- Schema 向量维护按表进行，避免每次 schema 小变动都全量重建。
- 人工接口文档可以作为业务语义来源进入向量检索，提高中文业务词、接口字段、页面语义到表/字段的召回能力。
- 接口文档只作为候选证据，不直接作为数据库事实；最终 SQL 仍必须通过实时 schema 工具确认表字段。
- 文档转换能力做成可插拔转换器，`pandoc` 只作为可选增强，不作为第一版硬依赖。

## 当前现状

当前 sidecar 位于 `crates/dbx-schema-rag-sidecar`，索引目录为：

```text
schema-rag/indexes/<connection>/<database>/<schema>/
  manifest.json
  documents.json
  graph.kuzu
  sidecar.log
```

当前 manifest 只有整体 `schema_fingerprint`，没有表级 fingerprint 和表级维护状态。

当前 `documents.json` 中的 `SchemaRagDocument` 只有两类：

```text
Table
Column
```

当前 Kuzu 图已有：

```text
SchemaScope
TableNode
ColumnNode
IndexNode
ForeignKeyNode
SchemaDocument
BusinessAlias
QueryPattern
```

以及：

```text
HAS_TABLE
HAS_COLUMN
HAS_INDEX
HAS_FOREIGN_KEY
FK_TO
RELATED_TO
DESCRIBES_TABLE
DESCRIBES_COLUMN
ALIAS_OF_TABLE
ALIAS_OF_COLUMN
```

## 设计原则

### 1. Schema 是事实源，接口文档是语义源

接口文档可以帮助召回候选表、候选字段、业务词和接口上下文，但不能直接证明数据库字段存在。

最终 SQL 可用字段必须来自：

- 当前表上下文。
- 实时 schema 工具返回。
- `dbx_get_column_details` 精确确认。
- Schema Research 返回的 verified 字段。

### 2. Schema 按表维护

每张表维护独立 fingerprint：

```text
table fingerprint = hash(table name + table type + comment + ddl + columns + indexes + foreign keys)
```

刷新时对比旧 manifest 和新实时 schema：

- `added`：新表，新增表文档和字段文档。
- `changed`：fingerprint 变化，重建该表文档。
- `removed`：表不存在，删除该表文档和图节点。
- `unchanged`：保留旧文档和 embedding。

### 3. 接口文档按文档源维护

人工文档不是天然按表组织，因此不强行按表建文档索引。

文档维护粒度：

```text
KnowledgeSource -> ApiDocChunk -> embedding
```

文档与表/字段的关系可以按表维护：

```text
ApiDocChunk MAY_MAP_TO_TABLE TableNode
ApiDocChunk MAY_MAP_TO_COLUMN ColumnNode
```

表结构变化时，不重建文档 embedding，只重新评估该表与已有文档 chunk 的映射关系。

### 4. `pandoc` 是可选增强

第一版内置支持：

- Markdown
- txt
- docx 的基础文本/表格抽取

PDF 第一版只做文本型 PDF 的预留接口，不强行实现 OCR。

`pandoc`、`pdftotext`、OCR 后续作为外部 converter 配置接入。

## 数据结构规划

### 表级维护单元

新增：

```rust
pub struct SchemaRagTableIndexUnit {
    pub schema: String,
    pub table: String,
    pub fingerprint: String,
    pub document_ids: Vec<String>,
    pub column_count: usize,
    pub index_count: usize,
    pub foreign_key_count: usize,
    pub updated_at: DateTime<Utc>,
}
```

manifest 增加：

```rust
pub table_units: Vec<SchemaRagTableIndexUnit>
```

为了兼容旧索引，字段要加 `#[serde(default)]`。

### 表级 diff

新增纯逻辑：

```rust
pub enum SchemaRagTableChangeKind {
    Added,
    Changed,
    Removed,
    Unchanged,
}

pub struct SchemaRagTableChange {
    pub schema: String,
    pub table: String,
    pub kind: SchemaRagTableChangeKind,
    pub old_fingerprint: Option<String>,
    pub new_fingerprint: Option<String>,
}

pub fn diff_table_index_units(
    old_units: &[SchemaRagTableIndexUnit],
    new_tables: &[SchemaRagTableMetadata],
) -> Result<Vec<SchemaRagTableChange>, String>
```

### 人工文档归一化

新增内部抽象：

```rust
pub enum KnowledgeSourceKind {
    Schema,
    ApiDoc,
    Enrichment,
}

pub struct NormalizedApiDoc {
    pub source_id: String,
    pub source_path: String,
    pub original_format: String,
    pub converter: String,
    pub content_hash: String,
    pub markdown: String,
    pub sections: Vec<NormalizedApiDocSection>,
}

pub struct NormalizedApiDocSection {
    pub id: String,
    pub title_path: Vec<String>,
    pub text: String,
    pub page: Option<usize>,
}
```

第一阶段只落设计和少量类型，第二阶段再做导入命令。

## 工具与功能规划

### 第一阶段：表级维护基础

目标：不改 UI，不改外部调用流程，先让 sidecar manifest 可以表达“每张表的索引单元”。

实现内容：

- 新增 `SchemaRagTableIndexUnit`。
- `SchemaRagManifest` 增加 `table_units`。
- `build_manifest` 写入每张表的 fingerprint 和 document ids。
- 新增 `table_fingerprint`。
- 新增 `diff_table_index_units`。
- 增加单元测试：
  - 字段注释变化会导致该表 changed。
  - 新增表是 added。
  - 删除表是 removed。
  - 未变化表是 unchanged。
  - 表级 document ids 包含表文档和字段文档。

### 第二阶段：刷新变更表

目标：在已有索引基础上，支持“只刷新变化表”的 sidecar 命令。

建议命令：

```text
refresh_schema_rag_tables
```

输入：

```rust
pub struct RefreshSchemaRagTablesRequest {
    pub scope: SchemaRagScope,
    pub tables: Vec<SchemaRagTableMetadata>,
    pub config: SchemaRagConfig,
    pub mode: RefreshSchemaRagMode,
}

pub enum RefreshSchemaRagMode {
    ChangedOnly,
    SelectedTables,
}
```

输出：

```rust
pub struct RefreshSchemaRagTablesResponse {
    pub manifest: SchemaRagManifest,
    pub added: usize,
    pub changed: usize,
    pub removed: usize,
    pub unchanged: usize,
    pub rebuilt_documents: usize,
}
```

第一版可以先内部重写 `documents.json` 和 `graph.kuzu`，但 embedding 只请求 added/changed 表的文档，unchanged 表复用旧 embedding。

### 第三阶段：接口文档导入设计

目标：支持人工接口文档作为 `api_doc` 来源入库。

第一版支持格式：

- `.md`
- `.txt`
- `.docx` 基础抽取

暂不支持：

- 扫描 PDF OCR
- `.doc`
- 复杂图片/流程图语义理解

建议命令：

```text
import_schema_rag_api_docs
```

输入：

```rust
pub struct ImportSchemaRagApiDocsRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub files: Vec<ApiDocImportFile>,
    pub config: SchemaRagConfig,
}

pub struct ApiDocImportFile {
    pub path: String,
    pub display_name: Option<String>,
}
```

输出：

```rust
pub struct ImportSchemaRagApiDocsResponse {
    pub imported_sources: usize,
    pub chunks: usize,
    pub embedded_chunks: usize,
    pub unsupported_files: Vec<String>,
}
```

### 第四阶段：文档召回融合

目标：`dbx_search_schema` 同时召回 schema docs、api_doc docs、user enrichment。

返回结果必须区分来源：

```text
sourceKind: schema | api_doc | enrichment
confidence: inferred | confirmed | rejected
```

主模型提示词必须明确：

- `api_doc` 是候选业务证据。
- 不能直接把接口字段当数据库字段。
- 使用字段前必须通过 `dbx_get_column_details`。

### 第五阶段：文档-表字段映射确认

目标：把接口文档中推断出的表/字段映射转成可确认关系。

关系状态：

```text
inferred
confirmed
rejected
```

只有用户确认后，才能升级为 `confirmed` 并参与强召回。

## 第一阶段开发任务

### Task 1: 表级 fingerprint 与 index unit

**文件：**

- 修改：`crates/dbx-schema-rag-sidecar/src/lib.rs`

步骤：

1. 写单元测试：
   - `table_index_units_include_table_and_column_document_ids`
   - `table_diff_detects_added_changed_removed_and_unchanged_tables`
2. 跑 sidecar 单元测试，确认新测试失败。
3. 新增 `SchemaRagTableIndexUnit`。
4. 给 `SchemaRagManifest` 增加 `table_units`，用 `#[serde(default)]` 兼容旧 manifest。
5. 新增 `table_fingerprint`、`build_table_index_units`、`diff_table_index_units`。
6. 更新 `build_manifest` 写入表级 units。
7. 跑 sidecar 单元测试，确认通过。

### Task 2: stale / refresh API 规划落类型

**文件：**

- 修改：`crates/dbx-schema-rag-sidecar/src/lib.rs`

步骤：

1. 新增 refresh 请求/响应类型，但不接命令入口。
2. 新增 `summarize_table_changes` 纯逻辑。
3. 增加测试覆盖 added/changed/removed/unchanged 计数。

### Task 3: 人工文档 normalized model 预留

**文件：**

- 修改：`crates/dbx-schema-rag-sidecar/src/lib.rs`

步骤：

1. 新增 `KnowledgeSourceKind`、`NormalizedApiDoc`、`NormalizedApiDocSection`。
2. 新增 `normalize_markdown_api_doc` 纯函数，只支持 Markdown 文本。
3. 增加测试：
   - 标题路径切分。
   - content hash 稳定。
   - 空文档报错。

## 第一阶段验收

必须通过：

```bash
cargo test -p dbx-schema-rag-sidecar --lib
```

如果在 WSL 因 Kuzu 或 Windows native dependency 卡住，需要明确报告，不把 WSL 结果当 host-side 构建。

还需要：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
git diff --check
```

## 后续 UI 方向

后续可以在 Schema RAG 设置或右键菜单增加：

- `刷新当前表索引`
- `刷新变更表`
- `查看索引状态`
- `导入接口文档`
- `重新匹配文档与表`

第一阶段不做 UI，避免范围过大。

## 当前实现进度

已实现：

- `manifest.table_units`：每张表独立记录 fingerprint、文档 id、字段/索引/外键数量、更新时间。
- 表级 diff 与变更汇总：支持 added / changed / removed / unchanged。
- 右键表菜单：查看当前表智能索引状态。
- 右键表菜单：刷新当前表智能索引，只重建当前表的表文档/字段文档 embedding，并复用其他表 embedding。
- 单表刷新时保留已导入接口文档与用户沉淀的业务别名。
- 右键 Schema/Database 菜单：导入接口文档。
- Markdown 接口文档归一化：按标题路径切分 section，保存到 `api-docs/*.json`。
- 导入 Markdown 后对 section 建立 `ApiDoc` embedding，并写入 `documents.json` / `graph.kuzu`。
- `dbx_search_schema` 会融合接口文档片段：当文档片段命中用户问题且提到表名/字段名/注释时，给对应表和字段候选加权。
- 重新分析 Schema 时，会重新加载已导入 Markdown 文档并重新生成文档 embedding，避免 manifest 显示文档存在但搜索不使用。

暂未实现：

- `.txt`、`.docx`、`.pdf` 的真实转换导入。
- 文档片段与表/字段映射的 Kuzu 关系边。
- 文档-表字段映射的用户确认/拒绝状态。
- “刷新变更表”批量 UI。
- `pandoc` / `pdftotext` / OCR 外部转换器配置。
