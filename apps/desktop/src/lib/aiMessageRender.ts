export interface AiMessageTextSegment {
  type: "text";
  content: string;
  html: string;
}

export interface AiMessageCodeSegment {
  type: "code";
  content: string;
  lang: string;
}

export type AiMessageRenderSegment = AiMessageTextSegment | AiMessageCodeSegment;

interface MessageSegment {
  type: "text" | "code";
  content: string;
  lang?: string;
}

export interface AiMessageRendererOptions {
  maxEntries?: number;
  markdown: (text: string) => string;
}

const DEFAULT_MAX_ENTRIES = 100;

export function createAiMessageRenderer(options: AiMessageRendererOptions) {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const cache = new Map<string, AiMessageRenderSegment[]>();

  function render(content: string): AiMessageRenderSegment[] {
    const cached = cache.get(content);
    if (cached) {
      cache.delete(content);
      cache.set(content, cached);
      return cached;
    }

    const rendered = parseAiMessage(content).map((segment): AiMessageRenderSegment => {
      if (segment.type === "text") {
        return { type: "text", content: segment.content, html: options.markdown(segment.content) };
      }
      return { type: "code", content: segment.content, lang: segment.lang ?? "SQL" };
    });

    cache.set(content, rendered);
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    return rendered;
  }

  function clear() {
    cache.clear();
  }

  return { render, clear };
}

export function parseAiMessage(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```(sql|mysql|postgresql|sqlite|tsql|clickhouse)?\s*$/i);
    if (fenceMatch) {
      const lang = (fenceMatch[1] || "sql").toUpperCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const content = codeLines.join("\n").trim();
      if (content) segments.push({ type: "code", lang, content });
    } else {
      const textLines: string[] = [];
      while (i < lines.length && !/^```(sql|mysql|postgresql|sqlite|tsql|clickhouse)?\s*$/i.test(lines[i])) {
        textLines.push(lines[i]);
        i++;
      }
      const content = textLines.join("\n");
      if (content.trim()) segments.push({ type: "text", content });
    }
  }

  return segments;
}
