import type { Env, BoundUser, PendingAcceptor } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { replyText } from "../lark/message";
import { searchTaskByTaskId, getTaskByRecordId, updateTaskStatus, updateTaskFields, updateTaskAcceptor } from "../bitable/records";
import { normalizeValue, getPersonOpenIds, formatReviewNotice, formatQaNotice, formatRejectNotice, formatDateOnly } from "../utils/format";
import { parseDateRange } from "../utils/parse";
import { notifyUsers, notifyUsersOnce, getBoundUser, setBoundUser } from "../utils/notify";
import { markRecentSelfAction } from "../utils/dedupe";
import { kvGet, kvPut, kvDelete } from "../kv";
import {
  FIELD_STATUS, FIELD_ACCEPTOR, FIELD_OWNER, FIELD_DUE_DATE, FIELD_START_DATE, FIELD_TYPE,
  ACCEPTANCE_TASK_STATUSES, ROLE_ART_REVIEWER_KEY, ROLE_QA_KEY, PENDING_ACCEPTOR_TTL_SECONDS,
} from "../config";

function pendingAcceptorKey(chatId: string, senderOpenId: string): string {
  return `pending_acceptor:${chatId}:${senderOpenId}`;
}

async function getPendingAcceptor(env: Env, key: string): Promise<PendingAcceptor | null> {
  const raw = await kvGet(env, key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// When a task enters "转测试", ensure the QA role user is set as acceptor.
async function ensureQaAcceptor(env: Env, token: string, recordId: string, currentAcceptorIds: string[]): Promise<BoundUser | null> {
  const qa = await getBoundUser(env, ROLE_QA_KEY);
  if (!qa) return null;
  if (!currentAcceptorIds.includes(qa.openId)) {
    await markRecentSelfAction(env, recordId, "set_acceptor");
    await updateTaskAcceptor(env, token, recordId, qa.openId);
  }
  return qa;
}

export async function handleDoneTask(env: Env, chatId: string, senderOpenId: string, taskId: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }

  const oldStatus = normalizeValue(record.fields?.[FIELD_STATUS]);
  if (oldStatus === "下游验收") { await replyText(env, chatId, `任务 ${taskId} 当前已经是 下游验收。`); return; }

  await markRecentSelfAction(env, record.record_id, "status:下游验收");
  await updateTaskStatus(env, token, record.record_id, "下游验收");
  const updated = await getTaskByRecordId(env, token, record.record_id);

  const isEmptyPerson = (v: any) => !v || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim());
  if (isEmptyPerson(record.fields?.[FIELD_ACCEPTOR])) {
    await kvPut(env, pendingAcceptorKey(chatId, senderOpenId), JSON.stringify({ taskId, recordId: record.record_id }), { expirationTtl: PENDING_ACCEPTOR_TTL_SECONDS });
    await replyText(env, chatId, `已更新：${taskId}\n开发状态：${oldStatus} → 下游验收\n这个任务还没有验收人，请问谁来验收？`);
    return;
  }
  if (updated) await notifyUsersOnce(env, "review", record.record_id, getPersonOpenIds(updated.fields?.[FIELD_ACCEPTOR]), formatReviewNotice(updated));
  await replyText(env, chatId, `已更新：${taskId}\n开发状态：${oldStatus} → 下游验收`);
}

export async function handleAcceptancePass(env: Env, chatId: string, taskId: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }

  const type = normalizeValue(record.fields?.[FIELD_TYPE]);
  const oldStatus = normalizeValue(record.fields?.[FIELD_STATUS]);

  if (oldStatus === "下游验收") {
    if (type === "客户端") {
      const artReviewer = await getBoundUser(env, ROLE_ART_REVIEWER_KEY);
      if (!artReviewer) { await replyText(env, chatId, "还没有绑定美术验收人，请先发送：绑定美术验收人 @某人"); return; }
      await markRecentSelfAction(env, record.record_id, "status:美术验收");
      await markRecentSelfAction(env, record.record_id, "set_acceptor");
      await updateTaskFields(env, token, record.record_id, { [FIELD_STATUS]: "美术验收", [FIELD_ACCEPTOR]: [{ id: artReviewer.openId }] });
      const updated = await getTaskByRecordId(env, token, record.record_id);
      if (updated) await notifyUsersOnce(env, "review", record.record_id, [artReviewer.openId], formatReviewNotice(updated));
      await replyText(env, chatId, `已更新：${taskId}\n开发状态：下游验收 → 美术验收\n验收人：${artReviewer.name}`);
      return;
    }
    await markRecentSelfAction(env, record.record_id, "status:已完成");
    await updateTaskStatus(env, token, record.record_id, "已完成");
    await replyText(env, chatId, `已更新：${taskId}\n开发状态：下游验收 → 已完成`);
    return;
  }

  if (oldStatus === "美术验收") {
    const qa = await getBoundUser(env, ROLE_QA_KEY);
    if (!qa) { await replyText(env, chatId, "还没有绑定 QA，请先发送：绑定QA @某人"); return; }
    await markRecentSelfAction(env, record.record_id, "status:转测试");
    await markRecentSelfAction(env, record.record_id, "set_acceptor");
    await updateTaskFields(env, token, record.record_id, { [FIELD_STATUS]: "转测试", [FIELD_ACCEPTOR]: [{ id: qa.openId }] });
    const updated = await getTaskByRecordId(env, token, record.record_id);
    if (updated) await notifyUsersOnce(env, "qa", record.record_id, [qa.openId], formatQaNotice(updated));
    await replyText(env, chatId, `已更新：${taskId}\n开发状态：美术验收 → 转测试\n验收人：${qa.name}`);
    return;
  }

  if (oldStatus === "转测试") {
    await markRecentSelfAction(env, record.record_id, "status:已完成");
    await updateTaskStatus(env, token, record.record_id, "已完成");
    await replyText(env, chatId, `已更新：${taskId}\n开发状态：转测试 → 已完成`);
    return;
  }

  await replyText(env, chatId, "这个单子还没到验收状态");
}

export async function handleAcceptanceReject(env: Env, chatId: string, taskId: string, reason: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }

  const oldStatus = normalizeValue(record.fields?.[FIELD_STATUS]);
  if (!ACCEPTANCE_TASK_STATUSES.includes(oldStatus)) {
    await replyText(env, chatId, `任务 ${taskId} 当前不在验收环节（当前：${oldStatus}），无法驳回。`);
    return;
  }

  await markRecentSelfAction(env, record.record_id, "status:重新打开");
  await updateTaskStatus(env, token, record.record_id, "重新打开");
  const updated = await getTaskByRecordId(env, token, record.record_id);
  if (updated) await notifyUsers(env, getPersonOpenIds(updated.fields?.[FIELD_OWNER]), formatRejectNotice(updated, reason, oldStatus));

  await replyText(env, chatId, [`已驳回：${taskId}`, `开发状态：${oldStatus} → 重新打开`, `驳回原因：${reason || "（未填写）"}`, "已通知负责人重做。"].join("\n"));
}

export async function handleUpdateTaskStatus(env: Env, chatId: string, taskId: string, status: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }

  const oldStatus = normalizeValue(record.fields?.[FIELD_STATUS]);
  if (oldStatus === status) { await replyText(env, chatId, `任务 ${taskId} 当前已经是 ${status}。`); return; }

  await markRecentSelfAction(env, record.record_id, `status:${status}`);
  await updateTaskStatus(env, token, record.record_id, status);

  const updated = await getTaskByRecordId(env, token, record.record_id);
  if (updated && status === "下游验收") await notifyUsersOnce(env, "review", record.record_id, getPersonOpenIds(updated.fields?.[FIELD_ACCEPTOR]), formatReviewNotice(updated));
  if (updated && status === "转测试") {
    const acceptorIds = getPersonOpenIds(updated.fields?.[FIELD_ACCEPTOR]);
    const qa = await ensureQaAcceptor(env, token, record.record_id, acceptorIds);
    await notifyUsersOnce(env, "qa", record.record_id, qa ? [qa.openId] : [], formatQaNotice(updated));
    if (!qa) await replyText(env, chatId, "提醒：还没有绑定 QA，无法自动设置转测试验收人。请先发送：绑定QA @某人");
  }

  await replyText(env, chatId, `已更新：${taskId}\n开发状态：${oldStatus} → ${status}`);
}

export async function handleModifyTask(env: Env, chatId: string, taskId: string, field: string, value: string): Promise<void> {
  const token = await getTenantAccessToken(env);
  const record = await searchTaskByTaskId(env, token, taskId);
  if (!record) { await replyText(env, chatId, `未找到任务：${taskId}`); return; }

  if (field === FIELD_DUE_DATE) {
    const range = parseDateRange(value);
    if (!range) { await replyText(env, chatId, `无法识别日期：${value}（可用 6/20、6.20、2026/6/20，或区间 6.20-7.20）`); return; }
    const updates: Record<string, any> = { [FIELD_DUE_DATE]: range.due };
    if (range.start !== null) updates[FIELD_START_DATE] = range.start;
    const oldDue = record.fields?.[FIELD_DUE_DATE];
    const oldText = typeof oldDue === "number" ? formatDateOnly(oldDue) : "（空）";
    await updateTaskFields(env, token, record.record_id, updates);
    if (range.start !== null) {
      await replyText(env, chatId, `已更新：${taskId}\n开始时间：${formatDateOnly(range.start)}\n截止时间：${formatDateOnly(range.due)}`);
    } else {
      await replyText(env, chatId, `已更新：${taskId}\n截止时间：${oldText} → ${formatDateOnly(range.due)}`);
    }
    return;
  }

  const fieldLabel = field === "版本" ? "版本" : field === "类型" ? "类型" : "模块";
  const oldText = normalizeValue(record.fields?.[field]);
  await updateTaskFields(env, token, record.record_id, { [field]: value });
  await replyText(env, chatId, `已更新：${taskId}\n${fieldLabel}：${oldText} → ${value}`);
}

export async function handleBindRole(env: Env, chatId: string, roleName: string, userMention: BoundUser | null): Promise<void> {
  const keyMap: Record<string, string> = { "美术验收人": ROLE_ART_REVIEWER_KEY, "QA": ROLE_QA_KEY };
  const key = keyMap[roleName];
  if (!key) return;
  if (!userMention) { await replyText(env, chatId, `请用 @ 指定要绑定为 ${roleName} 的人。`); return; }
  await setBoundUser(env, key, userMention);
  await replyText(env, chatId, `已绑定${roleName}：${userMention.name}`);
}

export async function handlePendingAcceptorReply(env: Env, chatId: string, senderOpenId: string, userMention: BoundUser | null): Promise<boolean> {
  if (!senderOpenId || !userMention) return false;
  const key = pendingAcceptorKey(chatId, senderOpenId);
  const pending = await getPendingAcceptor(env, key);
  if (!pending) return false;
  const token = await getTenantAccessToken(env);
  await markRecentSelfAction(env, pending.recordId, "set_acceptor");
  await updateTaskAcceptor(env, token, pending.recordId, userMention.openId);
  const updated = await getTaskByRecordId(env, token, pending.recordId);
  await kvDelete(env, key);
  if (updated) await notifyUsers(env, [userMention.openId], formatReviewNotice(updated));
  await replyText(env, chatId, `已设置 ${pending.taskId} 的验收人：${userMention.name}`);
  return true;
}

export { ensureQaAcceptor };
