// Local dev-only simulator: runs the REAL Worker handler (src/index.ts)
// against fake Feishu/Bitable network responses, so you can try out bot
// behavior in a browser without any real Lark app, Bitable table, or
// deployment. An LLM key is optional — set LLM_API_KEY in your shell env
// before running this to test the real 排期 flow end to end; leave it unset
// to see how the bot behaves with zero LLM configured.
//
// Run: npm run sim

import { mockFetch, beginCapture, getCaptured } from "./mock-fetch";
(globalThis as any).fetch = mockFetch;

import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MockKVNamespace } from "./mock-kv";
import { resetBitable } from "./mock-bitable";
import { reset as resetRegistry } from "./registry";
import { buildFakeMessageEvent } from "./build-event";
import worker from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kv = new MockKVNamespace();

function buildEnv() {
  return {
    LARK_APP_ID: "sim-app-id",
    LARK_APP_SECRET: "sim-app-secret",
    LARK_API_BASE: "https://sim.local",
    BITABLE_APP_TOKEN: "sim-app-token",
    TASK_TABLE_ID: "sim-table",
    BOT_KV: kv as any,
    DEBUG_EVENTS: "0",
    ADMIN_OPEN_IDS: "",
    LLM_PROVIDER: process.env.LLM_PROVIDER || "anthropic",
    LLM_API_KEY: process.env.LLM_API_KEY || "",
    LLM_BASE_URL: process.env.LLM_BASE_URL || "",
    LLM_MODEL: process.env.LLM_MODEL || "",
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  // Accumulate as Buffers and decode ONCE at the end — decoding each chunk
  // individually (e.g. via implicit `raw += chunk`) can corrupt multi-byte
  // UTF-8 characters (Chinese text) if a character happens to be split
  // across a chunk boundary.
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(path.join(__dirname, "index.html"), "utf-8"));
    return;
  }

  if (req.method === "POST" && req.url === "/send") {
    const raw = await readBody(req);
    const { text, senderName } = JSON.parse(raw || "{}");

    beginCapture();
    const pendingWork: Promise<any>[] = [];
    const fakeCtx = {
      waitUntil: (p: Promise<any>) => {
        pendingWork.push(p);
      },
      passThroughOnException: () => {},
    };

    const event = buildFakeMessageEvent(text, senderName || "我");
    const fakeRequest = new Request("https://sim.local/webhook", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "Content-Type": "application/json" },
    });

    try {
      await worker.fetch(fakeRequest, buildEnv() as any, fakeCtx as any);
      // Commands like batch-create and 排期 defer real work via ctx.waitUntil()
      // so the webhook can ack immediately — wait for that work here so the
      // simulator's response includes everything the bot actually said.
      await Promise.allSettled(pendingWork);
    } catch (error: any) {
      console.error("[sim] handler threw:", error);
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ messages: getCaptured() }));
    return;
  }

  if (req.method === "POST" && req.url === "/reset") {
    kv.reset();
    resetBitable();
    resetRegistry();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

const PORT = Number(process.env.PORT || 4173);
server.listen(PORT, () => {
  const llmStatus = process.env.LLM_API_KEY ? "已配置（会真的调用 LLM）" : "未配置（排期功能会提示需要先配置）";
  console.log(`\n🤖 本地模拟器已启动：http://localhost:${PORT}`);
  console.log(`   LLM_API_KEY: ${llmStatus}\n`);
});
