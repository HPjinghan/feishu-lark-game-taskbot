import type { Env } from "./types";

// All KV operations go through these helpers. Any error is swallowed and logged
// so that KV failures never bubble up as 500s — Lark would keep retrying the
// same event and cause duplicate command execution.

export async function kvGet(env: Env, key: string): Promise<string | null> {
  try {
    return await env.BOT_KV.get(key);
  } catch (error: any) {
    console.error("KV get failed:", key, error?.message || error);
    return null;
  }
}

export async function kvPut(env: Env, key: string, value: string, options?: KVNamespacePutOptions): Promise<void> {
  try {
    await env.BOT_KV.put(key, value, options);
  } catch (error: any) {
    console.error("KV put failed:", key, error?.message || error);
  }
}

export async function kvDelete(env: Env, key: string): Promise<void> {
  try {
    await env.BOT_KV.delete(key);
  } catch (error: any) {
    console.error("KV delete failed:", key, error?.message || error);
  }
}
