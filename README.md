# 飞书游戏团队任务机器人

> 飞书群聊 + 多维表格，面向游戏团队的轻量任务工作流机器人。  
> A lightweight task workflow bot for game teams, built on Feishu (Lark) IM + Bitable.

运行在 **Cloudflare Workers**，零服务器运维，免费额度够小团队日常使用。

---

## 功能

| 场景 | 指令示例 |
|------|---------|
| 查看我的任务 | `任务` / `我的待办` |
| 查看他人任务 | `@某人 任务` |
| 查看待验收 | `待我验收` |
| 创建任务 | `创建任务 上传头像 客户端 v1.2 ddl 6/20 @某人` |
| 批量创建 | `批量创建任务` 后每行一个任务 |
| 完成任务 | `158完成` |
| 验收通过 | `158通过` |
| 验收驳回 | `158驳回 颜色不对` |
| 修改截止日期 | `修改158ddl 7.20` |
| 修改版本 | `修改158版本 v2.0` |
| 拉协作群 | `拉群 @某人` |
| 健康自检 | `健康检查` |

**自动通知：**
- 任务分配 → 私聊通知负责人
- 截止日期变更 → 私聊通知负责人  
- 进入验收环节 → 私聊通知验收人
- 转测试 → 自动设置 QA 为验收人并通知

**验收流程（客户端任务）：**
```
下游验收 → 美术验收（通知美术验收人）→ 转测试（通知 QA）→ 已完成
```
**其他类型任务：**
```
下游验收 → 已完成
```

---

## 一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HPjinghan/feishu-lark-game-taskbot)

---

## 手动部署

### 1. 前置条件

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：`npm install -g wrangler`
- Cloudflare 账号（免费即可）
- 飞书开放平台应用（需要机器人权限）

### 2. 克隆 & 安装

```bash
git clone https://github.com/HPjinghan/feishu-lark-game-taskbot.git
cd feishu-lark-game-taskbot
npm install
```

### 3. 创建 KV 命名空间

```bash
wrangler kv namespace create BOT_KV
```

把输出的 `id` 填到 `wrangler.jsonc` 的 `kv_namespaces[0].id`。

### 4. 配置密钥（Secrets）

```bash
wrangler secret put LARK_APP_ID        # 飞书应用 App ID
wrangler secret put LARK_APP_SECRET    # 飞书应用 App Secret
wrangler secret put BITABLE_APP_TOKEN  # 多维表格 App Token（URL 里的那段）
wrangler secret put TASK_TABLE_ID      # 任务表的 Table ID
```

> 如果多维表格在知识库（Wiki）里，还需要：
> ```bash
> wrangler secret put BITABLE_WIKI_TOKEN  # Wiki 节点 Token
> ```

### 5. 配置多维表格字段

打开 `src/config.ts`，确认字段名常量与你的多维表格列名一致：

```ts
export const FIELD_TASK_ID = "TaskID";   // 任务 ID 列
export const FIELD_TITLE   = "任务";      // 任务名称列
export const FIELD_STATUS  = "开发状态"; // 状态列
// ... 其余字段
```

### 6. 部署

```bash
npm run deploy
```

部署完成后，Wrangler 会输出类似 `https://feishu-game-taskbot.YOUR_SUBDOMAIN.workers.dev` 的 URL。

### 7. 配置飞书机器人

1. 打开[飞书开放平台](https://open.feishu.cn/)，进入你的应用
2. **事件与回调** → 请求 URL 填写上面的 Workers URL
3. **订阅事件** → 添加 `im.message.receive_v1`（消息事件）
4. **权限管理** → 开通：
   - `im:message`（发送消息）
   - `im:chat`（群管理，拉群用）
   - `bitable:app`（多维表格读写）
   - `drive:drive`（订阅表格变更事件）
5. 发布应用

### 8. 订阅表格事件

机器人部署后，在飞书里对机器人发送：

```
订阅表格事件
```

成功后，多维表格的记录变更（新增/编辑）会自动触发通知。

### 9. 绑定角色

```
绑定美术验收人 @主美
绑定QA @测试同学
```

---

## 自定义状态流程

修改 `src/handlers/workflow.ts` 中的 `handleAcceptancePass` 函数，可以调整验收链路逻辑。  
修改 `src/config.ts` 中的 `VALID_STATUSES` 可以增减状态选项。

---

## 项目结构

```
src/
  index.ts              # Worker 入口，消息路由
  config.ts             # 字段名、状态、关键词等配置
  types.ts              # TypeScript 接口定义
  kv.ts                 # KV 安全封装
  lark/
    auth.ts             # 获取 tenant_access_token
    message.ts          # 发送消息（群聊/私聊）
    group.ts            # 创建/解散群聊
    events.ts           # 飞书事件解析工具函数
  bitable/
    records.ts          # 多维表格记录增删查改
    fields.ts           # 字段 ID/名称映射缓存
  utils/
    parse.ts            # 指令解析、日期解析
    format.ts           # 消息格式化
    notify.ts           # 通知发送 & 去重
    dedupe.ts           # 事件/指令去重
  handlers/
    commands.ts         # 斜杠命令 & 运维指令
    tasks.ts            # 任务查询与创建
    workflow.ts         # 验收流程、状态更新
    bitable-event.ts    # 多维表格变更事件处理
```

---

## License

MIT
