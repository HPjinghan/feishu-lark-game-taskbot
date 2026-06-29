import type { BoundUser } from "../types";

export function extractText(event: any): string {
  const content = event?.message?.content;
  if (content) {
    try {
      return JSON.parse(content).text || "";
    } catch {
      return "";
    }
  }
  return event?.text_without_at_bot || event?.text || "";
}

export function removeBotMention(text: string, event: any): string {
  const mentions = event?.message?.mentions || [];
  for (const mention of mentions) {
    const isBotMention = mention?.mentioned_type === "bot" || mention?.id?.app_id || mention?.id?.open_id === event?.message?.chat_id;
    if (isBotMention && mention?.key) {
      text = text.replace(mention.key, "").trim();
    }
  }
  return text.trim();
}

export function removeUserMentions(text: string, event: any): string {
  const mentions = event?.message?.mentions || [];
  for (const mention of mentions) {
    if (mention?.mentioned_type === "user" && mention?.key) {
      text = text.replace(mention.key, "").trim();
    }
  }
  return text.trim();
}

export function hasBotMention(event: any): boolean {
  const mentions = event?.message?.mentions || [];
  return mentions.some((m: any) => m?.mentioned_type === "bot" || m?.id?.app_id);
}

export function hasAnyMention(event: any): boolean {
  return (event?.message?.mentions || []).length > 0;
}

export function isPrivateChat(event: any): boolean {
  const chatType = event?.message?.chat_type || event?.chat_type || "";
  return chatType === "p2p" || chatType === "private";
}

export function getChatId(event: any): string {
  return event?.message?.chat_id || event?.open_chat_id || event?.chat_id || "";
}

export function getSenderOpenId(event: any): string {
  return event?.sender?.sender_id?.open_id || event?.sender?.id?.open_id || event?.open_id || "";
}

export function getFirstUserMention(event: any): BoundUser | null {
  return getUserMentions(event)[0] || null;
}

export function getUserMentions(event: any): BoundUser[] {
  const mentions = event?.message?.mentions || [];
  const users: BoundUser[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (mention?.mentioned_type !== "user") continue;
    const openId =
      mention?.id?.open_id || mention?.open_id ||
      mention?.id?.user_id || mention?.user_id ||
      mention?.id?.union_id || mention?.union_id || "";
    if (!openId || seen.has(openId)) continue;
    seen.add(openId);
    users.push({ openId, name: mention?.name || "对方" });
  }
  return users;
}

export function getEventType(body: any): string {
  return body?.header?.event_type || body?.event_type || body?.type || "";
}

export function getEventId(body: any): string {
  return body?.header?.event_id || body?.uuid || body?.event_id || "";
}

export function getMessageId(event: any): string {
  return event?.message?.message_id || event?.message_id || "";
}
