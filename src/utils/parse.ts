import type { TaskDraft } from "../types";
import {
  VALID_STATUSES, TASK_TYPES, FIELD_TYPE, FIELD_MODULE, FIELD_VERSION,
  FIELD_DUE_DATE, FIELD_START_DATE, DUE_DATE_LABELS,
  MY_TASK_QUERY_KEYWORDS, ACCEPTANCE_TASK_QUERY_KEYWORDS, HELP_QUERY_KEYWORDS,
} from "../config";

export function isMyTaskQuery(text: string): boolean {
  const n = text.trim().toLowerCase();
  return MY_TASK_QUERY_KEYWORDS.some((k) => n.includes(k.toLowerCase()));
}

export function isAcceptanceTaskQuery(text: string): boolean {
  const n = text.trim().toLowerCase();
  return ACCEPTANCE_TASK_QUERY_KEYWORDS.some((k) => n.includes(k.toLowerCase()));
}

export function isHelpQuery(text: string): boolean {
  const n = text.trim().toLowerCase();
  return HELP_QUERY_KEYWORDS.some((k) => n === k.toLowerCase());
}

export function parseSimpleStatusCommand(text: string): { taskId: string; status: string } | null {
  const match = text.trim().match(/^(\S+?)→(.+)$/);
  if (!match) return null;
  const taskId = match[1].trim();
  const status = match[2].trim();
  if (!taskId || !VALID_STATUSES.includes(status)) return null;
  return { taskId, status };
}

export function parseDoneCommand(text: string): { taskId: string } | null {
  const match = text.trim().match(/^(\S+?)完成$/);
  return match ? { taskId: match[1] } : null;
}

export function parseAcceptancePassCommand(text: string): { taskId: string } | null {
  const match = text.trim().match(/^(\S+?)(?:验收通过|通过)$/);
  return match ? { taskId: match[1] } : null;
}

export function parseAcceptanceRejectCommand(text: string): { taskId: string; reason: string } | null {
  const match = text.trim().match(/^(\S+?)(?:验收驳回|验收不通过|驳回|打回)[\s:：]*([\s\S]*)$/);
  return match ? { taskId: match[1].trim(), reason: (match[2] || "").trim() } : null;
}

export function parseModifyCommand(text: string): { taskId: string; field: string; value: string } | null {
  const match = text.trim().match(/^修改\s*([0-9]+)\s*(ddl|deadline|due|截止时间|截止|版本|类型|模块)\s*[:：]?\s*(.+)$/i);
  if (!match) return null;
  const taskId = match[1].trim();
  const rawField = match[2].toLowerCase();
  const value = match[3].trim();
  if (!value) return null;
  let field = "";
  if (["ddl", "deadline", "due", "截止时间", "截止"].includes(rawField)) field = FIELD_DUE_DATE;
  else if (rawField === "版本") field = FIELD_VERSION;
  else if (rawField === "类型") field = FIELD_TYPE;
  else if (rawField === "模块") field = FIELD_MODULE;
  if (!field) return null;
  return { taskId, field, value };
}

export function parseBindRoleCommand(text: string): { roleName: string } | null {
  const match = text.trim().match(/^绑定(美术验收人|QA)(?:\s|$)/i);
  return match ? { roleName: match[1] } : null;
}

export function parseCreateTaskCommand(text: string): { title: string } | null {
  const match = text.trim().match(/^创建任务\s*(.+)$/);
  if (!match) return null;
  const title = match[1].trim();
  return title ? { title } : null;
}

export function parseBatchCreateTaskCommand(text: string): { titles: string[] } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:批量创建任务|创建多个任务)\s*([\s\S]*)$/);
  if (!match) return null;
  const titles = match[1].trim().split(/\r?\n|[;；]/).map((t) => t.trim()).filter(Boolean);
  return titles.length > 0 ? { titles } : null;
}

export function parseSimpleShowCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (isHelpQuery(trimmed) || isMyTaskQuery(trimmed) || isAcceptanceTaskQuery(trimmed)) return null;
  return trimmed;
}

function isVersionToken(token: string): boolean {
  return /^[vV]\d+(\.\d+)*$/.test(token);
}

export function parseDueDateToMs(dateStr: string): number | null {
  const ds = dateStr.trim();
  let year: number | undefined;
  let month: number;
  let day: number;
  let m = ds.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else if ((m = ds.match(/^(\d{1,2})[/\-.月](\d{1,2})日?$/))) {
    month = Number(m[1]); day = Number(m[2]);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  if (year === undefined) {
    const nowShanghai = new Date(Date.now() + SHANGHAI_OFFSET_MS);
    year = nowShanghai.getUTCFullYear();
    const candidate = Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
    if (candidate < Date.now() - 24 * 60 * 60 * 1000) year += 1;
  }
  const ms = Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

export function parseDateRange(value: string): { start: number | null; due: number } | null {
  const v = value.trim();
  if (!v) return null;
  const explicit = v.split(/\s*(?:~|～|—|到|至)\s*/);
  if (explicit.length === 2) {
    const s = parseDueDateToMs(explicit[0]);
    const d = parseDueDateToMs(explicit[1]);
    if (s !== null && d !== null) return { start: s, due: d };
  }
  if (v.includes("-")) {
    const parts = v.split("-");
    for (let k = 1; k < parts.length; k++) {
      const s = parseDueDateToMs(parts.slice(0, k).join("-"));
      const d = parseDueDateToMs(parts.slice(k).join("-"));
      if (s !== null && d !== null) return { start: s, due: d };
    }
  }
  const single = parseDueDateToMs(v);
  return single !== null ? { start: null, due: single } : null;
}

export function parseTaskDraftSmart(rawTitle: string, optionsByField: Record<string, string[]>): TaskDraft {
  const tokens = rawTitle.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { title: rawTitle.trim(), type: "" };

  const typeOptions = new Set<string>([...TASK_TYPES, ...(optionsByField[FIELD_TYPE] || [])]);
  const moduleOptions = new Set<string>(optionsByField[FIELD_MODULE] || []);
  const draft: TaskDraft = { title: "", type: "", module: "", version: "", dueDate: undefined };
  const titleTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const labeled = tok.match(/^([^:：]+)[:：](.+)$/);
    if (labeled) {
      const label = labeled[1].trim();
      const value = labeled[2].trim();
      if (label === "类型" && !draft.type) { draft.type = value; continue; }
      if (label === "模块" && !draft.module) { draft.module = value; continue; }
      if (label === "版本" && !draft.version) { draft.version = value; continue; }
      if (DUE_DATE_LABELS.has(label.toLowerCase()) && draft.dueDate === undefined) {
        const range = parseDateRange(value);
        if (range) { draft.dueDate = range.due; if (range.start !== null) draft.startDate = range.start; continue; }
      }
    }
    if (DUE_DATE_LABELS.has(tok.toLowerCase()) && draft.dueDate === undefined && i + 1 < tokens.length) {
      const range = parseDateRange(tokens[i + 1]);
      if (range) { draft.dueDate = range.due; if (range.start !== null) draft.startDate = range.start; i++; continue; }
    }
    if (tok === "类型" && !draft.type && i + 1 < tokens.length) { draft.type = tokens[++i]; continue; }
    if (tok === "模块" && !draft.module && i + 1 < tokens.length) { draft.module = tokens[++i]; continue; }
    if (tok === "版本" && !draft.version && i + 1 < tokens.length) { draft.version = tokens[++i]; continue; }
    if (!draft.type && typeOptions.has(tok)) { draft.type = tok; continue; }
    if (!draft.module && moduleOptions.has(tok)) { draft.module = tok; continue; }
    if (!draft.version && isVersionToken(tok)) { draft.version = tok; continue; }
    titleTokens.push(tok);
  }

  draft.title = titleTokens.join(" ").trim() || rawTitle.trim();
  return draft;
}
