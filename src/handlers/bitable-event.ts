import type { Env, EventFieldValue } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { getFieldIdNameMap, getBitableFileTokenForDrive } from "../bitable/fields";
import { getTaskByRecordId, updateTaskAcceptor } from "../bitable/records";
import { normalizeValue, getPersonOpenIds, formatReviewNotice, formatQaNotice, formatTaskAssignedNotice, formatDueDateChangeNotice } from "../utils/format";
import { notifyUsers, notifyUsersOnce, getBoundUser } from "../utils/notify";
import { hasRecentSelfAction, markRecentSelfAction } from "../utils/dedupe";
import { kvPut } from "../kv";
import {
  FIELD_STATUS, FIELD_OWNER, FIELD_ACCEPTOR, FIELD_DUE_DATE,
  ACCEPTANCE_TASK_STATUSES, ROLE_QA_KEY, LAST_BITABLE_EVENT_KEY, LAST_DRIVE_EVENT_KEY,
} from "../config";

function isDebugEnabled(env: Env): boolean {
  return env.DEBUG_EVENTS === "1" || env.DEBUG_EVENTS === "true";
}

async function saveDebug(env: Env, key: string, data: any): Promise<void> {
  if (!isDebugEnabled(env)) return;
  await kvPut(env, key, JSON.stringify({ ...data, savedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 });
}

function parseEventFieldValue(value: string): any {
  if (value === undefined || value === null || value === "") return undefined;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeEventFieldValue(value: string): string {
  return normalizeValue(parseEventFieldValue(value));
}

function getEventValuesByFieldName(values: EventFieldValue[], idToName: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const v of values) {
    const name = idToName[v.field_id];
    if (name) result[name] = normalizeEventFieldValue(v.field_value);
  }
  return result;
}

function hasChangedField(action: any, idToName: Record<string, string>, fieldName: string): boolean {
  const before = getEventValuesByFieldName(action.before_value || [], idToName);
  const after = getEventValuesByFieldName(action.after_value || [], idToName);
  if (!(fieldName in before) && !(fieldName in after)) return false;
  return before[fieldName] !== after[fieldName];
}

function getEventFieldRaw(values: EventFieldValue[], idToName: Record<string, string>, fieldName: string): any {
  for (const v of values) {
    if (idToName[v.field_id] === fieldName) return parseEventFieldValue(v.field_value);
  }
  return undefined;
}

function hasPersonFieldChanged(action: any, idToName: Record<string, string>, fieldName: string): boolean {
  const beforeIds = new Set(getPersonOpenIds(getEventFieldRaw(action.before_value || [], idToName, fieldName)));
  const afterIds = new Set(getPersonOpenIds(getEventFieldRaw(action.after_value || [], idToName, fieldName)));
  if (beforeIds.size !== afterIds.size) return true;
  for (const id of afterIds) { if (!beforeIds.has(id)) return true; }
  return false;
}

function getBeforeFieldValue(action: any, idToName: Record<string, string>, fieldName: string): string {
  return getEventValuesByFieldName(action.before_value || [], idToName)[fieldName] || "";
}

async function ensureQaAcceptorOnEvent(env: Env, token: string, recordId: string, currentAcceptorIds: string[]): Promise<void> {
  const qa = await getBoundUser(env, ROLE_QA_KEY);
  if (!qa || currentAcceptorIds.includes(qa.openId)) return;
  await markRecentSelfAction(env, recordId, "set_acceptor");
  await updateTaskAcceptor(env, token, recordId, qa.openId);
}

export async function handleBitableRecordChanged(env: Env, body: any): Promise<void> {
  const event = body.event || {};
  const token = await getTenantAccessToken(env);
  const expectedFileToken = await getBitableFileTokenForDrive(env, token);

  await saveDebug(env, LAST_BITABLE_EVENT_KEY, {
    stage: "received",
    fileToken: event.file_token || "",
    expectedFileToken,
    tableId: event.table_id || "",
    expectedTableId: env.TASK_TABLE_ID,
    actionCount: Array.isArray(event.action_list) ? event.action_list.length : 0,
  });

  if (event.file_token && event.file_token !== expectedFileToken) return;
  if (event.table_id && event.table_id !== env.TASK_TABLE_ID) return;

  const actions = event.action_list || [];
  if (actions.length === 0) return;

  const idToName = await getFieldIdNameMap(env, token, expectedFileToken);
  const eventTrace: any[] = [];

  for (const action of actions) {
    if (action.action !== "record_added" && action.action !== "record_edited") continue;
    if (!action.record_id) continue;

    const statusChanged = hasChangedField(action, idToName, FIELD_STATUS);
    const ownerChanged = hasPersonFieldChanged(action, idToName, FIELD_OWNER);
    const acceptorChanged = hasPersonFieldChanged(action, idToName, FIELD_ACCEPTOR);
    const dueDateChanged = hasChangedField(action, idToName, FIELD_DUE_DATE);

    if (!statusChanged && !ownerChanged && !acceptorChanged && !dueDateChanged && action.action !== "record_added") continue;

    const record = await getTaskByRecordId(env, token, action.record_id, expectedFileToken);
    if (!record) continue;

    const f = record.fields || {};
    const currentStatus = normalizeValue(f[FIELD_STATUS]);
    const ownerOpenIds = getPersonOpenIds(f[FIELD_OWNER]);
    const acceptorOpenIds = getPersonOpenIds(f[FIELD_ACCEPTOR]);
    const fired: string[] = [];

    const skipSelfStatus = statusChanged && (await hasRecentSelfAction(env, action.record_id, `status:${currentStatus}`));
    const skipSelfAcceptor = acceptorChanged && (await hasRecentSelfAction(env, action.record_id, "set_acceptor"));

    if (statusChanged && !skipSelfStatus && (currentStatus === "下游验收" || currentStatus === "美术验收")) {
      await notifyUsersOnce(env, "review", action.record_id, acceptorOpenIds, formatReviewNotice(record));
      fired.push(`review(status→${currentStatus}) → ${acceptorOpenIds.join(",") || "(空)"}`);
    }

    if (acceptorChanged && !skipSelfAcceptor && ACCEPTANCE_TASK_STATUSES.includes(currentStatus)) {
      await notifyUsersOnce(env, "review", action.record_id, acceptorOpenIds, formatReviewNotice(record));
      fired.push(`review(acceptorChanged) → ${acceptorOpenIds.join(",") || "(空)"}`);
    }

    if (action.action === "record_added") {
      if (ownerOpenIds.length > 0) {
        await notifyUsers(env, ownerOpenIds, formatTaskAssignedNotice(record, true));
        fired.push(`assigned(new) → ${ownerOpenIds.join(",")}`);
      }
    } else if (ownerChanged && ownerOpenIds.length > 0) {
      await notifyUsers(env, ownerOpenIds, formatTaskAssignedNotice(record, false));
      fired.push(`assigned → ${ownerOpenIds.join(",")}`);
    } else if (dueDateChanged && ownerOpenIds.length > 0) {
      const beforeDue = getBeforeFieldValue(action, idToName, FIELD_DUE_DATE);
      await notifyUsers(env, ownerOpenIds, formatDueDateChangeNotice(record, beforeDue));
      fired.push(`dueDate → ${ownerOpenIds.join(",")}`);
    }

    const turnedToTesting = statusChanged && currentStatus === "转测试";
    const addedAsTesting = action.action === "record_added" && currentStatus === "转测试";
    if ((turnedToTesting && !skipSelfStatus) || addedAsTesting) {
      await ensureQaAcceptorOnEvent(env, token, action.record_id, acceptorOpenIds);
      const qa = await getBoundUser(env, ROLE_QA_KEY);
      if (qa) {
        await notifyUsersOnce(env, "qa", action.record_id, [qa.openId], formatQaNotice(record));
        fired.push(`qa → ${qa.openId}`);
      }
    }

    eventTrace.push({ recordId: action.record_id, action: action.action, currentStatus, fired });
  }

  await saveDebug(env, LAST_BITABLE_EVENT_KEY, { stage: "summary", actionCount: actions.length, trace: eventTrace });
}

export async function saveDriveEventDebug(env: Env, body: any): Promise<void> {
  if (!isDebugEnabled(env)) return;
  const event = body?.event || {};
  await kvPut(env, LAST_DRIVE_EVENT_KEY, JSON.stringify({
    savedAt: new Date().toISOString(),
    eventType: body?.header?.event_type || "",
    fileToken: event?.file_token || "",
    tableId: event?.table_id || "",
    actionCount: Array.isArray(event?.action_list) ? event.action_list.length : 0,
  }), { expirationTtl: 60 * 60 });
}
