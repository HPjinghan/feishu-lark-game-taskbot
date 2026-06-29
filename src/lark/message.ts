import type { Env } from "../types";
import { getTenantAccessToken } from "./auth";

export async function replyText(env: Env, chatId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const res = await fetch(`${env.LARK_API_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to send message: ${JSON.stringify(data)}`);
}

export async function sendPrivateText(env: Env, openId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const res = await fetch(`${env.LARK_API_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ receive_id: openId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to send private message: ${JSON.stringify(data)}`);
}
