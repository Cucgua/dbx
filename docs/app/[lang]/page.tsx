import Link from 'next/link';
import {
  Database,
  Zap,
  Shield,
  Bot,
  ArrowRight,
  GitCompare,
  Table,
  Search,
  FileCode,
  Import,
  Network,
  Terminal,
} from 'lucide-react';

const stats = {
  en: [
    { value: '15 MB', label: 'Install Size' },
    { value: '25+', label: 'Databases' },
    { value: 'Desktop + Docker', label: 'Deployment' },
    { value: 'Built-in AI', label: 'Assistant' },
  ],
  cn: [
    { value: '15 MB', label: '安装体积' },
    { value: '25+', label: '支持数据库' },
    { value: '桌面 + Docker', label: '部署方式' },
    { value: '内置 AI', label: '智能助手' },
  ],
};

const features = {
  en: [
    {
      icon: Terminal,
      title: 'Query Editor',
      desc: 'CodeMirror 6-powered SQL editor with syntax highlighting, smart autocomplete, and query history.',
      href: '/en/docs/query-editor',
    },
    {
      icon: Table,
      title: 'Data Grid',
      desc: 'Browse and edit data with virtual scrolling. Inline editing with SQL preview before saving.',
      href: '/en/docs/data-grid',
    },
    {
      icon: Search,
      title: 'Schema Browser',
      desc: 'Tree view with search, pin, context menus, and column comments. Color-coded connections.',
      href: '/en/docs/schema-browser',
    },
    {
      icon: GitCompare,
      title: 'Schema Diff & Sync',
      desc: 'Compare schemas across databases and generate sync SQL. Dev vs Production in one click.',
      href: '/en/docs/schema-diff',
    },
    {
      icon: Bot,
      title: 'AI Assistant + MCP',
      desc: 'Natural language to SQL, query optimization, error fixing. Let Claude/Cursor query your databases via MCP.',
      href: '/en/docs/ai-assistant',
    },
    {
      icon: Import,
      title: 'Data Transfer',
      desc: 'Move data across database engines — MySQL to PostgreSQL, SQLite to SQL Server, and more.',
      href: '/en/docs/data-transfer',
    },
    {
      icon: Network,
      title: 'Field Lineage',
      desc: 'Trace column relationships across foreign keys, views, and query history with confidence levels.',
      href: '/en/docs/field-lineage',
    },
    {
      icon: FileCode,
      title: 'Import & Export',
      desc: 'Import CSV/JSON/Excel, export SQL dumps, run .sql files with smart statement splitting.',
      href: '/en/docs/table-import',
    },
  ],
  cn: [
    {
      icon: Terminal,
      title: '查询编辑器',
      desc: '基于 CodeMirror 6 的 SQL 编辑器，支持语法高亮、智能补全、JOIN 建议和查询历史。',
      href: '/cn/docs/query-editor',
    },
    {
      icon: Table,
      title: '数据表格',
      desc: '虚拟滚动浏览大数据量。行内编辑，保存前可预览将要执行的 SQL 语句。',
      href: '/cn/docs/data-grid',
    },
    {
      icon: Search,
      title: '结构浏览',
      desc: '树形视图，支持搜索、置顶、右键菜单、字段注释显示和连接颜色标记。',
      href: '/cn/docs/schema-browser',
    },
    {
      icon: GitCompare,
      title: 'Schema 对比与同步',
      desc: '跨数据库结构对比，自动生成同步 SQL。开发环境 vs 生产环境，一键搞定。',
      href: '/cn/docs/schema-diff',
    },
    {
      icon: Bot,
      title: 'AI 助手 + MCP',
      desc: '自然语言转 SQL、查询优化、错误修复。通过 MCP 让 Claude/Cursor 直接查询你的数据库。',
      href: '/cn/docs/ai-assistant',
    },
    {
      icon: Import,
      title: '数据传输',
      desc: '跨引擎数据迁移 — MySQL 到 PostgreSQL、SQLite 到 SQL Server，自动处理类型映射。',
      href: '/cn/docs/data-transfer',
    },
    {
      icon: Network,
      title: '字段血缘',
      desc: '追踪外键、视图、查询历史中的字段关联关系，标注置信度，数据治理必备。',
      href: '/cn/docs/field-lineage',
    },
    {
      icon: FileCode,
      title: '导入与导出',
      desc: '导入 CSV/JSON/Excel，导出 SQL 文件，执行 .sql 脚本，智能语句分割。',
      href: '/cn/docs/table-import',
    },
  ],
};

const databases = [
  'MySQL', 'PostgreSQL', 'SQLite', 'Redis', 'MongoDB',
  'DuckDB', 'ClickHouse', 'SQL Server', 'Oracle', 'Elasticsearch',
  'MariaDB', 'TiDB', 'OceanBase', 'CockroachDB', 'StarRocks',
  'Doris', 'DM', 'GaussDB', 'Redshift', 'TDengine',
];

const comparison = {
  en: {
    title: 'Why DBX?',
    headers: ['', 'DBX', 'DBeaver', 'Navicat', 'TablePlus'],
    rows: [
      ['Install Size', '~15 MB', '~300 MB', '~200 MB', '~80 MB'],
      ['Price', 'Free (AGPL)', 'Free / $230', '$180+', '$99+'],
      ['Database Support', '25+', '80+', '15+', '20+'],
      ['Built-in AI', 'Yes', 'No', 'Yes', 'No'],
      ['MCP Integration', 'Yes', 'No', 'No', 'No'],
      ['Docker Self-Host', 'Yes', 'No', 'No', 'No'],
      ['Field Lineage', 'Yes', 'No', 'No', 'No'],
    ],
  },
  cn: {
    title: '为什么选择 DBX？',
    headers: ['', 'DBX', 'DBeaver', 'Navicat', 'TablePlus'],
    rows: [
      ['安装体积', '~15 MB', '~300 MB', '~200 MB', '~80 MB'],
      ['价格', '免费 (AGPL)', '免费 / $230', '$180+', '$99+'],
      ['数据库支持', '25+', '80+', '15+', '20+'],
      ['内置 AI', '有', '无', '有', '无'],
      ['MCP 集成', '有', '无', '无', '无'],
      ['Docker 自托管', '有', '无', '无', '无'],
      ['字段血缘', '有', '无', '无', '无'],
    ],
  },
};

const i18nText = {
  en: {
    heroTitle: '25+ Databases.',
    heroTitle2: 'One 15 MB App.',
    heroSubtitle: 'Open-source database management tool with built-in AI assistant. Desktop & Docker self-hosting, powered by Tauri 2 and Rust.',
    ctaDownload: 'Download',
    ctaDocs: 'Read the Docs',
    featuresTitle: 'Everything You Need',
    featuresSubtitle: 'A complete toolkit for database management, from daily queries to cross-engine migration.',
    dbTitle: 'Supported Databases',
    dbSubtitle: 'Native Rust drivers, no JDBC. MySQL/PostgreSQL compatible databases work out of the box.',
    andMore: 'and more...',
    footerCta: 'Ready to try?',
    footerCtaSub: 'Download DBX or deploy with Docker in seconds.',
  },
  cn: {
    heroTitle: '25+ 数据库',
    heroTitle2: '一个 15 MB 的应用',
    heroSubtitle: '开源数据库管理工具，内置 AI 助手。桌面应用 + Docker 自托管，基于 Tauri 2 和 Rust 构建。',
    ctaDownload: '下载',
    ctaDocs: '查看文档',
    featuresTitle: '功能一览',
    featuresSubtitle: '从日常查询到跨引擎迁移，一站式数据库管理工具。',
    dbTitle: '支持的数据库',
    dbSubtitle: 'Rust 原生驱动，无 JDBC。MySQL / PostgreSQL 兼容数据库开箱即用。',
    andMore: '更多...',
    footerCta: '准备好了吗？',
    footerCtaSub: '下载 DBX 或用 Docker 秒级部署。',
  },
};

export default async function LandingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const l = lang === 'cn' ? 'cn' : 'en';
  const t = i18nText[l];
  const feat = features[l];
  const stat = stats[l];
  const comp = comparison[l];

  return (
    <main className="landing">
      {/* Navbar */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href={`/${l}`} className="landing-logo">
            <img src="/logo.png" alt="DBX" width={28} height={28} />
            <span>DBX</span>
          </Link>
          <div className="landing-nav-links">
            <Link href={`/${l}/docs/what-is-dbx`}>{l === 'cn' ? '文档' : 'Docs'}</Link>
            <Link href="https://github.com/t8y2/dbx" target="_blank">GitHub</Link>
            <Link href="https://discord.gg/W7NyVDRt6a" target="_blank">Discord</Link>
            <Link href={l === 'cn' ? '/en' : '/cn'} className="landing-lang-switch">
              {l === 'cn' ? 'EN' : '中文'}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <h1 className="landing-hero-title">
            <span className="landing-gradient">{t.heroTitle}</span>
            <br />
            {t.heroTitle2}
          </h1>
          <p className="landing-hero-sub">{t.heroSubtitle}</p>
          <div className="landing-hero-cta">
            <Link href="https://github.com/t8y2/dbx/releases" className="landing-btn-primary">
              {t.ctaDownload} <ArrowRight size={16} />
            </Link>
            <Link href={`/${l}/docs/what-is-dbx`} className="landing-btn-secondary">
              {t.ctaDocs}
            </Link>
          </div>
        </div>
        <div className="landing-hero-image">
          <img src="/screenshot-dark.png" alt="DBX Screenshot" />
        </div>
      </section>

      {/* Stats */}
      <section className="landing-stats">
        {stat.map((s) => (
          <div key={s.label} className="landing-stat">
            <div className="landing-stat-value">{s.value}</div>
            <div className="landing-stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Features */}
      <section className="landing-section">
        <h2 className="landing-section-title">{t.featuresTitle}</h2>
        <p className="landing-section-sub">{t.featuresSubtitle}</p>
        <div className="landing-features-grid">
          {feat.map((f) => (
            <Link key={f.title} href={f.href} className="landing-feature-card">
              <div className="landing-feature-icon">
                <f.icon size={24} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Database Logos */}
      <section className="landing-section">
        <h2 className="landing-section-title">{t.dbTitle}</h2>
        <p className="landing-section-sub">{t.dbSubtitle}</p>
        <div className="landing-db-grid">
          {databases.map((db) => (
            <div key={db} className="landing-db-badge">
              <Database size={16} />
              <span>{db}</span>
            </div>
          ))}
          <div className="landing-db-badge landing-db-more">
            <span>{t.andMore}</span>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="landing-section">
        <h2 className="landing-section-title">{comp.title}</h2>
        <div className="landing-comparison">
          <table>
            <thead>
              <tr>
                {comp.headers.map((h, i) => (
                  <th key={i} className={i === 1 ? 'landing-highlight-col' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comp.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={ci === 1 ? 'landing-highlight-col' : ''}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Screenshots */}
      <section className="landing-section">
        <div className="landing-screenshots">
          <div className="landing-screenshot-item">
            <img src="/screenshot-light.png" alt="DBX Light Mode" />
          </div>
          <div className="landing-screenshot-item">
            <img src="/screenshot-er.png" alt="DBX ER Diagram" />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="landing-footer-cta">
        <h2>{t.footerCta}</h2>
        <p>{t.footerCtaSub}</p>
        <div className="landing-hero-cta">
          <Link href="https://github.com/t8y2/dbx/releases" className="landing-btn-primary">
            {t.ctaDownload} <ArrowRight size={16} />
          </Link>
          <Link href={`/${l}/docs/getting-started`} className="landing-btn-secondary">
            {t.ctaDocs}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <img src="/logo.png" alt="DBX" width={20} height={20} />
            <span>DBX</span>
          </div>
          <div className="landing-footer-links">
            <Link href="https://github.com/t8y2/dbx" target="_blank">GitHub</Link>
            <Link href="https://discord.gg/W7NyVDRt6a" target="_blank">Discord</Link>
            <Link href="https://github.com/t8y2/dbx/blob/main/LICENSE" target="_blank">AGPL-3.0</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
