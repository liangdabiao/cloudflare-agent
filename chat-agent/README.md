# Cloudflare 聊天 Agent 入门实战

基于 [Cloudflare Agents 官方文档「聊天 Agent 示例」](https://developers.cloudflare.com/agents/) 实现的入门实战项目。
由 **Workers AI** 驱动，**无需任何 API key**，包含文档中的全部核心能力：

- ✅ 流式 AI 响应（streaming）
- ✅ **服务端 tool** —— 在服务器自动执行（`getWeather`）
- ✅ **客户端 tool** —— 无 `execute`，由浏览器提供结果回传 LLM（`getUserTimezone`）
- ✅ **人工审批 tool（human-in-the-loop）** —— 敏感操作先弹审批 UI（`calculate`，大数字时触发）
- ✅ SQLite 消息持久化 —— 对话在重启 / 刷新后仍保留
- ✅ 可恢复流式传输 —— 客户端断线后可从中断处继续

## 项目结构

```
chat-agent/
├── index.html              # 前端入口（@cloudflare/vite-plugin 会从这里找 client 入口）
├── vite.config.ts          # Vite 配置：插件自动把 index.html → client、wrangler main → Worker
├── wrangler.jsonc          # Cloudflare Workers 配置（AI 绑定 / Durable Object / SQLite 迁移）
├── tsconfig.json
├── package.json
└── src/
    ├── server.ts           # ★ Agent 服务端：AIChatAgent + 三种 tool 类型
    ├── client.tsx          # ★ React 客户端：useAgent / useAgentChat / 审批 UI
    └── styles.css          # 界面样式（暗色主题）
```

## 快速开始

前置要求：Node.js 18+、Cloudflare 账号（Free 计划即可）。

```bash
# 1. 安装依赖
npm install

# 2. 登录 Cloudflare（Workers AI 免 API key，但需要账号身份，只需登录一次）
npx wrangler login

# 3. 生成环境类型定义（wrangler.jsonc 变更后需要重新执行）
npx wrangler types

# 4. 启动开发服务器
npm run dev
```

打开终端输出的地址（默认 http://localhost:5173），依次试试这三个 prompt，分别体验三种 tool：

| Prompt | 触发 | 行为 |
|---|---|---|
| `What is the weather in Tokyo?` | 服务端 tool `getWeather` | 在 Worker 内自动执行，结果回传 LLM 继续回答 |
| `What timezone am I in?` | 客户端 tool `getUserTimezone` | 请求发给浏览器，浏览器返回时区后对话自动继续 |
| `What is 5000 times 3?` | 审批 tool `calculate` | 数字绝对值 > 1000 时暂停，弹出 Approve / Reject 审批 UI |

## 部署到 Cloudflare

```bash
npm run deploy
# 等价于：npm run build && npx wrangler deploy
```

部署后得到 `https://chat-agent.<你的子域>.workers.dev`。
消息持久化在 Durable Object 的 SQLite 中，空闲时 Agent 会休眠（hibernate）以节省资源。

## 线上实测记录（Free 计划）

本项目已部署并完成端到端验证（线上地址见仓库总 README）：

| 验证项 | 方法 | 结果 |
|---|---|---|
| 服务端 tool（getWeather） | 浏览器发送 "What is the weather in Tokyo?" | ✅ 工具卡片展示结果，回答引用天气数据 |
| 客户端 tool（getUserTimezone） | 发送 "What timezone am I in?" | ✅ 浏览器返回 Asia/Shanghai，LLM 续答 |
| 人工审批（calculate） | 发送 "What is 5000 times 3?" | ✅ 弹出参数卡片 + Approve/Reject，批准后返回 15000 |
| SQLite 持久化 | 刷新页面 / Clear history | ✅ 刷新后历史仍在 |
| 流式输出 | 观察回复渲染 | ✅ 逐词流式（换 provider 后无重复） |

**调试技巧**（本项目实测时用过）：

- 手动测试 Agent 路由时 URL 是 kebab-case：`/agents/chat-agent/default`（不是 `ChatAgent`），
  大小写错误会得到 400 "Invalid request"
- 普通 GET 打到 Agent 端点返回 400 是**正常的**（该端点只接受 WebSocket 升级）
- 排查流式问题可以最小化复现：写一个只含 `streamText + textStream` 的临时 Worker，
  逐层排除 provider / 框架 / 模型的问题（本项目靠这招定位了 provider 重复 bug）

## 核心概念速查（学习重点）

### 服务端 `src/server.ts`

| 概念 | 说明 |
|---|---|
| `AIChatAgent` | Agents SDK 基类，运行在 Durable Object 内，自带 SQLite 消息持久化、WebSocket 实时连接与可恢复流式传输 |
| `onChatMessage()` | 每条用户消息触发一次，返回 `toUIMessageStreamResponse()` 流式响应 |
| `createAI({ binding })` | 用 `ai` 绑定创建 provider，无需 API key |
| `streamText` + `stopWhen: stepCountIs(5)` | Agent 循环最多 5 步，防止无限调工具 |
| `pruneMessages` | 裁剪旧消息中的 tool 结果，控制上下文长度 |
| 三种 tool 的区别 | 有 `execute` 无 `needsApproval` → 服务端自动跑；无 `execute` → 发给浏览器；有 `needsApproval` → 等用户批准 |

### 客户端 `src/client.tsx`

| 概念 | 说明 |
|---|---|
| `useAgent({ agent: "ChatAgent" })` | 通过 WebSocket 连接 Durable Object（路径会转成 kebab-case：`/agents/chat-agent/default`） |
| `useAgentChat` | 管理消息、流式渲染、tool 生命周期与断线恢复 |
| `onToolCall` | 处理客户端 tool：LLM 调用无 `execute` 的 tool 时在这里提供结果，返回后自动继续 |
| `addToolApprovalResponse` | 用户点击 Approve / Reject 后把决定回传服务端 |
| `part.state === "approval-requested"` | 审批 UI 的渲染时机（配合 `getToolApproval`） |

### 配置 `wrangler.jsonc`

```jsonc
"ai": { "binding": "AI" }                      // Workers AI 绑定
"durable_objects": { ... }                     // 注册 ChatAgent 类
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]  // SQLite 存储
```

## 常见问题

**启动报 `CLOUDFLARE_API_TOKEN ...` / `Not logged in`**
Workers AI 绑定在本地开发时会连远程服务，先执行 `npx wrangler login` 完成浏览器登录。

**修改了 `wrangler.jsonc` 之后类型报错**
重新执行 `npx wrangler types`。

**想换模型 / 换提供商**
- Workers AI 其他模型：改 `ai("@cf/...")` 的模型名
- OpenAI / Anthropic / Gemini 等：换成对应的 AI SDK provider 包即可，`streamText` 其余部分不变

> **provider 选型说明**：文档示例使用的 `workers-ai-provider`（v4.0.1）已被官方废弃，
> 且实测存在**流式 delta 重复发射的 bug**（每个 token 输出两次）。本仓库改用官方推荐的
> `import { createAI } from "agents/models/ai-sdk"`，接口几乎一致（`createAI({ binding })`）。
>
> **Free 计划模型可用性**：`kimi-k2.6` / `glm-5.3-flash` 等标记 `require_workers_paid`
> 的模型需要付费计划；Free 可用的对话模型如 `@cf/zai-org/glm-4.7-flash`、
> `@cf/meta/llama-4-scout-17b-16e-instruct`（本项目默认）、`@cf/meta/llama-3.3-70b-instruct-fp8-fast`。
> 可用清单查询：仪表板 Workers AI → Models，或 `GET /accounts/{id}/ai/models/search`。

## 下一步扩展方向

- 接入 [Browser Rendering](https://developers.cloudflare.com/browser-rendering/)，让 Agent 能浏览网页、截图
- 用 `this.schedule()` / cron triggers 给 Agent 添加定时任务
- 接 MCP server 扩展工具生态
- 把 `getWeather` 换成真实 API，体验工具的真实 I/O
