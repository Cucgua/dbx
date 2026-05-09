import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileCode,
  GitCompare,
  Network,
  Search,
  Shield,
  Table,
  Terminal,
  Zap,
} from 'lucide-react';

const languages = ['MySQL', 'PostgreSQL', 'SQLite', 'Redis', 'MongoDB', 'DuckDB', 'ClickHouse', 'SQL Server', 'Oracle'];

const metrics = {
  en: [
    { value: '~15 MB', label: 'desktop installer' },
    { value: '25+', label: 'database engines' },
    { value: '2 modes', label: 'desktop and Docker' },
  ],
  cn: [
    { value: '~15 MB', label: '桌面安装包' },
    { value: '25+', label: '数据库引擎' },
    { value: '2 种模式', label: '桌面与 Docker' },
  ],
};

const workflows = {
  en: [
    {
      icon: Terminal,
      title: 'Write and run SQL',
      desc: 'A CodeMirror 6 editor with metadata-aware completion, formatting, history, and selected SQL execution.',
      href: '/en/docs/query-editor',
    },
    {
      icon: Table,
      title: 'Browse and edit data',
      desc: 'Virtualized grids, inline editing, WHERE/ORDER BY controls, SQL preview, and export tools.',
      href: '/en/docs/data-grid',
    },
    {
      icon: Search,
      title: 'Explore schemas',
      desc: 'Navigate databases, schemas, tables, columns, indexes, foreign keys, and triggers from a focused sidebar.',
      href: '/en/docs/schema-browser',
    },
    {
      icon: GitCompare,
      title: 'Compare and migrate',
      desc: 'Schema diff, table import, database export, SQL file execution, and cross-engine data transfer.',
      href: '/en/docs/schema-diff',
    },
  ],
  cn: [
    {
      icon: Terminal,
      title: '编写与执行 SQL',
      desc: 'CodeMirror 6 编辑器，支持元数据补全、格式化、查询历史和选中 SQL 执行。',
      href: '/cn/docs/query-editor',
    },
    {
      icon: Table,
      title: '浏览与编辑数据',
      desc: '虚拟滚动表格、行内编辑、WHERE/ORDER BY 控制、SQL 预览和导出工具。',
      href: '/cn/docs/data-grid',
    },
    {
      icon: Search,
      title: '浏览数据库结构',
      desc: '在侧边栏中查看数据库、Schema、表、字段、索引、外键和触发器。',
      href: '/cn/docs/schema-browser',
    },
    {
      icon: GitCompare,
      title: '对比与迁移',
      desc: 'Schema 对比、表导入、数据库导出、SQL 文件执行和跨引擎数据传输。',
      href: '/cn/docs/schema-diff',
    },
  ],
};

const capabilities = {
  en: [
    { icon: Database, label: 'Native Rust drivers, no JDBC runtime' },
    { icon: Shield, label: 'SSH tunnels, encrypted config export, destructive action guards' },
    { icon: Bot, label: 'AI assistant plus MCP server for Claude Code, Cursor, and agents' },
    { icon: Network, label: 'ER diagrams, schema diff, and field lineage for deeper analysis' },
    { icon: FileCode, label: 'CSV, Excel, SQL files, full exports, and cross-engine transfer' },
    { icon: Zap, label: 'Desktop app and self-hosted web deployment from the same project' },
  ],
  cn: [
    { icon: Database, label: 'Rust 原生驱动，不依赖 JDBC 运行时' },
    { icon: Shield, label: 'SSH 隧道、加密配置导出、危险操作确认' },
    { icon: Bot, label: '内置 AI 助手，以及面向 Claude Code、Cursor 的 MCP Server' },
    { icon: Network, label: 'ER 图、Schema 对比、字段血缘，覆盖更深层分析场景' },
    { icon: FileCode, label: 'CSV、Excel、SQL 文件、完整导出和跨引擎传输' },
    { icon: Zap, label: '桌面应用与自托管 Web 部署来自同一个项目' },
  ],
};

const i18nText = {
  en: {
    navDocs: 'Docs',
    navCommunity: 'Community',
    lang: '中文',
    eyebrow: 'Open-source database workspace',
    heroTitle: 'A focused database client for daily work.',
    heroSubtitle:
      'DBX brings connections, SQL editing, data grids, schema tools, AI assistance, and self-hosted access into one lightweight product.',
    download: 'Download DBX',
    readDocs: 'Read the docs',
    installLabel: 'Install on macOS',
    installCommand: 'brew install --cask t8y2/tap/dbx',
    docsStart: 'Start here',
    docsStartDesc: 'Install DBX, create your first connection, and learn the main workflow.',
    workflowsTitle: 'Core workflows',
    workflowsDesc: 'The docs are organized around what you actually do in a database client.',
    supportTitle: 'Database coverage',
    supportDesc: 'SQL, NoSQL, embedded databases, and popular MySQL/PostgreSQL-compatible engines.',
    capabilitiesTitle: 'Built for real database work',
    footerTitle: 'Ready to try DBX?',
    footerDesc: 'Use the desktop app for local work, or deploy the Docker version for browser-based access.',
    release: 'Latest release',
    docker: 'Docker setup',
  },
  cn: {
    navDocs: '文档',
    navCommunity: '社区',
    lang: 'English',
    eyebrow: '开源数据库工作台',
    heroTitle: '专注日常工作的数据库客户端。',
    heroSubtitle: 'DBX 将连接管理、SQL 编辑、数据表格、结构工具、AI 助手和自托管访问放进一个轻量产品里。',
    download: '下载 DBX',
    readDocs: '查看文档',
    installLabel: 'macOS 安装',
    installCommand: 'brew install --cask t8y2/tap/dbx',
    docsStart: '从这里开始',
    docsStartDesc: '安装 DBX、创建第一个连接，并了解主要工作流。',
    workflowsTitle: '核心工作流',
    workflowsDesc: '文档围绕数据库客户端里的真实任务组织，而不是堆功能清单。',
    supportTitle: '数据库覆盖',
    supportDesc: '覆盖 SQL、NoSQL、嵌入式数据库，以及常见 MySQL/PostgreSQL 兼容数据库。',
    capabilitiesTitle: '面向真实数据库工作的能力',
    footerTitle: '准备试试 DBX？',
    footerDesc: '本地工作使用桌面版，需要浏览器访问时部署 Docker 版。',
    release: '最新版本',
    docker: 'Docker 部署',
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
  const workflowItems = workflows[l];
  const capabilityItems = capabilities[l];
  const metricItems = metrics[l];

  return (
    <main className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href={`/${l}`} className="landing-logo">
            <img src="/logo.png" alt="DBX" width={28} height={28} />
            <span>DBX</span>
          </Link>
          <div className="landing-nav-links">
            <Link href={`/${l}/docs/what-is-dbx`}>{t.navDocs}</Link>
            <Link href="https://github.com/t8y2/dbx" target="_blank">
              GitHub
            </Link>
            <Link href={l === 'cn' ? '/en' : '/cn'} className="landing-lang-switch">
              {t.lang}
            </Link>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow">{t.eyebrow}</div>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroSubtitle}</p>
          <div className="landing-hero-cta">
            <Link href="https://github.com/t8y2/dbx/releases/latest" className="landing-btn-primary">
              {t.download}
              <ArrowRight size={16} />
            </Link>
            <Link href={`/${l}/docs/getting-started`} className="landing-btn-secondary">
              {t.readDocs}
            </Link>
          </div>
          <div className="landing-install">
            <span>{t.installLabel}</span>
            <code>{t.installCommand}</code>
          </div>
        </div>
        <div className="landing-product">
          <div className="landing-window-bar">
            <span />
            <span />
            <span />
          </div>
          <img src="/screenshot-dark.png" alt="DBX product screenshot" />
        </div>
      </section>

      <section className="landing-metrics">
        {metricItems.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </section>

      <section className="landing-doc-start">
        <div>
          <h2>{t.docsStart}</h2>
          <p>{t.docsStartDesc}</p>
        </div>
        <Link href={`/${l}/docs/getting-started`} className="landing-inline-link">
          {t.readDocs}
          <ArrowRight size={15} />
        </Link>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <h2>{t.workflowsTitle}</h2>
          <p>{t.workflowsDesc}</p>
        </div>
        <div className="landing-workflow-grid">
          {workflowItems.map((item) => (
            <Link key={item.title} href={item.href} className="landing-workflow-card">
              <item.icon size={20} />
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
              <span>
                {t.readDocs}
                <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-section landing-support">
        <div className="landing-section-heading">
          <h2>{t.supportTitle}</h2>
          <p>{t.supportDesc}</p>
        </div>
        <div className="landing-db-list">
          {languages.map((db) => (
            <span key={db}>
              <CheckCircle2 size={14} />
              {db}
            </span>
          ))}
          <span>+ more</span>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <h2>{t.capabilitiesTitle}</h2>
        </div>
        <div className="landing-capability-grid">
          {capabilityItems.map((item) => (
            <div key={item.label} className="landing-capability">
              <item.icon size={18} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-final">
        <div>
          <h2>{t.footerTitle}</h2>
          <p>{t.footerDesc}</p>
        </div>
        <div className="landing-final-actions">
          <Link href="https://github.com/t8y2/dbx/releases/latest">{t.release}</Link>
          <Link href={`/${l}/docs/getting-started#docker`}>{t.docker}</Link>
        </div>
      </section>
    </main>
  );
}
