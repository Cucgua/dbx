import type { ConnectionConfig } from "@dbx-app/node-core";

export interface ConnectionSummary {
  name: string;
  type: string;
  host: string;
  port: number;
  database?: string;
}

export function connectionSummary(connection: ConnectionConfig): ConnectionSummary {
  return {
    name: connection.name,
    type: connection.db_type,
    host: connection.host,
    port: connection.port,
    database: connection.database || undefined,
  };
}

export interface ErrorPayload {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export function errorPayload(code: string, message: string): ErrorPayload {
  const hint = errorHint(code, message);
  return { error: hint ? { code, message, hint } : { code, message } };
}

export function formatErrorMessage(code: string, message: string): string {
  const hint = errorHint(code, message);
  return hint ? `${message}\n\nHint: ${hint}` : message;
}

function errorHint(code: string, message: string): string | undefined {
  if (code === "CONNECTION_STORE_ERROR" && /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(message)) {
    return "Rebuild DBX CLI native dependencies with your active Node.js: pnpm rebuild better-sqlite3 keytar --pending, or reinstall the package with the same Node.js version you use to run dbx.";
  }
  return undefined;
}

export function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length), 3));
  const header = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`;
  const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c, i) => (c || "").padEnd(widths[i])).join(" | ")} |`).join("\n");
  return body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function csvTable<T extends object>(headers: string[], rows: T[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    const values = row as Record<string, unknown>;
    lines.push(headers.map((header) => csvCell(values[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
