import type { Env } from "../types";
import {
  FIELD_TASK_ID, FIELD_TITLE, FIELD_TYPE, FIELD_MODULE, FIELD_VERSION,
  FIELD_STATUS, FIELD_OWNER, FIELD_ACCEPTOR, FIELD_START_DATE, FIELD_DUE_DATE,
  MY_TASK_STATUSES, ACCEPTANCE_TASK_STATUSES,
} from "../config";
import { normalizeValue } from "../utils/format";

async function searchRecords(env: Env, token: string, filter: any, pageSize = 10): Promise<any[]> {
  const baseUrl = `${env.LARK_API_BASE}/open-apis/bitable/v1/apps/${env.BITABLE_APP_TOKEN}/tables/${env.TASK_TABLE_ID}/records/search`;
  const items: any[] = [];
  let pageToken = "";
  do {
    const url = `${baseUrl}?user_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ page_size: pageSize, filter }),
    });
    const data: any = await res.json();
    if (data.code !== 0) throw new Error(`Failed to search records: ${JSON.stringify(data)}`);
    items.push(...(data?.data?.items || []));
    pageToken = data?.data?.has_more ? data?.data?.page_token || "" : "";
  } while (pageToken);
  return items;
}

export async function searchTaskByTaskId(env: Env, token: string, taskId: string): Promise<any | null> {
  const items = await searchRecords(env, token, {
    conjunction: "and",
    conditions: [{ field_name: FIELD_TASK_ID, operator: "is", value: [taskId] }],
  }, 10);
  return items[0] || null;
}

export async function searchTaskByTitleAndType(env: Env, token: string, title: string, type: string, module = "", version = ""): Promise<any | null> {
  const conditions: any[] = [{ field_name: FIELD_TITLE, operator: "is", value: [title] }];
  if (type) conditions.push({ field_name: FIELD_TYPE, operator: "is", value: [type] });
  if (module) conditions.push({ field_name: FIELD_MODULE, operator: "is", value: [module] });
  if (version) conditions.push({ field_name: FIELD_VERSION, operator: "is", value: [version] });
  const items = await searchRecords(env, token, { conjunction: "and", conditions }, 1);
  return items[0] || null;
}

export async function searchTasksByPersonOpenId(
  env: Env, token: string, fieldName: string, personOpenId: string, statuses: string[],
): Promise<any[]> {
  const items = await searchRecords(env, token, {
    conjunction: "and",
    conditions: [{ field_name: fieldName, operator: "contains", value: [personOpenId] }],
  }, 500);
  return items.filter((r) => statuses.includes(normalizeValue(r.fields?.[FIELD_STATUS])));
}

export async function searchTasksByOwnerOpenId(env: Env, token: string, ownerOpenId: string): Promise<any[]> {
  return searchTasksByPersonOpenId(env, token, FIELD_OWNER, ownerOpenId, MY_TASK_STATUSES);
}

// Used for dependency-gating: fetches every task of a given (prerequisite)
// type so the caller can match by extracted feature name (see
// utils/parse.ts's extractFeatureName) — e.g. finding an unfinished UI or
// 策划案 task for the "same feature" before letting a 客户端 task start.
export async function searchTasksByType(env: Env, token: string, type: string): Promise<any[]> {
  return searchRecords(env, token, {
    conjunction: "and",
    conditions: [{ field_name: FIELD_TYPE, operator: "is", value: [type] }],
  }, 500);
}

const FINISHED_STATUSES = ["已完成", "已停滞"];

// Unlike searchTasksByOwnerOpenId (which only matches the narrow "todo"
// statuses for the "我的任务" query), this returns EVERY task still on
// someone's plate — including brand-new tasks that don't have 开发状态 set
// yet at all. Used for workload/capacity checks ("when is this person
// actually free"), where a freshly created task with no status is still
// very much real work sitting on their calendar.
export async function searchActiveTasksByOwnerOpenId(env: Env, token: string, ownerOpenId: string): Promise<any[]> {
  const items = await searchRecords(env, token, {
    conjunction: "and",
    conditions: [{ field_name: FIELD_OWNER, operator: "contains", value: [ownerOpenId] }],
  }, 500);
  return items.filter((r) => !FINISHED_STATUSES.includes(normalizeValue(r.fields?.[FIELD_STATUS])));
}

export async function searchTasksByAcceptorOpenId(env: Env, token: string, acceptorOpenId: string): Promise<any[]> {
  return searchTasksByPersonOpenId(env, token, FIELD_ACCEPTOR, acceptorOpenId, ACCEPTANCE_TASK_STATUSES);
}

export async function getTaskByRecordId(env: Env, token: string, recordId: string, appToken = env.BITABLE_APP_TOKEN): Promise<any | null> {
  const url = `${env.LARK_API_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${env.TASK_TABLE_ID}/records/${recordId}?user_id_type=open_id`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to get task record: ${JSON.stringify(data)}`);
  return data?.data?.record || null;
}

export async function createTask(
  env: Env, token: string, title: string, owner: string | string[] = "",
  type = "", module = "", version = "", dueDate?: number, startDate?: number,
): Promise<any> {
  const url = `${env.LARK_API_BASE}/open-apis/bitable/v1/apps/${env.BITABLE_APP_TOKEN}/tables/${env.TASK_TABLE_ID}/records?user_id_type=open_id`;
  const fields: Record<string, any> = { [FIELD_TITLE]: title };
  if (type) fields[FIELD_TYPE] = type;
  if (module) fields[FIELD_MODULE] = module;
  if (version) fields[FIELD_VERSION] = version;
  if (typeof startDate === "number") fields[FIELD_START_DATE] = startDate;
  if (typeof dueDate === "number") fields[FIELD_DUE_DATE] = dueDate;
  // A task can have more than one owner (e.g. a feature jointly done by two
  // people) — accepts either a single open_id (existing callers) or a list.
  const ownerIds = (Array.isArray(owner) ? owner : [owner]).filter(Boolean);
  if (ownerIds.length > 0) fields[FIELD_OWNER] = ownerIds.map((id) => ({ id }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to create task: ${JSON.stringify(data)}`);
  return data?.data?.record;
}

export async function updateTaskFields(env: Env, token: string, recordId: string, fields: Record<string, any>): Promise<void> {
  const url = `${env.LARK_API_BASE}/open-apis/bitable/v1/apps/${env.BITABLE_APP_TOKEN}/tables/${env.TASK_TABLE_ID}/records/${recordId}?user_id_type=open_id`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to update task fields: ${JSON.stringify(data)}`);
}

export async function updateTaskStatus(env: Env, token: string, recordId: string, status: string): Promise<void> {
  await updateTaskFields(env, token, recordId, { [FIELD_STATUS]: status });
}

export async function updateTaskAcceptor(env: Env, token: string, recordId: string, openId: string): Promise<void> {
  await updateTaskFields(env, token, recordId, { [FIELD_ACCEPTOR]: [{ id: openId }] });
}
