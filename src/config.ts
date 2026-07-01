// Bitable field names — must match your table's column names exactly.
export const FIELD_TASK_ID = "TaskID";
export const FIELD_TITLE = "任务";
export const FIELD_MODULE = "模块";
export const FIELD_TYPE = "类型";
export const FIELD_STATUS = "开发状态";
export const FIELD_OWNER = "人员";
export const FIELD_ACCEPTOR = "验收人";
export const FIELD_START_DATE = "开始时间";
export const FIELD_DUE_DATE = "截止时间";
export const FIELD_VERSION = "版本";
export const FIELD_DESC = "任务描述/策划案";

// Default task types — merged with options read from the table at runtime.
export const TASK_TYPES = [
  "python/llm",
  "客户端",
  "服务器",
  "美术资源",
  "策划/运营",
  "UI",
  "文案",
  "市场",
];

export const VALID_STATUSES = [
  "未开始",
  "进行中",
  "下游验收",
  "美术验收",
  "已完成",
  "转测试",
  "已停滞",
  "重新打开",
];

export const MY_TASK_STATUSES = ["未开始", "进行中", "重新打开"];

// KV keys for role bindings.
export const ROLE_ART_REVIEWER_KEY = "role:art_reviewer";
export const ROLE_QA_KEY = "role:qa";

// Human-readable display names for each role key.
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  [ROLE_ART_REVIEWER_KEY]: "美术验收人",
  [ROLE_QA_KEY]: "QA",
};

// ─── Workflow routing ────────────────────────────────────────────────────────
//
// Defines which acceptance stages each task type goes through, in order.
// The last entry must always be "已完成".
// Types not listed fall through to "default".
//
// To customise for your team, edit this map — no other code needs changing.
export const WORKFLOW: Record<string, string[]> = {
  "客户端": ["下游验收", "美术验收", "转测试", "已完成"],
  "UI":     ["下游验收", "美术验收", "已完成"],
  "服务器": ["下游验收", "转测试", "已完成"],
  "default":["下游验收", "已完成"],
};

// Which KV role key is auto-assigned as acceptor when entering each stage.
// Stages not listed keep the existing acceptor field value.
export const STAGE_ROLE: Record<string, string> = {
  "美术验收": ROLE_ART_REVIEWER_KEY,
  "转测试":   ROLE_QA_KEY,
};

// Derived: all stages that count as "waiting for acceptance"
// (appears in any workflow, not a working status, not 已完成).
const _workingStatuses = new Set([...MY_TASK_STATUSES, "已完成", "已停滞"]);
export const ACCEPTANCE_TASK_STATUSES = [
  ...new Set(Object.values(WORKFLOW).flat().filter((s) => !_workingStatuses.has(s))),
];

// ─── Workflow helpers ────────────────────────────────────────────────────────

/** Returns the next stage for a given task type and current status, or null if not in workflow. */
export function getNextStage(taskType: string, currentStatus: string): string | null {
  const stages = WORKFLOW[taskType] ?? WORKFLOW["default"];
  const idx = stages.indexOf(currentStatus);
  if (idx === -1 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

/** Returns true if the current status is an acceptance stage for this task type. */
export function isAcceptanceStage(taskType: string, status: string): boolean {
  const stages = WORKFLOW[taskType] ?? WORKFLOW["default"];
  const idx = stages.indexOf(status);
  return idx > 0 && status !== "已完成";
}

// ────────────────────────────────────────────────────────────────────────────

// ─── Scheduling: dependency rules ────────────────────────────────────────────
//
// Deterministic prerequisite rules for the auto-scheduler ("排期机器人").
// These are settled facts about how your team works, not something the LLM
// should guess at — e.g. "client work always waits on UI + design doc" is a
// constant, not a judgment call. Only types NOT covered here (or ambiguous
// participation, see below) fall through to LLM reasoning or a direct question
// to the user.
//
// Map: task type -> list of task types that must be done first, if present
// in the same batch. A prerequisite type that isn't part of the current batch
// is silently skipped (e.g. "UI" prerequisite for "客户端" is ignored if this
// particular feature has no UI subtask).
export const TYPE_PREREQUISITES: Record<string, string[]> = {
  "客户端": ["UI", "策划/运营"],
  "UI":     ["策划/运营"],
};

// Task types whose participation in a feature is NOT assumed either way —
// the scheduler must ask the user directly ("这个功能需要服务器端吗？") rather
// than guessing or silently including/excluding them.
export const OPTIONAL_PARTICIPATION_TYPES = ["服务器"];

// ────────────────────────────────────────────────────────────────────────────

// Keywords that trigger each query type.
export const MY_TASK_QUERY_KEYWORDS = [
  "我的任务", "我的待办", "我有哪些任务", "我名下", "待办", "任务", "todo",
];
export const ACCEPTANCE_TASK_QUERY_KEYWORDS = [
  "待我验收", "我的验收", "需要我验收", "验收任务", "待验收",
];
export const HELP_QUERY_KEYWORDS = ["帮助", "help", "菜单", "命令"];

// KV keys for other state.
export const FIELD_MAP_KEY = "bitable:field_map";
export const FIELD_OPTIONS_KEY = "bitable:field_options";
export const LAST_BITABLE_EVENT_KEY = "debug:last_bitable_event";
export const LAST_DRIVE_EVENT_KEY = "debug:last_drive_event";

// TTLs in seconds.
export const PENDING_ACCEPTOR_TTL_SECONDS = 10 * 60;
export const FIELD_MAP_TTL_SECONDS = 24 * 60 * 60;
export const RECENT_SELF_ACTION_TTL_SECONDS = 2 * 60;
export const NOTIFICATION_DEDUPE_TTL_SECONDS = 5 * 60;
export const COMMAND_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const DUE_DATE_LABELS = new Set(["ddl", "截止", "截止时间", "deadline", "due"]);
