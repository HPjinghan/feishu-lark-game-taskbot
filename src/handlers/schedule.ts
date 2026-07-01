import type { Env, BoundUser } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { replyText } from "../lark/message";
import { createTask, searchTasksByType } from "../bitable/records";
import { normalizeValue, formatDateOnly } from "../utils/format";
import { resolveScheduleWindow, extractFeatureName } from "../utils/parse";
import { findUserByName } from "../utils/directory";
import { scheduleTasks, type SchedulableTask } from "../utils/workday";
import { isLlmConfigured } from "../llm/provider";
import { extractFeatureUnits, estimateDurations } from "../llm/schedule";
import { kvGet, kvPut, kvDelete } from "../kv";
import { TYPE_PREREQUISITES, SCHEDULE_SESSION_TTL_SECONDS, FIELD_TITLE, FIELD_STATUS } from "../config";

// ─── Session state (multi-turn: ask about missing durations, then confirm) ──

interface DraftSubtask {
  id: string;
  title: string;
  type: string;
  ownerText: string | null;
  durationDays: number | null;
  dependsOn: string[];
}

interface ScheduleSession {
  subtasks: DraftSubtask[];
  windowStart: number;
  windowEnd: number | null;
  stage: "awaiting_durations" | "awaiting_confirmation";
  scheduled?: { id: string; startDate: number; dueDate: number }[];
  resolvedOwners?: { id: string; openId: string; name: string }[];
}

function sessionKey(chatId: string, senderOpenId: string): string {
  return `schedule_session:${chatId}:${senderOpenId}`;
}

async function loadSession(env: Env, chatId: string, senderOpenId: string): Promise<ScheduleSession | null> {
  const raw = await kvGet(env, sessionKey(chatId, senderOpenId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSession(env: Env, chatId: string, senderOpenId: string, session: ScheduleSession): Promise<void> {
  await kvPut(env, sessionKey(chatId, senderOpenId), JSON.stringify(session), {
    expirationTtl: SCHEDULE_SESSION_TTL_SECONDS,
  });
}

async function clearSession(env: Env, chatId: string, senderOpenId: string): Promise<void> {
  await kvDelete(env, sessionKey(chatId, senderOpenId));
}

// ─── Building the subtask graph ──────────────────────────────────────────────

// Flattens a type's prerequisite chain (deduplicated) into dependency order,
// e.g. 客户端 -> [策划/运营, UI, 客户端] since UI itself depends on 策划/运营.
function flattenTypeChain(type: string): string[] {
  const ordered: string[] = [];
  function visit(t: string) {
    if (ordered.includes(t)) return;
    for (const dep of TYPE_PREREQUISITES[t] || []) visit(dep);
    if (!ordered.includes(t)) ordered.push(t);
  }
  visit(type);
  return ordered;
}

// Checks whether an already-FINISHED task for this feature+type exists —
// matched by extractFeatureName (strip the type off the title, compare
// exactly), the same "same feature" signal used in handlers/tasks.ts for
// single ad-hoc task creation. If it's already done, there's no reason to
// generate a duplicate prerequisite subtask for it.
async function isStageAlreadyDone(env: Env, token: string, featureName: string, stageType: string): Promise<boolean> {
  const candidates = await searchTasksByType(env, token, stageType);
  return candidates.some((record: any) => {
    const candidateTitle = normalizeValue(record.fields?.[FIELD_TITLE]);
    if (extractFeatureName(candidateTitle, stageType) !== featureName) return false;
    return normalizeValue(record.fields?.[FIELD_STATUS]) === "已完成";
  });
}

async function buildSubtasksForFeature(
  env: Env,
  token: string,
  featureName: string,
  type: string | null,
  ownerText: string | null,
  durationDays: number | null,
  idCounter: { n: number },
): Promise<DraftSubtask[]> {
  const leafType = type || "default";
  const chain = flattenTypeChain(leafType);

  const subtasks: DraftSubtask[] = [];
  let prevId: string | undefined;
  for (const t of chain) {
    const isLeaf = t === leafType;
    const stageType = t === "default" ? (type || "") : t;

    // Non-leaf (prerequisite) stages: skip generating a duplicate if this
    // feature already has a finished task of this type. Note: an UNFINISHED
    // match isn't gated against here — this only avoids recreating done
    // work, it doesn't yet pin the new chain to an external task's due date.
    if (!isLeaf && (await isStageAlreadyDone(env, token, featureName, stageType))) continue;

    const id = `t${idCounter.n++}`;
    subtasks.push({
      id,
      title: isLeaf ? featureName : `${featureName}${t}`,
      type: stageType,
      ownerText: isLeaf ? ownerText : null,
      durationDays: isLeaf ? durationDays : null,
      dependsOn: prevId ? [prevId] : [],
    });
    prevId = id;
  }
  return subtasks;
}

// ─── Draft rendering + owner/date resolution ─────────────────────────────────

async function resolveOwners(env: Env, subtasks: DraftSubtask[]): Promise<Map<string, BoundUser | null>> {
  const resolved = new Map<string, BoundUser | null>();
  for (const s of subtasks) {
    if (!s.ownerText) continue;
    const result = await findUserByName(env, s.ownerText);
    resolved.set(s.id, result.status === "found" ? result.user : null);
  }
  return resolved;
}

async function finalizeDraft(
  env: Env,
  chatId: string,
  senderOpenId: string,
  subtasks: DraftSubtask[],
  windowStart: number,
  windowEnd: number | null,
): Promise<void> {
  const resolvedOwners = await resolveOwners(env, subtasks);

  const scheduleInput: SchedulableTask[] = subtasks.map((s) => ({
    id: s.id,
    // Unresolved owners get a unique synthetic key so they don't artificially
    // serialize against each other — only genuinely-the-same-person tasks
    // should queue up sequentially.
    owner: resolvedOwners.get(s.id)?.openId || `unassigned:${s.id}`,
    durationDays: Math.max(1, s.durationDays || 1),
    dependsOn: s.dependsOn,
  }));

  const scheduled = scheduleTasks(scheduleInput, windowStart);
  const scheduledById = new Map(scheduled.map((s) => [s.id, s]));

  const lines = subtasks.map((s) => {
    const sch = scheduledById.get(s.id)!;
    const owner = resolvedOwners.get(s.id);
    const ownerLabel = owner ? owner.name : s.ownerText ? `${s.ownerText}（待确认，通讯录未匹配）` : "待分配";
    return `${s.title}｜${s.type}｜${formatDateOnly(sch.startDate)}-${formatDateOnly(sch.dueDate)}｜@${ownerLabel}`;
  });

  const warnings: string[] = [];
  if (windowEnd !== null) {
    const maxDue = Math.max(...scheduled.map((s) => s.dueDate));
    if (maxDue > windowEnd) {
      warnings.push(`⚠️ 按当前工时和依赖关系，最晚会到 ${formatDateOnly(maxDue)}，超出了截止窗口 ${formatDateOnly(windowEnd)}，可能需要压缩工时或加人。`);
    }
  }

  await saveSession(env, chatId, senderOpenId, {
    subtasks,
    windowStart,
    windowEnd,
    stage: "awaiting_confirmation",
    scheduled: scheduled.map((s) => ({ id: s.id, startDate: s.startDate, dueDate: s.dueDate })),
    resolvedOwners: [...resolvedOwners.entries()]
      .filter((entry): entry is [string, BoundUser] => Boolean(entry[1]))
      .map(([id, u]) => ({ id, openId: u.openId, name: u.name })),
  });

  const windowNote = windowEnd !== null
    ? `窗口：${formatDateOnly(windowStart)} - ${formatDateOnly(windowEnd)}`
    : "（未指定截止窗口，从今天开始排）";

  await replyText(env, chatId, [
    `[排期草稿] ${windowNote}`,
    "",
    ...lines,
    ...(warnings.length > 0 ? ["", ...warnings] : []),
    "",
    "回复「确认」创建这些任务；或者直接说要改哪条。",
  ].join("\n"));
}

// ─── Entry points ─────────────────────────────────────────────────────────────

export async function handleScheduleCommand(env: Env, chatId: string, senderOpenId: string, description: string): Promise<void> {
  if (!isLlmConfigured(env)) {
    await replyText(
      env,
      chatId,
      "排期功能需要先配置 LLM_API_KEY（用于理解你的自然语言描述），请联系管理员配置，或者改用「创建任务」/「批量创建任务」手动指定。",
    );
    return;
  }

  let units;
  try {
    units = await extractFeatureUnits(env, description);
  } catch (error: any) {
    await replyText(env, chatId, `解析需求失败：${error?.message || error}`);
    return;
  }

  if (units.length === 0) {
    await replyText(env, chatId, "没有从描述里识别出任何功能，麻烦换个说法试试。");
    return;
  }

  // Type carry-forward: an unspecified type inherits the most recently
  // stated type earlier in the same message, rather than being asked about.
  let lastType: string | null = null;
  for (const unit of units) {
    if (!unit.type && lastType) unit.type = lastType;
    if (unit.type) lastType = unit.type;
  }

  const window = resolveScheduleWindow(description);
  const token = await getTenantAccessToken(env);
  const idCounter = { n: 0 };
  const subtasks: DraftSubtask[] = [];
  for (const u of units) {
    subtasks.push(...(await buildSubtasksForFeature(env, token, u.featureName, u.type, u.ownerText, u.durationDays, idCounter)));
  }

  const missing = subtasks.filter((s) => s.durationDays === null);
  if (missing.length > 0) {
    const estimates = await estimateDurations(env, missing.map((s) => ({ id: s.id, title: s.title, type: s.type })));
    let stillMissing = false;
    for (const s of missing) {
      const estimate = estimates[s.id];
      if (typeof estimate === "number" && estimate > 0) {
        s.durationDays = estimate;
      } else {
        stillMissing = true;
      }
    }
    // Normally unreachable when the LLM behaves — this path is a defensive
    // fallback if the estimate call comes back incomplete.
    if (stillMissing) {
      const stillMissingList = subtasks.filter((s) => s.durationDays === null);
      await saveSession(env, chatId, senderOpenId, {
        subtasks,
        windowStart: window?.start ?? Date.now(),
        windowEnd: window?.end ?? null,
        stage: "awaiting_durations",
      });
      await replyText(
        env,
        chatId,
        ["工时估算不完整，还差这些，麻烦告诉我（格式：任务名 天数，一行一个）：", ...stillMissingList.map((s) => `- ${s.title}`)].join("\n"),
      );
      return;
    }
  }

  await finalizeDraft(env, chatId, senderOpenId, subtasks, window?.start ?? Date.now(), window?.end ?? null);
}

export async function handleScheduleDurationReply(env: Env, chatId: string, senderOpenId: string, text: string): Promise<boolean> {
  const session = await loadSession(env, chatId, senderOpenId);
  if (!session || session.stage !== "awaiting_durations") return false;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(.+?)\s*(\d+)\s*天?$/);
    if (!match) continue;
    const namePart = match[1].trim();
    const days = Number(match[2]);
    const target = session.subtasks.find(
      (s) => s.durationDays === null && (s.title.includes(namePart) || namePart.includes(s.title)),
    );
    if (target) target.durationDays = days;
  }

  const stillMissing = session.subtasks.filter((s) => s.durationDays === null);
  if (stillMissing.length > 0) {
    await saveSession(env, chatId, senderOpenId, session);
    await replyText(env, chatId, ["还差这些工时：", ...stillMissing.map((s) => `- ${s.title}`)].join("\n"));
    return true;
  }

  await finalizeDraft(env, chatId, senderOpenId, session.subtasks, session.windowStart, session.windowEnd);
  return true;
}

const CONFIRM_KEYWORDS = ["确认", "confirm", "ok", "没问题"];

export function isScheduleConfirmReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return CONFIRM_KEYWORDS.some((k) => normalized === k.toLowerCase());
}

export async function handleScheduleConfirm(env: Env, chatId: string, senderOpenId: string): Promise<boolean> {
  const session = await loadSession(env, chatId, senderOpenId);
  if (!session || session.stage !== "awaiting_confirmation" || !session.scheduled) return false;

  const token = await getTenantAccessToken(env);
  const scheduledById = new Map(session.scheduled.map((s) => [s.id, s]));
  const ownersById = new Map((session.resolvedOwners || []).map((o) => [o.id, o]));

  const created: string[] = [];
  const failed: string[] = [];

  for (const s of session.subtasks) {
    const sch = scheduledById.get(s.id);
    if (!sch) continue;
    const owner = ownersById.get(s.id);
    try {
      const record = await createTask(env, token, s.title, owner?.openId || "", s.type, "", "", sch.dueDate, sch.startDate);
      const taskId = normalizeValue(record?.fields?.["TaskID"]);
      created.push(`${taskId !== "-" ? `${taskId} ` : ""}${s.title}`);
    } catch (error: any) {
      failed.push(`${s.title}：${error?.message || error}`);
    }
  }

  await clearSession(env, chatId, senderOpenId);

  await replyText(env, chatId, [
    `已创建 ${created.length} 个任务：`,
    ...created.map((c) => `- ${c}`),
    ...(failed.length > 0 ? ["", `创建失败 ${failed.length} 个：`, ...failed.map((f) => `- ${f}`)] : []),
  ].join("\n"));

  return true;
}

export async function hasPendingScheduleSession(env: Env, chatId: string, senderOpenId: string): Promise<boolean> {
  return Boolean(await loadSession(env, chatId, senderOpenId));
}
