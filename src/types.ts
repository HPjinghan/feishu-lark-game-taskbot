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
