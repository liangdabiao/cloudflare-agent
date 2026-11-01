# Cloudflare Agents 入门实战

基于 [Cloudflare Agents 官方文档](./在%20Cloudflare%20上构建%20Agents.md)（收录于本仓库）实现的 **五个可运行的 Agent 案例合集**，覆盖官方文档全部示例类型，用于学习和快速上手 Cloudflare Agents SDK。

> **实测状态**：均已部署到 Cloudflare 全球网络并端到端验证，
> 部署目标为 **Workers Free（免费）计划**，全程无需任何 LLM API key（使用 Workers AI）。

参考文档：https://cloudflaredoc.ubitools.com/agents/

## 五个项目一览

| 项目 | 能力 | 线上地址 | 实测状态 |
|---|---|---|---|
| [chat-agent](./chat-agent) | 流式聊天 + 服务端/客户端/人工审批 三种 tool + SQLite 消息持久化 | https://chat-agent.348349.xyz | ✅ 三种 tool 全部端到端通过 |
| [voice-agent](./voice-agent) | 实时语音对话：STT（自动断句）→ LLM（含工具）→ TTS 逐句合成 | https://voice-agent.348349.xyz | ✅ 文本与语音管线打通 |
| [email-agent](./email-agent) | 邮件收发：出站签名路由、入站解析、自动回复、防死循环、安全回复验签 | https://email-agent.348349.xyz | ✅ 出站实发成功；入站需域名收信（已配 catch-all） |
| [browser-agent](./browser-agent) | 真实浏览器自动化：打开网页 / 读正文 / 页内 JS 求值 | https://browser-agent.348349.xyz | ✅ 单次任务 5 次真实浏览器调用全通过 |
| [slack-agent](./slack-agent) | 多租户 Slack bot：私信 + @提及线程回复 + OAuth + 验签 | https://slack-agent.348349.xyz | ✅ 完整链路实测通过（DM → 验签 → 路由 → Workers AI → 回复） |

每个子目录都有独立的 `README.md`，包含该案例的架构说明、核心概念速查表与常见问题。

## 你将学到什么

| 概念 | 在哪个项目体现 |
|---|---|
| Agents SDK / Durable Object：每个 Agent 一个有状态实例 | 五个项目全部 |
| SQLite 持久化（消息 / 对话 / 收件记录） | chat（消息）、voice（对话）、email（收件）、slack（凭据） |
| Agent 控制循环（streamText + tool + stopWhen） | chat、voice、browser、slack |
| 三种 tool：服务端自动执行 / 客户端浏览器作答 / 人工审批 | chat |
| `withVoice` mixin：STT、分句、TTS、打断检测、延迟指标 | voice |
| 真实浏览器自动化：Browser Rendering 绑定 + Puppeteer 工具编排 | browser |
| 邮件路由 resolver：地址路由 / 安全回复验签 / 兜底 | email |
| Slack 集成：OAuth 2.0、HMAC-SHA256 验签、team_id 多租户路由 | slack |
| `routeAgentRequest` / `routeAgentEmail`：请求 → Agent 实例 | chat、voice、browser / email |
| Workers AI 绑定（免 API key 的模型调用）+ Free 计划模型选型 | 五个项目全部 |
| 多项目部署 + 自定义域名绑定（workers.dev 被墙的解法） | 五个项目全部 |
| wrangler vars 与 secret 的冲突、接口合并补类型 | slack |

## 目录结构

```
cloudflare-agent/
├── 在 Cloudflare 上构建 Agents.md   # 官方文档存档（本项目的实现依据）
├── chat-agent/                      # 案例 1：聊天 Agent（文档「聊天 Agent 示例」）
├── voice-agent/                     # 案例 2：语音 Agent（文档「Voice Agent 示例」）
├── email-agent/                     # 案例 3：邮件 Agent（文档「Email Agent 示例」）
├── browser-agent/                   # 案例 4：浏览器 Agent（文档「Browser Agent 示例」）
├── slack-agent/                     # 案例 5：Slack Agent（文档「Slack Agent 示例」）
├── agents-starter-main/             # 官方入门模板（文档快速入门引用，作对照参考）
├── agentic-inbox-main/              # 官方邮件 Agent 完整示例（文档 Email 章节引用，进阶参考）
└── README.md                        # 本文件
```

## 快速开始

前置要求：Node.js 18+、Cloudflare 账号（**Free 免费计划即可**）。

```bash
# 0. 登录 Cloudflare（Workers AI 免 API key，但需要账号身份）
npx wrangler login

# 1. 聊天 Agent（最简单，从这里开始）
cd chat-agent && npm install && npx wrangler types && npm run dev
#    打开 http://localhost:5173，依次试试：
#    "What is the weather in Tokyo?"   → 服务端 tool
#    "What timezone am I in?"          → 客户端 tool（浏览器作答）
#    "What is 5000 times 3?"           → 人工审批 UI（大数字触发）

# 2. 语音 Agent
cd voice-agent && npm install && npx wrangler types && npm run dev
#    打开 http://localhost:5173，点 Start Call 说话；
#    无麦克风可用页面下方文本框（Text → LLM → TTS 同样全通）

# 3. 邮件 Agent（需要一个托管在 Cloudflare 的域名）
cd email-agent && npm install && npx wrangler types && npm run dev
#    curl "http://localhost:8787/test-send?to=you@example.com"   # 出站
#    入站见 email-agent/README.md（部署 + catch-all 路由）

# 4. 浏览器 Agent（Browser Rendering Free 有每日时长限制）
cd browser-agent && npm install && npx wrangler types && npm run dev
#    "Open https://example.com and tell me the exact h1 heading text."

# 5. Slack Agent（需先创建 Slack App，步骤见 slack-agent/README.md）
cd slack-agent && npm install && npx wrangler types && npm run dev
```

## 部署

```bash
# chat / voice / browser（含前端构建）
npm run deploy        # = vite build + wrangler deploy

# email / slack（纯 Worker）
npx wrangler deploy

# slack 还需注入凭据（见 slack-agent/README.md）：
npx wrangler secret put SLACK_CLIENT_ID
npx wrangler secret put SLACK_CLIENT_SECRET
npx wrangler secret put SLACK_SIGNING_SECRET
```

**自定义域名（强烈建议）**：`workers.dev` 在部分地区网络不可达。
API 一条命令绑定（也可在仪表板操作）：

```bash
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"zone_id":"<zone_id>","hostname":"chat-agent.你的域名","service":"chat-agent","environment":"production"}' \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/domains"
```

## Free 计划实测踩坑记录（最有价值的部分）

以下是本合集在 **Free 计划实测**中真实遇到的问题与结论，文档里不会告诉你：

1. **`workers-ai-provider` 有流式重复 bug（已废弃）**
   文档示例用的 `workers-ai-provider` v4.0.1 会把每个流式 delta 发射两次
   （输出变成 `TheThe moon moon...`）。已用最小 Worker 隔离定位，确认是 provider 层问题。
   解决：改用官方推荐的 `agents/models/ai-sdk` 的 `createAI({ binding })`，接口几乎一致。

2. **模型付费墙**
   文档示例的 `kimi-k2.6`、`glm-5.3-flash` 均标记 `require_workers_paid=true`，
   Free 计划调用直接报错（ voice 场景表现为 "No response generated"）。
   Free 可用的对话模型：`@cf/zai-org/glm-4.7-flash`、`@cf/meta/llama-4-scout-17b-16e-instruct`、
   `@cf/meta/llama-3.3-70b-instruct-fp8-fast`。清单查询：`GET /accounts/{id}/ai/models/search`。

3. **全新 Agent 实例的 `this.state` 是 `undefined`**
   与类型标注不符，首次访问会抛错。务必 `this.state?.xxx ?? 默认值`（见 email-agent）。

4. **Agent 路由路径是 kebab-case**
   绑定名 `ChatAgent` → URL `/agents/chat-agent/default`（客户端 `useAgent` 会自动转换，
   但手动 curl 测试时容易踩坑；大小写不对会得到 400 "Invalid request"）。

5. **`send_email` 只能发给已验证的收件地址**
   需先在 Email Routing → Destination addresses 添加并完成验证；
   验证状态同步到生效有约 2 分钟延迟。

6. **入站邮件无法在本地测试**
   Email Service 只能把真实入站邮件路由到**已部署**的 Worker，收信测试必须在部署后进行。

7. **本地开发必须登录 Cloudflare**
   Workers AI（含语音 STT/TTS）与 `send_email` 绑定在本地 dev 时连接远程服务，
   `npx wrangler login` 是硬前提。

8. **推理模型的 reasoning 不会进语音**
   `glm-4.7-flash` 是推理模型，思维链走独立的 `reasoning` 字段，TTS 只会读 `content`，
   但推理耗时会增加首响应延迟——语音场景建议优先选非推理的 fast 模型。

9. **Code Mode 浏览器沙箱需要付费计划**
   文档主推的 `createBrowserTools` + `worker_loaders`（Dynamic Workers）部署时报
   错误 10195 要求升级付费。Free 计划改走文档「直接使用 Puppeteer」章节：
   `@cloudflare/puppeteer` + `browser` 绑定，把固定操作封装成 tool 给 LLM 编排。

10. **Browser Rendering Free 额度很紧**
    每天共 10 分钟浏览器时长、每 20 秒只允许启动 1 个新浏览器、3 并发。
    连续工具调用会撞 429——browser-agent 里做了 `withBrowserRetry`（等一个窗口重试），
    并把 `networkidle` 等待换成 `domcontentloaded` 省时间。

11. **llama-4-scout 多步工具循环会把工具调用写进正文**
    表现为回复里出现 `[browser_eval(url=...)]` 这样的文本，结构化 tool call 丢失，
    流程中断。换 `glm-4.7-flash` 后多步工具调用稳定。模型选型对 Agent 至关重要。

12. **wrangler.jsonc 的 vars 会覆盖同名 secret（错误码 10053）**
    在 config 里声明 `vars` 再 `wrangler secret put` 同名会报
    "Binding name already in use"，且 `deploy` 会用占位值悄悄顶掉真 secret
    （表现为 Slack 验签恒失败）。解法：凭据一律走 secret，类型用接口合并补齐
    （见 slack-agent/src/env-extra.d.ts）。

13. **新建 Slack App 的三个隐藏开关**
    ① 新版创建向导的 "Create and Install" 会卡在安装状态轮询——改走
    **App Manifest** 页直接编辑 JSON，scopes/events/request_url/redirect_urls 一次搞定；
    ② **Socket Mode 默认开启**，开着时 Slack 不投递 HTTP 事件，Request URL 永远验证不了，
    必须先去 Socket Mode 页关掉；
    ③ **App Home 的 Messages Tab 默认禁止用户发消息**，需在 App Home 设置勾选允许。
    排查技巧：验证失败时先本地模拟签名请求（HMAC v0 + challenge），
    分清是端点问题还是 Slack 配置问题。

14. **配置 Redirect URL 也会遇到同样的表单保存问题**
    OAuth & Permissions 页的 "Add New Redirect URL" 输入框程序化填写后
    Save 按钮不启用——同样走 App Manifest 的 `oauth_config.redirect_urls` 解决。
    经验：Slack 新版设置页的 React 表单对程序化输入不敏感，
    凡是能走 App Manifest 的配置优先走 Manifest。

15. **客户端 tool 的自动续跑会绕过 `stopWhen`，形成死循环**
    `stepCountIs(N)` 只限制单次请求内的步数；而客户端工具（无 execute）返回结果后
    客户端会**自动发起全新请求，步数归零**。若模型（如 llama-4-scout）对某些输入
    反复调用客户端工具，就是"工具→新请求→再调工具"的无限循环。
    双重解法（见 chat-agent）：① 选工具调用稳定的模型（glm-4.7-flash）；
    ② 客户端 `onToolCall` 里做续跑计数护栏（如每条用户消息最多 3 轮）。

## 官方参考（收录在仓库内）

| 目录 | 说明 |
|---|---|
| [agents-starter-main](./agents-starter-main) | Cloudflare 官方 Agents 入门模板（`npm create cloudflare@latest --template cloudflare/agents-starter` 的产物），含流式聊天、服务端/客户端工具、审批、任务调度的完整接线方式 |
| [agentic-inbox-main](./agentic-inbox-main) | Cloudflare 官方「Agentic Inbox」完整示例：自托管 AI 邮件客户端（Email Routing + Durable Object + R2 附件 + AI 回复草稿），是 email-agent 的进阶版 |

> 两者版权归 Cloudflare 官方所有，收录仅作学习对照。

## License

仅供学习使用。各子项目代码基于 Cloudflare 官方文档示例实现并补充了实测修正。

致谢： https://linux.do 佬友支持