import type { AiConfig } from "@/stores/settingsStore";

export async function generateSql(
  config: AiConfig,
  prompt: string,
  tableContext: string,
): Promise<string> {
  const systemPrompt = `You are a SQL expert assistant. Given the database schema below, generate a SQL query based on the user's request. Return ONLY the SQL query, no explanations.\n\nSchema:\n${tableContext}`;

  if (config.provider === "claude") {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }

  // OpenAI-compatible (works for OpenAI, custom endpoints)
  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
    }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
