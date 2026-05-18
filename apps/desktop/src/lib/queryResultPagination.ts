import type { DatabaseType } from "../types/database.ts";
import { usesFetchFirst } from "./databaseCapabilities.ts";
import { quoteTableIdentifier } from "./tableSelectSql.ts";
import { findStatementAtCursor } from "./sqlStatementSplit.ts";

export interface PaginatedQuerySqlResult {
  ok: true;
  sql: string;
}

export interface PaginatedQuerySqlError {
  ok: false;
  reason: "empty" | "multi" | "not_select" | "unsupported";
}

export interface QueryPaginationExecutionPlan {
  sqlToExecute: string;
  pageSql?: string;
  pageLimit?: number;
  pageOffset?: number;
  countSql?: string;
  useAgentResultSession: boolean;
}

const unsupportedPaginationTypes = new Set<DatabaseType | undefined>(["neo4j", "mongodb", "redis", "elasticsearch"]);

export function buildQueryPaginationExecutionPlan({
  sql,
  queryBaseSql,
  databaseType,
  pagination,
  useAgentCursor,
}: {
  sql: string;
  queryBaseSql: string;
  databaseType: DatabaseType | undefined;
  pagination: { limit: number; offset: number; sessionId?: string };
  useAgentCursor: boolean;
}): QueryPaginationExecutionPlan {
  const plan: QueryPaginationExecutionPlan = {
    sqlToExecute: sql,
    useAgentResultSession: false,
  };
  const counted = buildCountQuerySql(queryBaseSql, databaseType);
  if (counted.ok) {
    plan.countSql = counted.sql;
  }

  if (pagination.sessionId) {
    plan.pageLimit = pagination.limit;
    plan.pageOffset = pagination.offset;
    plan.useAgentResultSession = true;
    return plan;
  }

  if (useAgentCursor && pagination.offset === 0) {
    plan.sqlToExecute = queryBaseSql;
    plan.pageLimit = pagination.limit;
    plan.pageOffset = pagination.offset;
    plan.useAgentResultSession = true;
    return plan;
  }

  const paginated = buildPaginatedQuerySql(sql, databaseType, pagination.limit, pagination.offset);
  if (paginated.ok) {
    plan.sqlToExecute = paginated.sql;
    plan.pageSql = paginated.sql;
    plan.pageLimit = pagination.limit;
    plan.pageOffset = pagination.offset;
  }
  return plan;
}

export function buildPaginatedQuerySql(
  originalSql: string,
  databaseType: DatabaseType | undefined,
  limit: number,
  offset: number,
): PaginatedQuerySqlResult | PaginatedQuerySqlError {
  const statement = singleSelectableStatement(originalSql);
  if (!statement.ok) return statement;
  if (unsupportedPaginationTypes.has(databaseType)) return { ok: false, reason: "unsupported" };

  const safeLimit = Math.max(1, Math.floor(limit));
  const safeOffset = Math.max(0, Math.floor(offset));
  const alias = quoteTableIdentifier(databaseType, "dbx_page");
  const base = `SELECT * FROM (${statement.sql}) ${alias}`;

  if (databaseType === "sqlserver") {
    return {
      ok: true,
      sql: `${base} ORDER BY (SELECT NULL) OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`,
    };
  }

  if (usesFetchFirst(databaseType)) {
    const offsetSql = safeOffset ? ` OFFSET ${safeOffset} ROWS` : "";
    return { ok: true, sql: `${base}${offsetSql} FETCH FIRST ${safeLimit} ROWS ONLY` };
  }

  const offsetSql = safeOffset ? ` OFFSET ${safeOffset}` : "";
  return { ok: true, sql: `${base} LIMIT ${safeLimit}${offsetSql};` };
}

export function buildCountQuerySql(
  originalSql: string,
  databaseType: DatabaseType | undefined,
): PaginatedQuerySqlResult | PaginatedQuerySqlError {
  const statement = singleSelectableStatement(originalSql);
  if (!statement.ok) return statement;
  if (unsupportedPaginationTypes.has(databaseType)) return { ok: false, reason: "unsupported" };

  const alias = quoteTableIdentifier(databaseType, "dbx_count");
  return { ok: true, sql: `SELECT COUNT(*) AS dbx_total_rows FROM (${statement.sql}) ${alias};` };
}

function singleSelectableStatement(
  originalSql: string,
): { ok: true; sql: string } | Pick<PaginatedQuerySqlError, "ok" | "reason"> {
  const baseSql = originalSql.trim();
  if (!baseSql) return { ok: false, reason: "empty" };

  const statement = findStatementAtCursor(baseSql, 0)
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (!statement) return { ok: false, reason: "empty" };
  if (statement.length !== baseSql.replace(/;+\s*$/, "").trim().length) {
    return { ok: false, reason: "multi" };
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(statement)) {
    return { ok: false, reason: "not_select" };
  }

  return { ok: true, sql: statement };
}
