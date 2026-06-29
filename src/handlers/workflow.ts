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
  ACCEPTANCE_TASK_STATUSES, ROLE_ART_REVIEWER_KEY, ROLE_QA_KEY, ROLE_DISPLAY_NAMES,
  PENDING_ACCEPTOR_TTL_SECONDS, STAGE_ROLE, getNextStage, isAcceptanceStage,
} from "../config";

function pendingAcceptorKey(chatId: string, senderOpenId: string): string {
  return `pending_acceptor:${chatId}:${senderOpenId}`;
}

async function getPendingAcceptor(env: Env, key: string): Promise<PendingAcceptor | null> {
  const raw = await kvGet(env, key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Notify the right person when a task enters an acceptance stage.
// Role-based stages (美术验收, 转测试): use the bound role user + QA notice format for 转测试.
// Other stages: notify whoever is in the acceptor field using review notice.
async function notifyForStage(env: Env, stage: string, recordId: string, record: any): Promise<void> {
  const roleKey = STAGE_ROLE[stage];
  if (roleKey) {
    const roleUser = await getBoundUser(env, roleKey);
    if (!roleUser) return;
    const noticeKind = roleKey === ROLE_QA_KEY ? "qa" : "review";
    const noticeText = roleKey === ROLE_QA_KEY ? formatQaNotice(record) : formatReviewNotice(record);
    await notifyUsersOnce(env, noticeKind, recordId, [roleUser.openId], noticeText);
  } else {
    const acceptorIds = getPersonOpenIds(record.fields?.[FIELD_ACCEPTOR]);
    await notifyUsersOnce(env, "review", recordId, acceptorIds, formatReviewNotice(record));
  }
}

// Auto-assign the bound role user as acceptor when entering a role-based stage.
// Returns the role user if assigned, null otherwise.
export async function ensureStageAcceptor(
  env: Env, token: string, recordId: string, stage: string, currentAcceptorIds: string[],
): Promise<BoundUser | null> {
  const roleKey = STAGE_ROLE[stage];
  if (!roleKey) return null;
  const roleUser = await getBoundUser(env, roleKey);
  if (!roleUser) return null;
  if (!currentAcceptorIds.includes(roleUser.openId)) {
    await markRecentSelfAction(env, recordId, "set_acceptor");
    await updateTaskAcceptor(env, token, recordId, roleUser.openId);
  }
  return roleUser;
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

  const taskType = normalizeValue(record.fields?.[FIELD_TYPE]);
  const oldStatus = normalizeValue(record.fields?.[FIELD_STATUS]);

  if (!isAcceptanceStage(taskType, oldStatus)) {
    await replyText(env, chatId, "这个单子还没到验收状态。");
    return;
  }

  const nextStage = getNextStage(taskType, oldStatus);
  if (!nextStage) {
    await replyText(env, chatId, "已是最终状态，无法继续。");
    return;
  }

  // Check role binding before doing anything, so we don't leave the task in a broken state.
  const roleKey = STAGE_ROLE[nextStage];
  let roleUser: BoundUser | null = null;
  if (roleKey) {
    roleUser = await getBoundUser(env, roleKey);
    if (!roleUser) {
      const roleName = ROLE_DISPLAY_NAMES[roleKey] ?? roleKey;
      await replyText(env, chatId, `还没有绑定${roleName}，请先发送：绑定${roleName} @某人`);
      return;
    }
  }

  // Transition the task.
  await markRecentSelfAction(env, record.record_id, `status:${nextStage}`);
  if (roleUser) {
    await markRecentSelfAction(env, record.record_id, "set_acceptor");
    await updateTaskFields(env, token, record.record_id, {
      [FIELD_STATUS]: nextStage,
      [FIELD_ACCEPTOR]: [{ id: roleUser.openId }],
    });
  } else {
    await updateTaskStatus(env, token, record.record_id, nextStage);
  }

  if (nextStage !== "已完成") {
    const updated = await getTaskByRecordId(env, token, record.record_id);
    if (updated) await notifyForStage(env, nextStage, record.record_id, updated);
  }

  const suffix = roleUser ? `\n验收人：${roleUser.name}` : "";
  await replyText(env, chatId, `已更新：${taskId}\n开发状态：${oldStatus} → ${nextStage}${suffix}`);
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

  // Auto-assign role and notify if entering a role-based acceptance stage.
  if (STAGE_ROLE[status]) {
    const updated = await getTaskByRecordId(env, token, record.record_id);
    if (updated) {
      const acceptorIds = getPersonOpenIds(updated.fields?.[FIELD_ACCEPTOR]);
      const roleUser = await ensureStageAcceptor(env, token, record.record_id, status, acceptorIds);
      await notifyForStage(env, status, record.record_id, updated);
      if (!roleUser) {
        const roleName = ROLE_DISPLAY_NAMES[STAGE_ROLE[status]] ?? STAGE_ROLE[status];
        await replyText(env, chatId, `提醒：还没有绑定${roleName}，无法自动设置验收人。请先发送：绑定${roleName} @某人`);
      }
    }
  } else if (status === "下游验收") {
    const updated = await getTaskByRecordId(env, token, record.record_id);
    if (updated) await notifyUsersOnce(env, "review", record.record_id, getPersonOpenIds(updated.fields?.[FIELD_ACCEPTOR]), formatReviewNotice(updated));
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
