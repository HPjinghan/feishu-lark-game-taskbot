import * as bitable from "./mock-bitable";

// All Lark/Bitable calls in the bot's code go to `${env.LARK_API_BASE}/open-apis/...`.
// The simulator points LARK_API_BASE at this fake host so every such call can
// be intercepted here; anything else (e.g. a real LLM API call) passes through
// to the real network untouched.
const FAKE_BASE = "https://sim.local";

let capturedMessages: { chatId: string; text: string }[] = [];

export function beginCapture(): void {
  capturedMessages = [];
}

export function getCaptured(): { chatId: string; text: string }[] {
  return capturedMessages;
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const FIELD_DEFS: { field_id: string; field_name: string; options?: string[] }[] = [
  { field_id: "fldTaskId", field_name: "TaskID" },
  { field_id: "fldTitle", field_name: "任务" },
  { field_id: "fldModule", field_name: "模块", options: ["登录", "月卡", "养成", "优化", "社交"] },
  { field_id: "fldType", field_name: "类型", options: ["python/llm", "客户端", "服务器", "美术资源", "策划/运营", "UI", "文案", "市场"] },
  { field_id: "fldStatus", field_name: "开发状态", options: ["未开始", "进行中", "下游验收", "美术验收", "已完成", "转测试", "已停滞", "重新打开"] },
  { field_id: "fldOwner", field_name: "人员" },
  { field_id: "fldAcceptor", field_name: "验收人" },
  { field_id: "fldStart", field_name: "开始时间" },
  { field_id: "fldDue", field_name: "截止时间" },
  { field_id: "fldVersion", field_name: "版本" },
  { field_id: "fldDesc", field_name: "任务描述/策划案" },
];

export async function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (!url.startsWith(FAKE_BASE)) {
    // Not aimed at our fake Feishu host (e.g. a real LLM API call) — pass through.
    return fetch(input as any, init as any);
  }

  const method = (init?.method || "GET").toUpperCase();
  const bodyText = typeof init?.body === "string" ? init.body : "";
  const body = bodyText ? JSON.parse(bodyText) : {};
  const path = url.slice(FAKE_BASE.length).split("?")[0];

  if (path === "/open-apis/auth/v3/tenant_access_token/internal") {
    return jsonResponse({ code: 0, tenant_access_token: "sim-token" });
  }

  if (path === "/open-apis/im/v1/messages") {
    const content = JSON.parse(body.content || "{}");
    capturedMessages.push({ chatId: body.receive_id, text: content.text || "" });
    return jsonResponse({ code: 0, data: { message_id: `sim-sent-${Date.now()}` } });
  }

  if (path === "/open-apis/im/v1/chats" && method === "POST") {
    return jsonResponse({ code: 0, data: { chat_id: `sim_group_${Date.now()}` } });
  }
  if (/^\/open-apis\/im\/v1\/chats\/.+$/.test(path) && method === "DELETE") {
    return jsonResponse({ code: 0 });
  }

  if (/^\/open-apis\/bitable\/v1\/apps\/.+\/tables\/.+\/fields$/.test(path)) {
    return jsonResponse({
      code: 0,
      data: {
        has_more: false,
        items: FIELD_DEFS.map((f) => ({
          field_id: f.field_id,
          field_name: f.field_name,
          property: f.options ? { options: f.options.map((name) => ({ name })) } : undefined,
        })),
      },
    });
  }

  if (/^\/open-apis\/bitable\/v1\/apps\/.+\/tables\/.+\/records\/search$/.test(path) && method === "POST") {
    const conditions = body?.filter?.conditions || [];
    const matched = bitable.searchRecords((r) => conditions.every((c: any) => bitable.matchesCondition(r, c)));
    return jsonResponse({ code: 0, data: { has_more: false, items: matched.map(bitable.toApiRecord) } });
  }

  if (/^\/open-apis\/bitable\/v1\/apps\/.+\/tables\/.+\/records$/.test(path) && method === "POST") {
    const record = bitable.createRecord(body.fields || {});
    return jsonResponse({ code: 0, data: { record: bitable.toApiRecord(record) } });
  }

  const recordMatch = path.match(/^\/open-apis\/bitable\/v1\/apps\/.+\/tables\/.+\/records\/([^/]+)$/);
  if (recordMatch) {
    const recordId = recordMatch[1];
    if (method === "GET") {
      const record = bitable.getRecord(recordId);
      return record ? jsonResponse({ code: 0, data: { record: bitable.toApiRecord(record) } }) : jsonResponse({ code: 1254043, msg: "record not found" }, 404);
    }
    if (method === "PUT") {
      const record = bitable.updateRecord(recordId, body.fields || {});
      return record ? jsonResponse({ code: 0, data: { record: bitable.toApiRecord(record) } }) : jsonResponse({ code: 1254043, msg: "record not found" }, 404);
    }
  }

  if (/^\/open-apis\/drive\/v1\/files\/.+\/subscribe$/.test(path)) {
    return jsonResponse({ code: 0, data: {} });
  }

  if (path === "/open-apis/wiki/v2/spaces/get_node") {
    return jsonResponse({ code: 0, data: { node: { obj_type: "bitable", obj_token: "sim-app-token" } } });
  }

  console.warn("[sim] unhandled mock endpoint:", method, path);
  return jsonResponse({ code: 99999, msg: `sim: unhandled endpoint ${method} ${path}` }, 501);
}
