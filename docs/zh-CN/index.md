---
layout: home

hero:
  name: DBX
  text: 数据库管理工具
  tagline: 15 MB 驾驭 25+ 种数据库。桌面端 & Docker 自托管，内置 AI 助手。
  image:
    src: /logo.png
    alt: DBX
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-CN/guide/getting-started
    - theme: alt
      text: 下载
      link: https://github.com/t8y2/dbx/releases
    - theme: alt
      text: GitHub
      link: https://github.com/t8y2/dbx

features:
  - icon: 🗄️
    title: 25+ 种数据库
    details: MySQL、PostgreSQL、SQLite、Redis、MongoDB、DuckDB、ClickHouse、SQL Server、Oracle、Elasticsearch，以及众多 MySQL/PG 兼容数据库
    link: /zh-CN/guide/databases
    linkText: 查看所有数据库
  - icon: ✏️
    title: 查询编辑器
    details: CodeMirror 6 语法高亮、智能 SQL 补全（表名和字段）、格式化 SQL、执行选中文本，9 种编辑器主题
    link: /zh-CN/guide/query-editor
    linkText: 了解更多
  - icon: 📊
    title: 数据表格
    details: 虚拟滚动，轻松应对百万行数据。行内编辑、排序、搜索、WHERE 过滤、分页。导出为 CSV、JSON、Markdown
    link: /zh-CN/guide/data-grid
    linkText: 了解更多
  - icon: 🤖
    title: AI 助手
    details: 自然语言生成 SQL、解释、优化、修复错误。支持 Claude、OpenAI 及任何 OpenAI 兼容端点
    link: /zh-CN/guide/ai-assistant
    linkText: 了解更多
  - icon: 🔌
    title: MCP 集成
    details: 让 Claude Code、Cursor、Windsurf 等 AI 编程助手直接查询数据库，还能在 DBX 中打开表
    link: /zh-CN/guide/mcp
    linkText: 配置指南
  - icon: 🔄
    title: Schema 对比与数据传输
    details: 跨数据库对比 Schema 并生成同步 SQL。在不同数据库引擎之间传输数据。ER 关系图可视化
    link: /zh-CN/guide/schema-diff
    linkText: 了解更多
  - icon: 🔍
    title: 字段血缘
    details: 通过外键、视图、查询历史和同名字段追踪列的依赖关系
    link: /zh-CN/guide/field-lineage
    linkText: 了解更多
  - icon: 🐳
    title: Docker 自托管
    details: 一行命令部署 Web 版本。支持 amd64/arm64 双架构镜像，数据持久化存储
    link: /zh-CN/guide/getting-started
    linkText: 了解更多
---

<style>
.screenshot-section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}
.screenshot-section h2 {
  text-align: center;
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 24px;
}
.screenshot-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.screenshot-grid img {
  width: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
}
</style>

<div class="screenshot-section">
  <h2>功能预览</h2>
  <div class="screenshot-grid">
    <img src="/screenshot-light.png" alt="DBX 亮色模式" />
    <img src="/screenshot-dark.png" alt="DBX 深色模式" />
    <img src="/screenshot-er.png" alt="ER 关系图" />
    <img src="/screenshot-grid.png" alt="数据表格" />
  </div>
</div>
