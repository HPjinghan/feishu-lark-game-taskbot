import type { Env } from "../types";
import { callLlm, extractJson } from "./provider";
import { TASK_TYPES } from "../config";

// The LLM's job is deliberately narrow: split unstructured, shorthand text
// into a list of independent "feature units". Everything else — dependency
// expansion, date math, fuzzy owner lookup, type carry-forward — stays in
// deterministic code (see handlers/schedule.ts). This keeps the one LLM call
// cheap, fast, and easy to sanity-check, instead of asking it to reason about
// the whole scheduling problem end to end.

export interface FeatureUnit {
  featureName: string;
  type: string | null; // null if the type genuinely wasn't stated — do NOT let the model guess
  ownerText: string | null; // kept verbatim from the input, resolved to a real person later
  durationDays: number | null; // null if the input didn't give one — do NOT let the model guess here either
}

export async function extractFeatureUnits(env: Env, description: string): Promise<FeatureUnit[]> {
  const system = [
    "你是游戏研发团队的任务拆解助手。",
    `团队使用的任务类型只能是这些之一：${TASK_TYPES.join("、")}。`,
    "用户会用简略、口语化的方式描述一批要排期的功能，请把它切分成独立的『功能单元』列表。",
    "每个功能单元包含四个字段：",
    "- featureName：功能名，不包含类型和人名",
    "- type：任务类型。只有原文明确写出时才填对应的团队类型；没写就填 null，绝对不要猜",
    "- ownerText：负责人。原样保留原文里的名字或代号，不要翻译、不要改写；没提到就填 null",
    "- durationDays：工时天数（整数）。只有原文明确给出数字时才填；没给就填 null，绝对不要估算",
    "只返回一个 JSON 数组，不要任何解释文字，不要 markdown 代码块包裹。",
  ].join("\n");

  const raw = await callLlm(env, system, description);
  const parsed = extractJson<any[]>(raw);
  if (!Array.isArray(parsed)) throw new Error("LLM 返回的不是数组");

  return parsed
    .map((u): FeatureUnit => ({
      featureName: String(u?.featureName || "").trim(),
      type: u?.type ? String(u.type).trim() : null,
      ownerText: u?.ownerText ? String(u.ownerText).trim() : null,
      durationDays: typeof u?.durationDays === "number" ? u.durationDays : null,
    }))
    .filter((u) => u.featureName);
}

export interface DurationEstimateRequest {
  id: string;
  title: string;
  type: string;
}

/** Estimates missing durations (working days) for a batch of subtasks in one call. */
export async function estimateDurations(env: Env, items: DurationEstimateRequest[]): Promise<Record<string, number>> {
  if (items.length === 0) return {};

  const system = [
    "你是游戏研发团队的排期助手，需要给一批任务估算所需工作日（正整数）。",
    "经验参考：策划案类通常 1 天；UI 设计类通常 1-2 天；客户端/服务器开发类通常 2-4 天，视复杂度判断；美术资源类 2-5 天。",
    "只返回一个 JSON 对象，key 是任务的 id，value 是估算的工作日整数，不要任何解释文字，不要 markdown 代码块包裹。",
  ].join("\n");

  const raw = await callLlm(env, system, JSON.stringify(items));
  const parsed = extractJson<Record<string, number>>(raw);
  return parsed;
}
