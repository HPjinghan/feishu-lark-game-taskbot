import type { Env } from "../types";

// Deliberately minimal: this bot is designed to run with ZERO LLM dependency
// by default. An LLM is only ever invoked for the genuinely ambiguous parts
// of the auto-scheduler (breaking down a vague feature description, estimating
// a duration nobody gave). Every other decision — workflow routing, dependency
// rules, date math, role bindings — stays in plain deterministic code.
//
// Bring-your-own-key: works with Anthropic's API, OpenAI's API, or any
// OpenAI-compatible chat completions endpoint (DeepSeek, Moonshot/Kimi,
// a self-hosted vLLM server, etc). No SDK dependency — just fetch.

export function isLlmConfigured(env: Env): boolean {
  return Boolean(env.LLM_API_KEY);
}

function getProvider(env: Env): string {
  return (env.LLM_PROVIDER || "anthropic").trim().toLowerCase();
}

/**
 * Sends a single system+user turn to the configured LLM and returns the raw
 * text response. Throws if no LLM_API_KEY is configured — callers should
 * check isLlmConfigured() first and fall back to asking the user directly
 * instead of surfacing a confusing API error mid-conversation.
 */
export async function callLlm(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!env.LLM_API_KEY) {
    throw new Error("LLM 未配置：请设置 LLM_API_KEY（可选 LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL）");
  }

  const provider = getProvider(env);
  if (provider === "anthropic") return callAnthropic(env, systemPrompt, userPrompt);
  if (provider === "openai" || provider === "openai-compatible") return callOpenAiCompatible(env, systemPrompt, userPrompt);

  throw new Error(`未知的 LLM_PROVIDER："${provider}"（支持 anthropic / openai / openai-compatible）`);
}

async function callAnthropic(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const baseUrl = (env.LLM_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const model = env.LLM_MODEL || "claude-sonnet-4-5";

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.LLM_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const data: any = await res.json();
  if (!res.ok) throw new Error(`Anthropic API 调用失败（${res.status}）：${JSON.stringify(data)}`);

  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`Anthropic API 返回格式异常：${JSON.stringify(data)}`);
  return text;
}

async function callOpenAiCompatible(env: Env, systemPrompt: string, userPrompt: string): Promise<string> {
  const baseUrl = (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.LLM_MODEL || "gpt-4o-mini";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const data: any = await res.json();
  if (!res.ok) throw new Error(`OpenAI 兼容 API 调用失败（${res.status}）：${JSON.stringify(data)}`);

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`OpenAI 兼容 API 返回格式异常：${JSON.stringify(data)}`);
  return text;
}

/**
 * Parses a JSON payload out of an LLM's raw text response, tolerating the
 * common case where models wrap JSON in a ```json ... ``` fence.
 */
export function extractJson<T = any>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`无法解析 LLM 返回的 JSON：${cleaned.slice(0, 300)}`);
  }
}
