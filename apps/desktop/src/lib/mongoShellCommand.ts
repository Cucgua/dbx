import type { QueryResult } from "@/types/database";

export interface MongoFindCommand {
  collection: string;
  filter: string;
  skip: number;
  limit: number;
  sort?: string;
}

const DEFAULT_LIMIT = 100;

export function parseMongoFindCommand(input: string): MongoFindCommand | null {
  const source = input.trim().replace(/;$/, "").trim();
  const target = parseFindTarget(source);
  if (!target) return null;

  const findOpenIndex = source.indexOf("(", target.findCallIndex);
  const findCloseIndex = findMatchingParen(source, findOpenIndex);
  if (findCloseIndex < 0) return null;

  const findArgs = splitTopLevel(source.slice(findOpenIndex + 1, findCloseIndex));
  const filter = normalizeJsonArgument(findArgs[0] || "{}");
  if (!filter) return null;

  const chain = source.slice(findCloseIndex + 1).trim();
  if (chain && !chain.startsWith(".")) return null;

  const sortArg = readChainedCallArgument(chain, "sort");
  let sort: string | undefined;
  if (sortArg !== undefined) {
    const parsedSort = normalizeJsonArgument(sortArg);
    if (!parsedSort) return null;
    sort = parsedSort;
  }

  const skip = readChainedIntegerArgument(chain, "skip", 0);
  const limit = readChainedIntegerArgument(chain, "limit", DEFAULT_LIMIT);
  if (skip === null || limit === null) return null;

  return {
    collection: target.collection,
    filter,
    skip,
    limit,
    sort,
  };
}

export function mongoDocumentsToQueryResult(documents: unknown[], executionTimeMs: number, total: number): QueryResult {
  const columns: string[] = [];

  for (const doc of documents) {
    if (isRecord(doc)) {
      for (const key of Object.keys(doc)) {
        if (!columns.includes(key)) columns.push(key);
      }
    } else if (!columns.includes("value")) {
      columns.push("value");
    }
  }

  const rows = documents.map((doc) => {
    if (isRecord(doc)) return columns.map((column) => toCellValue(doc[column]));
    return columns.map((column) => (column === "value" ? toCellValue(doc) : null));
  });

  return {
    columns,
    rows,
    affected_rows: total,
    execution_time_ms: Math.max(0, Math.round(executionTimeMs)),
    truncated: total > documents.length,
  };
}

function parseFindTarget(source: string): { collection: string; findCallIndex: number } | null {
  const direct = /^db\.([A-Za-z_$][\w$]*)\.find\s*\(/.exec(source);
  if (direct) {
    return { collection: direct[1], findCallIndex: source.indexOf(".find", direct[0].length - ".find(".length) };
  }

  const getCollection = /^db\.getCollection\s*\(\s*(["'])(.*?)\1\s*\)\.find\s*\(/.exec(source);
  if (getCollection) {
    return {
      collection: getCollection[2],
      findCallIndex: source.indexOf(".find", getCollection[0].length - ".find(".length),
    };
  }

  return null;
}

function normalizeJsonArgument(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "{}";
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function readChainedIntegerArgument(source: string, name: string, fallback: number): number | null {
  const raw = readChainedCallArgument(source, name);
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function readChainedCallArgument(source: string, name: string): string | undefined {
  const call = `.${name}`;
  let index = source.indexOf(call);
  while (index >= 0) {
    const afterName = index + call.length;
    const openIndex = skipWhitespace(source, afterName);
    if (source[openIndex] === "(") {
      const closeIndex = findMatchingParen(source, openIndex);
      if (closeIndex >= 0) return source.slice(openIndex + 1, closeIndex);
    }
    index = source.indexOf(call, afterName);
  }
  return undefined;
}

function skipWhitespace(source: string, index: number) {
  let cursor = index;
  while (/\s/.test(source[cursor] || "")) cursor += 1;
  return cursor;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts;
}

function findMatchingParen(source: string, openIndex: number): number {
  if (source[openIndex] !== "(") return -1;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toCellValue(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}
