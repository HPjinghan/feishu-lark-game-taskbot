import type { Env } from "../types";
import { kvGet, kvPut } from "../kv";
import { COMMAND_DEDUPE_TTL_SECONDS } from "../config";

export async function shouldSkipDuplicateEventKeys(env: Env, keys: string[]): Promise<boolean> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return false;
  for (const key of uniqueKeys) {
    if (await kvGet(env, `event_dedupe:${key}`)) return true;
  }
  await Promise.all(uniqueKeys.map((key) => kvPut(env, `event_dedupe:${key}`, "1", { expirationTtl: 24 * 60 * 60 })));
  return false;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shouldSkipDuplicateCommand(env: Env, scope: string, payload: any): Promise<boolean> {
  const hash = await sha256Hex(JSON.stringify(payload));
  const key = `command_dedupe:${scope}:${hash}`;
  if (await kvGet(env, key)) return true;
  await kvPut(env, key, "1", { expirationTtl: COMMAND_DEDUPE_TTL_SECONDS });
  return false;
}

export async function markRecentSelfAction(env: Env, recordId: string, action: string): Promise<void> {
  await kvPut(env, `recent_self_action:${recordId}:${action}`, "1", { expirationTtl: 2 * 60 });
}

export async function hasRecentSelfAction(env: Env, recordId: string, action: string): Promise<boolean> {
  return Boolean(await kvGet(env, `recent_self_action:${recordId}:${action}`));
}
