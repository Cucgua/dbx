export type RedisMemberDetailFormat = "json" | "text";

export interface RedisMemberDetail {
  text: string;
  format: RedisMemberDetailFormat;
}

export type RedisMemberDetailKind = "list" | "set" | "hash" | "zset" | "stream";

export const REDIS_MEMBER_DETAIL_SHEET_MIN_WIDTH = 360;
export const REDIS_MEMBER_DETAIL_SHEET_MAX_WIDTH = 900;

export function canEditRedisMemberDetail(kind: RedisMemberDetailKind): boolean {
  return kind !== "stream";
}

export function clampRedisMemberDetailSheetWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(REDIS_MEMBER_DETAIL_SHEET_MIN_WIDTH, viewportWidth - 32);
  return Math.min(
    Math.min(REDIS_MEMBER_DETAIL_SHEET_MAX_WIDTH, viewportMax),
    Math.max(REDIS_MEMBER_DETAIL_SHEET_MIN_WIDTH, width),
  );
}

export function formatRedisMemberDetail(value: unknown): RedisMemberDetail {
  if (typeof value === "string") {
    const formatted = formatRedisJsonString(value);
    return formatted ? { text: formatted, format: "json" } : { text: value, format: "text" };
  }

  try {
    return { text: JSON.stringify(value, null, 2), format: "json" };
  } catch {
    return { text: String(value), format: "text" };
  }
}

export function formatRedisStringValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  return formatRedisJsonString(value) ?? value;
}

export function formatRedisCommandResult(value: unknown): string {
  if (typeof value === "string") return formatRedisStringValue(value);
  return JSON.stringify(value, null, 2);
}

function formatRedisJsonString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export function getRedisMemberSelectionKey(title: string, value: unknown): string {
  return `${title}\n${formatRedisMemberDetail(value).text}`;
}

export function highlightRedisJsonDetail(json: string): string {
  const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (match.startsWith('"')) cls = match.endsWith(":") ? "json-key" : "json-string";
      else if (match === "true" || match === "false") cls = "json-boolean";
      else if (match === "null") cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    },
  );
}
