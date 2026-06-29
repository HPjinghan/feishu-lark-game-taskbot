import type { Env } from "../types";
import { getTenantAccessToken } from "./auth";

export async function createGroupChat(env: Env, name: string, userOpenIds: string[]): Promise<string> {
  const token = await getTenantAccessToken(env);
  const res = await fetch(`${env.LARK_API_BASE}/open-apis/im/v1/chats?user_id_type=open_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, user_id_list: userOpenIds, bot_id_list: [env.LARK_APP_ID] }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to create group chat: ${JSON.stringify(data)}`);
  return data?.data?.chat_id || "";
}

export async function deleteGroupChat(env: Env, chatId: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const res = await fetch(`${env.LARK_API_BASE}/open-apis/im/v1/chats/${chatId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to dismiss group chat: ${JSON.stringify(data)}`);
}
