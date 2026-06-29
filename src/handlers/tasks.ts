import type { Env, BoundUser } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { replyText } from "../lark/message";
import { searchTaskByTaskId, searchTaskByTitleAndType, searchTasksByOwnerOpenId, searchTasksByAcceptorOpenId, createTask } from "../bitable/records";
import { getSelectOptionsByFieldName } from "../bitable/fields";
import { normalizeValue, formatTask, formatMyTasks, formatAcceptanceTasks, formatDraftTags } from "../utils/format";
import { parseTaskDraftSmart } from "../utils/parse";

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

export async function handleBatchCreateTasks(env: Env, chatId: string, titles: string[], owner: BoundUser | null): Promise<void> {
  const token = await getTenantAccessToken(env);
  let optionsByField: Record<string, string[]> = {};
  try { optionsByField = await getSelectOptionsByFieldName(env, token); } catch (e: any) { console.error("Failed to load field options:", e?.message || e); }

  const tasks = titles.map((t) => parseTaskDraftSmart(t, optionsByField));
  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const task of tasks) {
    try {
      const existing = await searchTaskByTitleAndType(env, token, task.title, task.type, task.module || "", task.version || "");
      if (existing) {
        const existingTaskId = normalizeValue(existing?.fields?.["TaskID"]);
        skipped.push(`${existingTaskId !== "-" ? `${existingTaskId} ` : ""}${task.title}${formatDraftTags(task)}`);
        continue;
      }
      const record = await createTask(env, token, task.title, owner?.openId || "", task.type, task.module || "", task.version || "", task.dueDate, task.startDate);
      const taskId = normalizeValue(record?.fields?.["TaskID"]);
      created.push(`${taskId !== "-" ? `${taskId} ` : ""}${task.title}${formatDraftTags(task)}`);
    } catch (e: any) {
      failed.push(`${task.title}：${e?.message || e}`);
    }
  }

  await replyText(env, chatId, [
    `已创建 ${created.length} 个任务${owner ? `，人员：${owner.name}` : ""}`,
    ...created.map((item) => `- ${item}`),
    skipped.length > 0 ? `\n已存在，跳过 ${skipped.length} 个：` : "",
    ...skipped.map((item) => `- ${item}`),
    failed.length > 0 ? `\n创建失败 ${failed.length} 个：` : "",
    ...failed.map((item) => `- ${item}`),
  ].filter((l) => l !== "").join("\n"));
}
