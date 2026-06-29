import type { Env } from "../types";
import { getTenantAccessToken } from "../lark/auth";
import { replyText } from "../lark/message";
import { getFieldIdNameMap } from "../bitable/fields";
import { getBitableFileTokenForDrive } from "../bitable/fields";
import { getBoundUser } from "../utils/notify";
import { getAdminOpenIds } from "../utils/notify";
import { kvGet, kvPut, kvDelete } from "../kv";
import { VALID_STATUSES, ROLE_ART_REVIEWER_KEY, ROLE_QA_KEY, LAST_BITABLE_EVENT_KEY, LAST_DRIVE_EVENT_KEY } from "../config";
import { handleShowTask } from "./tasks";

export async function handleHelp(env: Env, chatId: string): Promise<void> {
  await replyText(env, chatId, [
    "任务查询：",
    "创建任务<任务名>：新建任务，用空格带上 类型 / 模块 / 版本(v1.2) / 截止日期会自动归类",
    "  例：创建任务 上传头像 客户端 v1.2 ddl 6/20 @某人",
    "  截止日期支持：ddl 6/20、截止时间 2026/6/20；区间 ddl 6.20-7.20（前=开始 后=截止）",
    "批量创建任务：每行一个任务，同一行可写 类型 / 模块 / 版本 / ddl；可 @某人 设置人员",
    "修改<TaskID>ddl <日期>：改截止日期，如 修改158ddl 6.20；区间 修改158ddl 6.20-7.20",
    "修改<TaskID>版本/类型/模块 <值>：改对应字段，如 修改158版本 v1.3",
    "任务 / 我的任务 / 待办：查看我名下待推进任务",
    "@某人 任务：查看某人名下待推进任务",
    "待我验收 / 我的验收：查看需要我验收的任务",
    "<TaskID>：查看任务详情",
    "",
    "状态更新：",
    "<TaskID>完成：提交到下游验收",
    "<TaskID>通过 / <TaskID>验收通过：通过当前验收环节",
    "<TaskID>驳回 <原因> / <TaskID>打回 <原因>：打回给负责人重做（原因可选）",
    "",
    "角色绑定：",
    "绑定美术验收人 @某人：绑定美术验收环节负责人",
    "绑定QA @某人：绑定测试环节负责人",
    "",
    "运维：",
    "健康检查 / 自检：查看机器人各项依赖是否正常",
    "",
    `可用开发状态：${VALID_STATUSES.join(" / ")}`,
  ].join("\n"));
}

export async function handleHealthCheck(env: Env, chatId: string): Promise<void> {
  const lines: string[] = ["机器人健康自检："];
  let token = "";
  let hasError = false;

  try {
    token = await getTenantAccessToken(env);
    lines.push("✅ 飞书 token：正常");
  } catch (e: any) {
    hasError = true;
    lines.push(`❌ 飞书 token：${e?.message || e}`);
  }

  try {
    const probeKey = `health:probe:${Date.now()}`;
    await env.BOT_KV.put(probeKey, "1", { expirationTtl: 60 });
    const probeValue = await env.BOT_KV.get(probeKey);
    await env.BOT_KV.delete(probeKey);
    lines.push(probeValue === "1" ? "✅ KV 读写：正常" : "⚠️ KV 读写：写入后未立即读到");
  } catch (e: any) {
    hasError = true;
    lines.push(`❌ KV 读写：${e?.message || e}`);
  }

  if (token) {
    try {
      const fields = await getFieldIdNameMap(env, token);
      lines.push(`✅ 表格访问：正常（字段数 ${Object.keys(fields).length}）`);
    } catch (e: any) {
      hasError = true;
      lines.push(`❌ 表格访问：${e?.message || e}`);
    }
  }

  const artReviewer = await getBoundUser(env, ROLE_ART_REVIEWER_KEY);
  const qa = await getBoundUser(env, ROLE_QA_KEY);
  lines.push(`美术验收人绑定：${artReviewer ? artReviewer.name : "未绑定"}`);
  lines.push(`QA 绑定：${qa ? qa.name : "未绑定"}`);
  lines.push(`调试事件写入：${(env.DEBUG_EVENTS === "1" || env.DEBUG_EVENTS === "true") ? "开启" : "关闭"}`);
  lines.push(`告警管理员：${getAdminOpenIds(env).length} 人`);

  await replyText(env, chatId, lines.join("\n"));

  if (hasError) {
    const { alertAdminsOnce } = await import("../utils/notify");
    await alertAdminsOnce(env, "health_check_failed", `⚠️ 机器人健康自检发现异常：\n${lines.join("\n")}`);
  }
}

export async function handleSlashCommand(env: Env, chatId: string, text: string): Promise<void> {
  const parts = text.split(/\s+/);
  const command = parts[0];

  if (command === "/ping") { await replyText(env, chatId, "pong"); return; }
  if (command === "/help") { await handleHelp(env, chatId); return; }
  if (command === "/health") { await handleHealthCheck(env, chatId); return; }
  if (command === "/show") {
    const taskId = parts[1];
    if (!taskId) { await replyText(env, chatId, "格式错误：/show <TaskID>"); return; }
    await handleShowTask(env, chatId, taskId);
    return;
  }
  await replyText(env, chatId, `未知命令：${command}\n发送 /help 查看可用命令。`);
}

export async function handleLastBitableEventDebug(env: Env, chatId: string): Promise<void> {
  const raw = await kvGet(env, LAST_BITABLE_EVENT_KEY);
  await replyText(env, chatId, raw || "暂时没有记录到表格事件。");
}

export async function handleLastDriveEventDebug(env: Env, chatId: string): Promise<void> {
  const raw = await kvGet(env, LAST_DRIVE_EVENT_KEY);
  await replyText(env, chatId, raw || "暂时没有收到任何 Drive/Bitable 原始事件。");
}
