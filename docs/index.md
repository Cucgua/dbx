---
layout: home

hero:
  name: DBX
  text: Database Management Tool
  tagline: 25+ databases in 15 MB. Desktop & Docker self-hosting, with built-in AI assistant.
  image:
    src: /logo.png
    alt: DBX
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Download
      link: https://github.com/t8y2/dbx/releases
    - theme: alt
      text: GitHub
      link: https://github.com/t8y2/dbx

features:
  - icon: 🗄️
    title: 25+ Databases
    details: MySQL, PostgreSQL, SQLite, Redis, MongoDB, DuckDB, ClickHouse, SQL Server, Oracle, Elasticsearch, and many MySQL/PG-compatible databases.
    link: /guide/databases
    linkText: View all databases
  - icon: ✏️
    title: Query Editor
    details: CodeMirror 6 with syntax highlighting, smart SQL autocomplete for tables and columns, format SQL, execute selected text, 9 editor themes.
    link: /guide/query-editor
    linkText: Learn more
  - icon: 📊
    title: Data Grid
    details: Virtual-scrolled table that handles millions of rows. Inline editing, sorting, search, WHERE filter, pagination. Export to CSV, JSON, Markdown.
    link: /guide/data-grid
    linkText: Learn more
  - icon: 🤖
    title: AI Assistant
    details: Natural language to SQL, explain, optimize, fix errors. Supports Claude, OpenAI, and any OpenAI-compatible endpoint.
    link: /guide/ai-assistant
    linkText: Learn more
  - icon: 🔌
    title: MCP Integration
    details: Let Claude Code, Cursor, Windsurf and other AI agents query your databases and open tables in DBX directly.
    link: /guide/mcp
    linkText: Setup guide
  - icon: 🔄
    title: Schema Diff & Transfer
    details: Compare schemas across databases and generate sync SQL. Transfer data between different database engines. ER diagram visualization.
    link: /guide/schema-diff
    linkText: Learn more
  - icon: 🔍
    title: Field Lineage
    details: Trace column dependencies through foreign keys, views, query history, and same-name fields across tables.
    link: /guide/field-lineage
    linkText: Learn more
  - icon: 🐳
    title: Docker Self-Hosting
    details: Deploy the web version via Docker with one command. Multi-arch images (amd64/arm64). Persistent data with volumes.
    link: /guide/getting-started
    linkText: Learn more
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
  <h2>See it in action</h2>
  <div class="screenshot-grid">
    <img src="/screenshot-light.png" alt="DBX light mode" />
    <img src="/screenshot-dark.png" alt="DBX dark mode" />
    <img src="/screenshot-er.png" alt="ER diagram" />
    <img src="/screenshot-grid.png" alt="Data grid" />
  </div>
</div>
