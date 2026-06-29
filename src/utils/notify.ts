import type { Env, BoundUser } from "../types";
import { kvGet, kvPut } from "../kv";
import { sendPrivateText } from "../lark/message";
import { NOTIFICATION_DEDUPE_TTL_SECONDS } from "../config";

function getNotificationDedupeKey(kind: string, recordId: string, openId: string): string {
  return `notification:${kind}:${recordId}:${openId}`;
}

export async function notifyUsers(env: Env, openIds: string[], text: string): Promise<void> {
  for (const openId of [...new Set(openIds)]) {
    try {
      await sendPrivateText(env, openId, text);
    } catch (error: any) {
      console.error("Failed to notify user:", openId, error?.message || error);
    }
  }
}

export async function notifyUsersOnce(env: Env, kind: string, recordId: string, openIds: string[], text: string): Promise<void> {
  for (const openId of [...new Set(openIds)]) {
    const key = getNotificationDedupeKey(kind, recordId, openId);
    if (await kvGet(env, key)) continue;
    await kvPut(env, key, "1", { expirationTtl: NOTIFICATION_DEDUPE_TTL_SECONDS });
    try {
      await sendPrivateText(env, openId, text);
    } catch (error: any) {
      console.error("Failed to notify user:", openId, error?.message || error);
    }
  }
}

export function getAdminOpenIds(env: Env): string[] {
  return (env.ADMIN_OPEN_IDS || "").split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean);
}

export async function alertAdminsOnce(env: Env, dedupeKey: string, text: string): Promise<void> {
  const admins = getAdminOpenIds(env);
  if (admins.length === 0) return;
  const key = `alert_dedupe:${dedupeKey}`;
  if (await kvGet(env, key)) return;
  await kvPut(env, key, "1", { expirationTtl: 5 * 60 });
  for (const openId of admins) {
    try {
      await sendPrivateText(env, openId, text);
    } catch (error: any) {
      console.error("Failed to alert admin:", openId, error?.message || error);
    }
  }
}

export async function getBoundUser(env: Env, key: string): Promise<BoundUser | null> {
  const raw = await kvGet(env, key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setBoundUser(env: Env, key: string, user: BoundUser): Promise<void> {
  await kvPut(env, key, JSON.stringify(user));
}
