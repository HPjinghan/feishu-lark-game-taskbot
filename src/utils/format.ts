import type { TaskDraft } from "../types";
import {
  FIELD_TASK_ID, FIELD_TITLE, FIELD_MODULE, FIELD_TYPE, FIELD_STATUS,
  FIELD_OWNER, FIELD_ACCEPTOR, FIELD_START_DATE, FIELD_DUE_DATE, FIELD_VERSION, FIELD_DESC,
  MY_TASK_STATUSES, ACCEPTANCE_TASK_STATUSES,
} from "../config";

export function normalizeValue(value: any): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(normalizeValue).join(", ");
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.value) return String(value.value);
    return JSON.stringify(value);
  }
  return String(value);
}

export function normalizeDateValue(value: any): string {
  const raw = normalizeValue(value);
  if (raw === "-") return raw;
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) return raw;
  const ms = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function formatDateOnly(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

export function formatTask(record: any): string {
  const f = record.fields || {};
  return [
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${normalizeValue(f[FIELD_TASK_ID])}`,
    `模块：${normalizeValue(f[FIELD_MODULE])}`,
    `类型：${normalizeValue(f[FIELD_TYPE])}`,
    `开发状态：${normalizeValue(f[FIELD_STATUS])}`,
    `人员：${normalizeValue(f[FIELD_OWNER])}`,
    `验收人：${normalizeValue(f[FIELD_ACCEPTOR])}`,
    `开始时间：${normalizeDateValue(f[FIELD_START_DATE])}`,
    `截止时间：${normalizeDateValue(f[FIELD_DUE_DATE])}`,
    `版本：${normalizeValue(f[FIELD_VERSION])}`,
    `描述：${normalizeValue(f[FIELD_DESC])}`,
  ].join("\n");
}

export function formatTaskSummary(record: any): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  const title = normalizeValue(f[FIELD_TITLE]);
  const module = normalizeValue(f[FIELD_MODULE]);
  const dueDate = normalizeDateValue(f[FIELD_DUE_DATE]);
  return [
    taskId !== "-" ? `[${taskId}]` : "",
    title,
    module !== "-" ? `(${module})` : "",
    dueDate !== "-" ? `截止：${dueDate}` : "",
  ].filter(Boolean).join(" ");
}

function formatGroupedTasks(records: any[], statuses: string[], emptyText: string, titleText: string): string {
  if (records.length === 0) return emptyText;
  const lines = [titleText.replace("{count}", String(records.length))];
  for (const status of statuses) {
    const group = records.filter((r) => normalizeValue(r.fields?.[FIELD_STATUS]) === status);
    if (group.length === 0) continue;
    lines.push("", `${status}（${group.length}）：`);
    lines.push(...group.map((r) => `- ${formatTaskSummary(r)}`));
  }
  return lines.join("\n");
}

export function formatMyTasks(records: any[], subjectName = "你"): string {
  return formatGroupedTasks(
    records, MY_TASK_STATUSES,
    `${subjectName}名下暂无 ${MY_TASK_STATUSES.join(" / ")} 状态的任务。`,
    `${subjectName}名下当前有 {count} 个待推进任务：`,
  );
}

export function formatAcceptanceTasks(records: any[]): string {
  return formatGroupedTasks(
    records, ACCEPTANCE_TASK_STATUSES,
    `暂无待你验收的任务（${ACCEPTANCE_TASK_STATUSES.join(" / ")}）。`,
    "当前有 {count} 个待你验收的任务：",
  );
}

export function formatDraftTags(task: TaskDraft): string {
  let dateTag = "";
  if (typeof task.dueDate === "number") {
    dateTag = typeof task.startDate === "number"
      ? `${formatDateOnly(task.startDate)}→${formatDateOnly(task.dueDate)}`
      : `截止:${formatDateOnly(task.dueDate)}`;
  }
  const tags = [task.type, task.module ? `模块:${task.module}` : "", task.version ? `版本:${task.version}` : "", dateTag].filter(Boolean);
  return tags.length > 0 ? `（${tags.join(" · ")}）` : "";
}

export function formatReviewNotice(record: any): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  return [
    "有一条任务待你验收",
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${taskId}`,
    `负责人：${normalizeValue(f[FIELD_OWNER])}`,
    `截止时间：${normalizeDateValue(f[FIELD_DUE_DATE])}`,
    "",
    "可直接回复：",
    `· ${taskId}通过（验收通过，进入下一环节）`,
    `· ${taskId}驳回 原因（打回给负责人重做，原因可选）`,
  ].join("\n");
}

export function formatTaskAssignedNotice(record: any, isNew: boolean): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  return [
    isNew ? "有一条新任务分配给你" : "有一条任务被指派给你",
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${taskId}`,
    `类型：${normalizeValue(f[FIELD_TYPE])}`,
    `截止时间：${normalizeDateValue(f[FIELD_DUE_DATE])}`,
    `当前状态：${normalizeValue(f[FIELD_STATUS])}`,
    "",
    `完成后回复：${taskId}完成`,
  ].join("\n");
}

export function formatDueDateChangeNotice(record: any, beforeDueRaw: string): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  const newDue = normalizeDateValue(f[FIELD_DUE_DATE]);
  const oldDue = beforeDueRaw ? normalizeDateValue(beforeDueRaw) : "";
  return [
    "你有一条任务的截止时间被修改",
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${taskId}`,
    oldDue && oldDue !== "-" ? `截止时间：${oldDue} → ${newDue}` : `新的截止时间：${newDue}`,
    `当前状态：${normalizeValue(f[FIELD_STATUS])}`,
  ].join("\n");
}

export function formatQaNotice(record: any): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  return [
    "有新功能完成啦，可以验收啦！",
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${taskId}`,
    "",
    "可直接回复：",
    `· ${taskId}通过（验收通过，进入下一环节）`,
    `· ${taskId}驳回 原因（打回给负责人重做，原因可选）`,
  ].join("\n");
}

export function formatRejectNotice(record: any, reason: string, fromStatus: string): string {
  const f = record.fields || {};
  const taskId = normalizeValue(f[FIELD_TASK_ID]);
  return [
    "你的任务被驳回，请处理",
    `任务：${normalizeValue(f[FIELD_TITLE])}`,
    `TaskID：${taskId}`,
    `驳回环节：${fromStatus}`,
    `驳回原因：${reason || "（未填写）"}`,
    "最新状态：重新打开",
    "",
    `处理完成后可回复：${taskId}完成`,
  ].join("\n");
}

export function getPersonOpenIds(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(getPersonOpenIds);
  if (typeof value === "object") return [value.id, value.open_id, value.user_id].filter((id): id is string => Boolean(id));
  return [];
}
