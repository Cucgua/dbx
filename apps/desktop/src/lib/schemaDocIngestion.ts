import type { SchemaRagApiDocExtraction } from "@/lib/schemaRag";

const API_DOC_SECTION_TARGET_CHARS = 900;
const API_DOC_SECTION_MAX_CHARS = 1300;
const API_DOC_SECTION_OVERLAP_CHARS = 120;

export const API_DOC_SECTION_MAX_CHARS_FOR_TEST = API_DOC_SECTION_MAX_CHARS;

export interface ApiDocExtractionSection {
  id: string;
  titlePath: string[];
  text: string;
}

export interface ApiDocExtractionRequest {
  sourceId: string;
  sourcePath: string;
  schema: string;
  sections: ApiDocExtractionSection[];
}

export interface ApiDocImportTextFile {
  path: string;
  displayName?: string | null;
  content: string;
}

export async function buildApiDocExtractionRequest(
  file: ApiDocImportTextFile,
  schema: string,
): Promise<ApiDocExtractionRequest> {
  const sourceId = await apiDocSourceId(file.path);
  return {
    sourceId,
    sourcePath: file.path,
    schema,
    sections: splitMarkdownSections(file.content, sourceId),
  };
}

export async function apiDocSourceId(path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `api-doc:${hex}`;
}

export function emptyFailedApiDocExtraction(sourceId: string, error: string): SchemaRagApiDocExtraction {
  return {
    sourceId,
    extractedAt: new Date().toISOString(),
    status: "failed",
    apiFields: [],
    businessConcepts: [],
    joinCandidates: [],
    errors: [error],
  };
}

export function splitMarkdownSections(markdown: string, sourceId: string): ApiDocExtractionSection[] {
  const titleStack: string[] = [];
  let currentTitlePath: string[] = [];
  let currentLines: string[] = [];
  const sections: ApiDocExtractionSection[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = markdownHeading(line);
    if (heading) {
      pushMarkdownSection(sourceId, sections, currentTitlePath, currentLines);
      titleStack.length = Math.max(0, heading.level - 1);
      titleStack.push(heading.title);
      currentTitlePath = [...titleStack];
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  pushMarkdownSection(sourceId, sections, currentTitlePath, currentLines);
  return sections;
}

function markdownHeading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  const title = match[2]?.trim();
  if (!title) return null;
  return { level: match[1].length, title };
}

function pushMarkdownSection(
  sourceId: string,
  sections: ApiDocExtractionSection[],
  titlePath: string[],
  lines: string[],
) {
  const text = lines.join("\n").trim();
  if (!text) return;
  const path = titlePath.length ? titlePath : ["参考文档"];
  for (const chunk of splitLongSectionByLine(text)) {
    sections.push({
      id: `${sourceId}#section-${sections.length + 1}`,
      titlePath: path,
      text: chunk,
    });
  }
}

function splitLongSectionByLine(text: string): string[] {
  if (text.length <= API_DOC_SECTION_MAX_CHARS) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > API_DOC_SECTION_MAX_CHARS) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = overlapText(current);
      }
      for (let start = 0; start < line.length; start += API_DOC_SECTION_TARGET_CHARS) {
        const part = line.slice(start, start + API_DOC_SECTION_MAX_CHARS).trim();
        if (part) chunks.push(part);
      }
      current = "";
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > API_DOC_SECTION_MAX_CHARS) {
      if (current.trim()) chunks.push(current.trim());
      current = `${overlapText(current)}${overlapText(current) ? "\n" : ""}${line}`;
    } else {
      current = next;
    }
    if (current.length >= API_DOC_SECTION_TARGET_CHARS) {
      chunks.push(current.trim());
      current = overlapText(current);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function overlapText(text: string): string {
  const chars = Array.from(text);
  return chars
    .slice(Math.max(0, chars.length - API_DOC_SECTION_OVERLAP_CHARS))
    .join("")
    .trim();
}
