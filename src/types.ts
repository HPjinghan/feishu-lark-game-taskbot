export interface Env {
  LARK_APP_ID: string;
  LARK_APP_SECRET: string;
  LARK_API_BASE: string;
  BITABLE_APP_TOKEN: string;
  BITABLE_WIKI_TOKEN?: string;
  TASK_TABLE_ID: string;
  BOT_KV: KVNamespace;
  DEBUG_EVENTS?: string;
  ADMIN_OPEN_IDS?: string;
  // Optional: powers the auto-scheduler's LLM-assisted steps (task breakdown,
  // duration estimation). Bring-your-own-key — works with Anthropic, OpenAI,
  // or any OpenAI-compatible endpoint (DeepSeek, Moonshot/Kimi, local models, etc).
  // Leave LLM_API_KEY unset to run the bot with zero LLM dependency.
  LLM_PROVIDER?: string; // "anthropic" | "openai" (default: "anthropic" if key set)
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string; // override for self-hosted / alternate-region / openai-compatible endpoints
  LLM_MODEL?: string;
}

export interface BoundUser {
  openId: string;
  name: string;
}

export interface PendingAcceptor {
  taskId: string;
  recordId: string;
}

export interface TaskDraft {
  title: string;
  type: string;
  module?: string;
  version?: string;
  startDate?: number;
  dueDate?: number;
}

export interface EventFieldValue {
  field_id: string;
  field_value: string;
}
