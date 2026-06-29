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
export const ACCEPTANCE_TASK_STATUSES = ["下游验收", "美术验收", "转测试"];

// Keywords that trigger each query type.
export const MY_TASK_QUERY_KEYWORDS = [
  "我的任务", "我的待办", "我有哪些任务", "我名下", "待办", "任务", "todo",
];
export const ACCEPTANCE_TASK_QUERY_KEYWORDS = [
  "待我验收", "我的验收", "需要我验收", "验收任务", "待验收",
];
export const HELP_QUERY_KEYWORDS = ["帮助", "help", "菜单", "命令"];

// KV keys for role bindings.
// "美术验收人" role (e.g. Art Director) handles art acceptance.
// "QA" role handles testing acceptance.
export const ROLE_ART_REVIEWER_KEY = "role:art_reviewer";
export const ROLE_QA_KEY = "role:qa";

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
