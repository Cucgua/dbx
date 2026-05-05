<div align="center">
  <img src="docs/logo.png" width="80" />
  <h1>DBX</h1>
  <p>25+ databases in 15 MB. Desktop & Docker self-hosting, with built-in AI assistant.</p>
  <p>
    <a href="https://github.com/t8y2/dbx/releases"><img src="https://img.shields.io/github/v/release/t8y2/dbx?label=version" /></a>
    <a href="https://github.com/t8y2/dbx/releases"><img src="https://img.shields.io/github/downloads/t8y2/dbx/total" /></a>
    <a href="https://github.com/t8y2/dbx/blob/main/LICENSE"><img src="https://img.shields.io/github/license/t8y2/dbx" /></a>
    <a href="https://github.com/t8y2/dbx/graphs/contributors"><img src="https://img.shields.io/github/contributors/t8y2/dbx" /></a>
    <a href="https://linux.do"><img src="https://img.shields.io/badge/community-LINUX%20DO-blue" /></a>
    <a href="#community"><img src="https://img.shields.io/badge/WeChat%20%7C%20QQ-Join%20Group-brightgreen" /></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white" />
    <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" />
    <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" />
    <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" />
    <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" />
    <img src="https://img.shields.io/badge/DuckDB-FFF000?logo=duckdb&logoColor=black" />
    <img src="https://img.shields.io/badge/ClickHouse-FFCC01?logo=clickhouse&logoColor=black" />
    <img src="https://img.shields.io/badge/SQL%20Server-CC2927?logo=microsoftsqlserver&logoColor=white" />
    <img src="https://img.shields.io/badge/Oracle-F80000?logo=oracle&logoColor=white" />
    <img src="https://img.shields.io/badge/Elasticsearch-005571?logo=elasticsearch&logoColor=white" />
    <img src="https://img.shields.io/badge/MariaDB-003545?logo=mariadb&logoColor=white" />
    <img src="https://img.shields.io/badge/TiDB-DC150B?logo=tidb&logoColor=white" />
  </p>
  <p>
    English | <a href="README.zh-CN.md">简体中文</a>
  </p>

  <p>
    <a href="docs/screenshot-light.png"><img src="https://cdn.jsdelivr.net/gh/t8y2/dbx@main/docs/screenshot-light.png" width="395" /></a>
    <a href="docs/screenshot-dark.png"><img src="https://cdn.jsdelivr.net/gh/t8y2/dbx@main/docs/screenshot-dark.png" width="395" /></a>
  </p>
  <p>
    <a href="docs/screenshot-er.png"><img src="https://cdn.jsdelivr.net/gh/t8y2/dbx@main/docs/screenshot-er.png" width="395" /></a>
    <a href="docs/screenshot-grid.png"><img src="https://cdn.jsdelivr.net/gh/t8y2/dbx@main/docs/screenshot-grid.png" width="395" /></a>
  </p>
</div>

## Features

### 17+ Databases, One Tool

MySQL, PostgreSQL, SQLite, Redis, MongoDB, DuckDB, ClickHouse, SQL Server, Oracle, Elasticsearch, MariaDB, TiDB, OceanBase, openGauss, GaussDB, KingBase, Vastbase, GoldenDB — connect to all of them from a single ~15 MB app. No bundled Chromium.

### Query Editor

CodeMirror 6 with SQL syntax highlighting, smart autocomplete (tables & columns), `Cmd+Enter` execution, selected SQL execution, SQL formatting, and 9 editor themes. Persistent query history with search and restore.

### AI SQL Assistant

Describe what you want in plain language — get SQL back. Also explains, optimizes, and fixes errors. Works with Claude, OpenAI, or any OpenAI-compatible endpoint.

### Data Grid

Virtual-scrolled table that handles millions of rows. Inline editing, sorting, full-text search, pagination, column resize, row numbers, zebra stripes. Export to CSV, JSON, Markdown.

### Schema Tools

- **Schema browser** — databases, schemas, tables, columns, indexes, foreign keys, triggers, with sidebar search & pin
- **ER diagram** — visualize table relationships
- **Schema diff** — compare structures across connections
- **Explain plan** — visual query execution plan
- **Field lineage** — column-level lineage analysis

### Data Operations

- **Table import** — CSV, Excel
- **Data transfer** — migrate between databases
- **Database export** — full database dump
- **SQL file execution** — run `.sql` files directly
- **File preview** — drag & drop Parquet, CSV, JSON to preview instantly (powered by DuckDB)

### Specialized Browsers

- **Redis** — key pattern search, all data types (String, Hash, List, Set, ZSet, Stream)
- **MongoDB** — document CRUD with pagination, Atlas & replica set URL connection

### Safety & Connectivity

SSH tunnel (key & password) · auto-reconnect on connection loss · confirmation dialogs for destructive operations · encrypted config export/import · color-coded connections

### Polished UI

Dark mode with native title bar sync · 9 editor themes · English & 简体中文 · built-in auto-update

## AI Agent Integration (MCP)

DBX provides an [MCP server](mcp/) that lets AI coding agents query your databases using connections already configured in DBX.

```bash
npx @dbx-app/mcp-server
```

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "dbx": { "command": "npx", "args": ["-y", "@dbx-app/mcp-server"] }
  }
}
```

Works with Claude Code, Cursor, Windsurf, and any MCP-compatible agent. Supports listing connections, browsing tables, executing SQL, and opening tables directly in DBX's UI.

See the [MCP server README](mcp/README.md) for details.

## Install

Download the latest release from the [Releases](https://github.com/t8y2/dbx/releases/latest) page.

**Homebrew (macOS):**

```bash
brew install --cask t8y2/tap/dbx
```

**Scoop (Windows):**

```bash
scoop bucket add dbx https://github.com/t8y2/scoop-bucket
scoop install dbx
```

## Self-Hosted (Docker)

DBX provides a web version that can be deployed via Docker.

```bash
docker run -d --name dbx -p 4224:4224 -v dbx-data:/app/data t8y2/dbx
```

Or with Docker Compose:

```yaml
services:
  dbx:
    image: t8y2/dbx
    ports:
      - "4224:4224"
    volumes:
      - dbx-data:/app/data
    restart: unless-stopped

volumes:
  dbx-data:
```

Open `http://localhost:4224` in your browser. Multi-arch images (amd64 / arm64) are available.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77

### Development

```bash
pnpm install
pnpm dev:tauri
```

Web version:

```bash
pnpm dev:web       # frontend
pnpm dev:backend   # backend
```

### Build

```bash
pnpm tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer     | Technology                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework | [Tauri 2](https://tauri.app/)                                                                                                                                                                                    |
| Frontend  | [Vue 3](https://vuejs.org/) + TypeScript                                                                                                                                                                         |
| UI        | [shadcn-vue](https://www.shadcn-vue.com/) + Tailwind CSS                                                                                                                                                         |
| Editor    | [CodeMirror 6](https://codemirror.net/)                                                                                                                                                                          |
| Backend   | Rust + [sqlx](https://github.com/launchbadge/sqlx) / [tiberius](https://github.com/prisma/tiberius) / [redis-rs](https://github.com/redis-rs/redis-rs) / [mongodb](https://github.com/mongodb/mongo-rust-driver) |

## Community

[![LINUX DO](https://img.shields.io/badge/LINUX%20DO-Community-blue)](https://linux.do)

|                     WeChat Group                      |                     QQ Group                      |
| :---------------------------------------------: | :-----------------------------------------: |
| <img src="docs/wechat-group.jpg" width="200" /> | <img src="docs/qq-group.jpg" width="200" /> |

## Contributors

<a href="https://github.com/t8y2/dbx/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=t8y2/dbx" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=t8y2%2Fdbx&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=t8y2/dbx&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=t8y2/dbx&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=t8y2/dbx&type=date&legend=top-left" />
 </picture>
</a>

## License

[AGPL-3.0](LICENSE)
