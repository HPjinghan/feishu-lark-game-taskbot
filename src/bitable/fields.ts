import type { Env } from "../types";
import { kvGet, kvPut, kvDelete } from "../kv";
import { FIELD_MAP_KEY, FIELD_OPTIONS_KEY, FIELD_MAP_TTL_SECONDS } from "../config";

export async function getBitableFileTokenForDrive(env: Env, token: string): Promise<string> {
  if (!env.BITABLE_WIKI_TOKEN) return env.BITABLE_APP_TOKEN;
  const url = `${env.LARK_API_BASE}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(env.BITABLE_WIKI_TOKEN)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to resolve wiki bitable token: ${JSON.stringify(data)}`);
  const node = data?.data?.node || {};
  if (node.obj_type !== "bitable" && node.obj_type !== 3) throw new Error(`Wiki node is not a bitable: ${JSON.stringify(node)}`);
  if (!node.obj_token) throw new Error(`Wiki node missing obj_token: ${JSON.stringify(node)}`);
  return node.obj_token;
}

async function fetchAllFields(env: Env, token: string, appToken: string): Promise<any[]> {
  const items: any[] = [];
  let pageToken = "";
  do {
    const url =
      `${env.LARK_API_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${env.TASK_TABLE_ID}/fields?page_size=100` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await res.json();
    if (data.code !== 0) throw new Error(`Failed to list fields: ${JSON.stringify(data)}`);
    items.push(...(data?.data?.items || []));
    pageToken = data?.data?.has_more ? data?.data?.page_token || "" : "";
  } while (pageToken);
  return items;
}

export async function getFieldIdNameMap(env: Env, token: string, appToken = env.BITABLE_APP_TOKEN): Promise<Record<string, string>> {
  const cacheKey = `${FIELD_MAP_KEY}:${appToken}:${env.TASK_TABLE_ID}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { await kvDelete(env, cacheKey); }
  }
  const map: Record<string, string> = {};
  for (const item of await fetchAllFields(env, token, appToken)) {
    if (item.field_id && item.field_name) map[item.field_id] = item.field_name;
  }
  await kvPut(env, cacheKey, JSON.stringify(map), { expirationTtl: FIELD_MAP_TTL_SECONDS });
  return map;
}

export async function getSelectOptionsByFieldName(env: Env, token: string, appToken = env.BITABLE_APP_TOKEN): Promise<Record<string, string[]>> {
  const cacheKey = `${FIELD_OPTIONS_KEY}:${appToken}:${env.TASK_TABLE_ID}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { await kvDelete(env, cacheKey); }
  }
  const result: Record<string, string[]> = {};
  for (const item of await fetchAllFields(env, token, appToken)) {
    const options = item?.property?.options;
    if (item.field_name && Array.isArray(options) && options.length > 0) {
      result[item.field_name] = options
        .map((opt: any) => (typeof opt?.name === "string" ? opt.name.trim() : ""))
        .filter(Boolean);
    }
  }
  await kvPut(env, cacheKey, JSON.stringify(result), { expirationTtl: FIELD_MAP_TTL_SECONDS });
  return result;
}

export async function subscribeBitableEvents(env: Env): Promise<any> {
  const { getTenantAccessToken } = await import("../lark/auth");
  const token = await getTenantAccessToken(env);
  const fileToken = await getBitableFileTokenForDrive(env, token);
  const url = `${env.LARK_API_BASE}/open-apis/drive/v1/files/${fileToken}/subscribe?file_type=bitable`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to subscribe bitable events: ${JSON.stringify(data)}`);
  return data;
}
