import type { Env, BoundUser, TaskDraft } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { replyText } from "../lark/message";
import { searchTaskByTaskId, searchTaskByTitleAndType, searchTasksByOwnerOpenId, searchActiveTasksByOwnerOpenId, searchTasksByType, searchTasksByAcceptorOpenId, createTask } from "../bitable/records";
import { getSelectOptionsByFieldName } from "../bitable/fields";
import { normalizeValue, formatTask, formatMyTasks, formatAcceptanceTasks, formatDraftTags } from "../utils/format";
import { parseTaskDraftSmart, extractFeatureName } from "../utils/parse";
import { resolveOwnerNextFreeDay, addWorkdays, nextWorkday, DAY_MS } from "../utils/workday";
import { FIELD_DUE_DATE, FIELD_STATUS, FIELD_TITLE, TYPE_PREREQUISITES } from "../config";

// If this task's type has prerequisite types (客户端 needs UI + 策划/运营,
// per TYPE_PREREQUISITES), checks whether any not-yet-finished task of a
// prerequisite type exists for the SAME FEATURE — matched by stripping each
// task's own type off its title (extractFeatureName) and comparing the
// remainder exactly, e.g. "月卡客户端" and "月卡UI" both reduce to "月卡".
// No 模块 field required. Returns the latest such blocking due date, or null
// if nothing is gating this task.
async function resolvePrerequisiteGateDate(env: Env, token: string, task: TaskDraft): Promise<number | null> {
  const prereqTypes = TYPE_PREREQUISITES[task.type] || [];
  if (prereqTypes.length === 0) return null;

  const featureName = extractFeatureName(task.title, task.type);
  if (!featureName) return null;

  let latestDue: number | null = null;
  for (const prereqType of prereqTypes) {
    const candidates = await searchTasksByType(env, token, prereqType);
    for (const record of candidates) {
      const candidateTitle = normalizeValue(record.fields?.[FIELD_TITLE]);
      if (extractFeatureName(candidateTitle, prereqType) !== featureName) continue;

      const status = normalizeValue(record.fields?.[FIELD_STATUS]);
      const due = record.fields?.[FIELD_DUE_DATE];
      if (status === "已完成" || typeof due !== "number") continue;
      if (latestDue === null || due > latestDue) latestDue = due;
    }
  }
  return latestDue;
}

// Turns a bare "N天" duration into real start/due dates. Two things can push
// the start date later than "tomorrow":
//   1. the owner's own existing workload (resolveOwnerNextFreeDay)
//   2. an unfinished prerequisite-type task for the same feature (客户端 must
//      wait on UI/策划案, per TYPE_PREREQUISITES) — whichever constraint is
//      later wins
// If the input already gave an explicit date (task.dueDate is set), this is
// a no-op: an explicit date always wins over a duration guess.
async function resolveDurationDates(env: Env, token: string, task: TaskDraft, ownerOpenId?: string): Promise<void> {
  if (task.dueDate !== undefined || !task.durationDays) return;

  let existingDueDates: number[] = [];
  if (ownerOpenId) {
    const existing = await searchActiveTasksByOwnerOpenId(env, token, ownerOpenId);
    existingDueDates = existing
      .map((r: any) => r.fields?.[FIELD_DUE_DATE])
      .filter((v: any): v is number => typeof v === "number");
  }
  const ownerFreeDay = resolveOwnerNextFreeDay(existingDueDates);

  const prereqGateDate = await resolvePrerequisiteGateDate(env, token, task);
  const start = prereqGateDate !== null
    ? nextWorkday(Math.max(ownerFreeDay, prereqGateDate + DAY_MS))
    : ownerFreeDay;

  task.startDate = start;
  task.dueDate = addWorkdays(start, task.durationDays - 1);
}

export async function handleShowTask(env: Env, chatId: string, taskId: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }
  await replyText(env, chatId, formatTask(record));
}

export async function handleMyTasks(env: Env, chatId: string, targetOpenId: string, subjectName = "你"): Promise<void> {
  if (!targetOpenId) { await replyText(env, chatId, "暂时无法识别你的用户身份，请确认事件里包含 open_id。"); return; }
  const token = await getTenantAccessToken(env);
  const records = await searchTasksByOwnerOpenId(env, token, targetOpenId);
  await replyText(env, chatId, formatMyTasks(records, subjectName));
}

export async function handleAcceptanceTasks(env: Env, chatId: string, senderOpenId: string): Promise<void> {
  if (!senderOpenId) { await replyText(env, chatId, "暂时无法识别你的用户身份，请确认事件里包含 open_id。"); return; }
  const token = await getTenantAccessToken(env);
  const records = await searchTasksByAcceptorOpenId(env, token, senderOpenId);
  await replyText(env, chatId, formatAcceptanceTasks(records));
}

export async function handleCreateTask(env: Env, chatId: string, title: string, owner: BoundUser | null): Promise<void> {
  const token = await getTenantAccessToken(env);
  let optionsByField: Record<string, string[]> = {};
  try { optionsByField = await getSelectOptionsByFieldName(env, token); } catch (e: any) { console.error("Failed to load field options:", e?.message || e); }
  const task = parseTaskDraftSmart(title, optionsByField);
  await resolveDurationDates(env, token, task, owner?.openId);
  const record = await createTask(env, token, task.title, owner?.openId || "", task.type, task.module || "", task.version || "", task.dueDate, task.startDate);
  const taskId = normalizeValue(record?.fields?.["TaskID"]);
  await replyText(env, chatId, [
    "已创建任务",
    taskId !== "-" ? `TaskID：${taskId}` : "",
    `任务：${task.title}`,
    task.type ? `类型：${task.type}` : "",
    task.module ? `模块：${task.module}` : "",
    task.version ? `版本：${task.version}` : "",
    typeof task.startDate === "number" ? `开始时间：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(task.startDate))}` : "",
    typeof task.dueDate === "number" ? `截止时间：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(task.dueDate))}` : "",
    owner ? `人员：${owner.name}` : "",
  ].filter(Boolean).join("\n"));
}

export interface BatchTaskLine {
  rawTitle: string;
  // Owner for this specific line, if it had its own @mention. Null means
  // "use the batch-level default owner" (e.g. a single @mention at the end
  // of the whole command applying to every line).
  lineOwner: BoundUser | null;
}

export async function handleBatchCreateTasks(
  env: Env,
  chatId: string,
  lines: BatchTaskLine[],
  defaultOwner: BoundUser | null,
): Promise<void> {
  const token = await getTenantAccessToken(env);
  let optionsByField: Record<string, string[]> = {};
  try { optionsByField = await getSelectOptionsByFieldName(env, token); } catch (e: any) { console.error("Failed to load field options:", e?.message || e); }

  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const line of lines) {
    const task = parseTaskDraftSmart(line.rawTitle, optionsByField);
    const owner = line.lineOwner ?? defaultOwner;
    await resolveDurationDates(env, token, task, owner?.openId);
    try {
      const existing = await searchTaskByTitleAndType(env, token, task.title, task.type, task.module || "", task.version || "");
      if (existing) {
        const existingTaskId = normalizeValue(existing?.fields?.["TaskID"]);
        skipped.push(`${existingTaskId !== "-" ? `${existingTaskId} ` : ""}${task.title}${formatDraftTags(task)}`);
        continue;
      }
      const record = await createTask(env, token, task.title, owner?.openId || "", task.type, task.module || "", task.version || "", task.dueDate, task.startDate);
      const taskId = normalizeValue(record?.fields?.["TaskID"]);
      const ownerTag = owner ? ` @${owner.name}` : "";
      created.push(`${taskId !== "-" ? `${taskId} ` : ""}${task.title}${formatDraftTags(task)}${ownerTag}`);
    } catch (e: any) {
      failed.push(`${task.title}：${e?.message || e}`);
    }
  }

  await replyText(env, chatId, [
    `已创建 ${created.length} 个任务`,
    ...created.map((item) => `- ${item}`),
    skipped.length > 0 ? `\n已存在，跳过 ${skipped.length} 个：` : "",
    ...skipped.map((item) => `- ${item}`),
    failed.length > 0 ? `\n创建失败 ${failed.length} 个：` : "",
    ...failed.map((item) => `- ${item}`),
  ].filter((l) => l !== "").join("\n"));
}
