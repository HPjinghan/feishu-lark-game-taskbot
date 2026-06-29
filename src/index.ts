import type { Env } from "./types";
import { getEventType, getEventId, getMessageId, getChatId, getSenderOpenId, getFirstUserMention, getUserMentions, extractText, removeBotMention, removeUserMentions, isPrivateChat, hasBotMention, hasAnyMention } from "./lark/events";
import { replyText } from "./lark/message";
import { shouldSkipDuplicateEventKeys, shouldSkipDuplicateCommand } from "./utils/dedupe";
import { alertAdminsOnce } from "./utils/notify";
import { handleSlashCommand, handleHelp, handleHealthCheck, handleLastBitableEventDebug, handleLastDriveEventDebug } from "./handlers/commands";
import { handleShowTask, handleMyTasks, handleAcceptanceTasks, handleCreateTask, handleBatchCreateTasks } from "./handlers/tasks";
import { handleDoneTask, handleAcceptancePass, handleAcceptanceReject, handleUpdateTaskStatus, handleModifyTask, handleBindRole, handlePendingAcceptorReply } from "./handlers/workflow";
import { handleBitableRecordChanged, saveDriveEventDebug } from "./handlers/bitable-event";
import { subscribeBitableEvents, getBitableFileTokenForDrive } from "./bitable/fields";
import { getTenantAccessToken } from "./lark/auth";
import { getFieldIdNameMap } from "./bitable/fields";
import {
  isHelpQuery, isMyTaskQuery, isAcceptanceTaskQuery,
  parseCreateTaskCommand, parseBatchCreateTaskCommand, parseModifyCommand,
  parseBindRoleCommand, parseDoneCommand, parseAcceptanceRejectCommand,
  parseAcceptancePassCommand, parseSimpleStatusCommand, parseSimpleShowCommand,
} from "./utils/parse";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Always return 200 — if we 5xx, Lark will keep retrying the same event.
    try {
      if (request.method !== "POST") return new Response("OK");

      const body: any = await request.json();

      if (body.type === "url_verification") {
        return Response.json({ challenge: body.challenge });
      }

      const eventType = getEventType(body);

      if (await shouldSkipDuplicateEventKeys(env, [getEventId(body), getMessageId(body.event || {})])) {
        return new Response("OK");
      }

      if (eventType.startsWith("drive.")) {
        await saveDriveEventDebug(env, body);
      }

      if (eventType === "drive.file.bitable_record_changed_v1") {
        try {
          await handleBitableRecordChanged(env, body);
        } catch (error: any) {
          console.error("Bitable event error:", error?.message || error);
          await alertAdminsOnce(env, "bitable_event_error", `⚠️ 表格事件处理出错：\n${error?.message || error}`);
        }
        return new Response("OK");
      }

      const event = body.event;
      const chatId = getChatId(event);
      const senderOpenId = getSenderOpenId(event);
      const userMention = getFirstUserMention(event);
      const userMentions = getUserMentions(event);
      let text = extractText(event);
      const rawText = text;

      const shouldHandle =
        isPrivateChat(event) ||
        hasBotMention(event) ||
        (hasAnyMention(event) && (rawText.includes("拉群") || rawText.includes("调试提及")));

      text = removeBotMention(text, event);

      if (!chatId || !text || !shouldHandle) return new Response("OK");

      // --- Slash commands ---
      if (text.startsWith("/")) {
        await handleSlashCommand(env, chatId, text);
        return new Response("OK");
      }

      // --- Natural language commands ---
      if (isHelpQuery(text)) {
        await handleHelp(env, chatId);
      } else if (text === "订阅表格事件") {
        try {
          const data = await subscribeBitableEvents(env);
          await replyText(env, chatId, `已订阅当前多维表格的云文档事件。\n${JSON.stringify(data)}`);
        } catch (e: any) {
          await replyText(env, chatId, `订阅表格事件失败：${e?.message || e}`);
        }
      } else if (text === "健康检查" || text === "自检") {
        await handleHealthCheck(env, chatId);
      } else if (text === "最近表格事件") {
        await handleLastBitableEventDebug(env, chatId);
      } else if (text === "最近原始事件") {
        await handleLastDriveEventDebug(env, chatId);
      } else if (text === "检查表格访问") {
        try {
          const token = await getTenantAccessToken(env);
          const fields = await getFieldIdNameMap(env, token);
          await replyText(env, chatId, `表格访问正常，字段数：${Object.keys(fields).length}`);
        } catch (e: any) {
          await replyText(env, chatId, `表格访问失败：${e?.message || e}`);
        }
      } else if (text === "检查表格配置") {
        try {
          const token = await getTenantAccessToken(env);
          const driveToken = await getBitableFileTokenForDrive(env, token);
          await replyText(env, chatId, [`BITABLE_APP_TOKEN：${env.BITABLE_APP_TOKEN}`, `Drive订阅Token：${driveToken}`, `TASK_TABLE_ID：${env.TASK_TABLE_ID}`].join("\n"));
        } catch (e: any) {
          await replyText(env, chatId, `检查失败：${e?.message || e}`);
        }
      } else if (text.trim().toLowerCase().includes("dismiss!")) {
        if (isPrivateChat(event)) {
          await replyText(env, chatId, "dismiss! 只能在群聊里使用。");
        } else {
          await replyText(env, chatId, "收到，正在解散当前群。");
          const { deleteGroupChat } = await import("./lark/group");
          await deleteGroupChat(env, chatId);
        }
      } else if (text.trim().includes("调试提及")) {
        await replyText(env, chatId, JSON.stringify({ text, rawMentions: event?.message?.mentions || [], parsedMentions: userMentions }));
      } else if (text.trim().includes("拉群")) {
        try {
          if (userMentions.length === 0) {
            await replyText(env, chatId, "没有识别到要拉进群的人，请在"拉群"后面 @ 用户。");
          } else {
            const { createGroupChat } = await import("./lark/group");
            const openIds = [...new Set([senderOpenId, ...userMentions.map((u) => u.openId)].filter(Boolean))];
            const names = userMentions.map((u) => u.name).join("、");
            const groupName = names ? `任务协作-${names}` : "任务协作群";
            const newChatId = await createGroupChat(env, groupName, openIds);
            await replyText(env, chatId, `已创建群：${groupName}${newChatId ? `\nchat_id：${newChatId}` : ""}`);
          }
        } catch (e: any) {
          await replyText(env, chatId, `拉群失败：${e?.message || e}`);
        }
      } else if (await handlePendingAcceptorReply(env, chatId, senderOpenId, userMention)) {
        // handled
      } else if (parseCreateTaskCommand(removeUserMentions(text, event))) {
        const cmd = parseCreateTaskCommand(removeUserMentions(text, event))!;
        await handleCreateTask(env, chatId, cmd.title, userMention);
      } else if (parseBatchCreateTaskCommand(removeUserMentions(text, event))) {
        const cmd = parseBatchCreateTaskCommand(removeUserMentions(text, event))!;
        if (await shouldSkipDuplicateCommand(env, "batch_create", { chatId, ownerOpenId: userMention?.openId || "", tasks: cmd.titles })) {
          return new Response("OK");
        }
        ctx.waitUntil(handleBatchCreateTasks(env, chatId, cmd.titles, userMention));
        return new Response("OK");
      } else if (isAcceptanceTaskQuery(text)) {
        await handleAcceptanceTasks(env, chatId, senderOpenId);
      } else if (isMyTaskQuery(text)) {
        await handleMyTasks(env, chatId, userMention?.openId || senderOpenId, userMention?.name || "你");
      } else {
        const modifyCmd = parseModifyCommand(text);
        const bindRoleCmd = parseBindRoleCommand(text);
        const doneCmd = parseDoneCommand(text);
        const rejectCmd = parseAcceptanceRejectCommand(text);
        const passCmd = parseAcceptancePassCommand(text);
        const statusCmd = parseSimpleStatusCommand(text);
        const showTaskId = parseSimpleShowCommand(text);

        if (modifyCmd) {
          await handleModifyTask(env, chatId, modifyCmd.taskId, modifyCmd.field, modifyCmd.value);
        } else if (bindRoleCmd) {
          await handleBindRole(env, chatId, bindRoleCmd.roleName, userMention);
        } else if (doneCmd) {
          await handleDoneTask(env, chatId, senderOpenId, doneCmd.taskId);
        } else if (rejectCmd) {
          await handleAcceptanceReject(env, chatId, rejectCmd.taskId, rejectCmd.reason);
        } else if (passCmd) {
          await handleAcceptancePass(env, chatId, passCmd.taskId);
        } else if (statusCmd) {
          await handleUpdateTaskStatus(env, chatId, statusCmd.taskId, statusCmd.status);
        } else if (showTaskId) {
          await handleShowTask(env, chatId, showTaskId);
        }
      }

      return new Response("OK");
    } catch (error: any) {
      console.error("Worker error:", error?.message || error);
      try {
        await alertAdminsOnce(env, "worker_error", `⚠️ 机器人处理事件出错：\n${error?.message || error}`);
      } catch {}
      return new Response("OK");
    }
  },
};
