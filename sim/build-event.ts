import { getOrCreateFakeOpenId } from "./registry";

// Converts "@Name" written in the simulator's input box into a proper Lark
// mention structure (placeholder key in the text + a matching entry in
// mentions[]), so the real bot code — which expects genuine Lark mention
// shapes — behaves identically to how it would against production traffic.
export function buildFakeMessageEvent(rawText: string, senderName = "我"): any {
  const mentions: any[] = [];
  let mentionIndex = 0;

  const text = rawText.replace(/@([^\s@]+)/g, (_match, name) => {
    mentionIndex++;
    const key = `@_user_${mentionIndex}`;
    const openId = getOrCreateFakeOpenId(name);
    mentions.push({
      key,
      mentioned_type: "user",
      id: { open_id: openId },
      name,
      tenant_key: "sim-tenant",
    });
    return key;
  });

  const senderOpenId = getOrCreateFakeOpenId(senderName);

  return {
    header: {
      event_id: `sim-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      event_type: "im.message.receive_v1",
    },
    event: {
      sender: { sender_id: { open_id: senderOpenId }, sender_type: "user" },
      message: {
        chat_id: "sim_chat_1",
        chat_type: "p2p",
        message_id: `sim-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: JSON.stringify({ text }),
        mentions,
      },
    },
  };
}
