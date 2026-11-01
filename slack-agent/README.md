# Cloudflare Slack Agent 入门实战

基于 [Cloudflare Agents 官方文档「Slack Agent 示例」](https://developers.cloudflare.com/agents/) 实现的多租户 Slack bot：

- ✅ 响应私信（DM）
- ✅ 响应频道 @提及，并在线程中回复（携带线程上下文）
- ✅ 多租户：每个 Slack workspace 一个独立 Durable Object 实例（team_id 做实例名）
- ✅ OAuth 2.0 安装流程（/install → Slack 授权 → /accept 换 token 存入 DO）
- ✅ HMAC-SHA256 请求验签（v0 方案 + 5 分钟防重放）
- ✅ LLM 用 Workers AI（Free 计划可用），**无需 OpenAI API key**

## 项目结构

```
slack-agent/
├── wrangler.jsonc           # AI 绑定 / MyAgent DO / 凭据 vars（生产用 secret 覆盖）
└── src/
    ├── slack.ts             # ★ SlackAgent 基类：OAuth、验签、事件路由、Slack API 封装
    └── index.ts             # ★ MyAgent 实现：onSlackEvent + generateAIReply（Workers AI）
```

> 文档中的 `SlackAgent` 基类托管在官方 GitHub，未随 SDK 发布——本仓库按文档描述的
> 职责（OAuth / 验签 / 路由 / API 封装）自行实现，每一部分都有注释。

## 你需要准备（一次性）

1. 在 [api.slack.com/apps](https://api.slack.com/apps) 创建 App（From scratch）
2. **OAuth & Permissions → Bot Token Scopes** 添加：
   `chat:write`、`chat:write.public`、`channels:history`、`app_mentions:read`、`im:write`、`im:history`
3. **Basic Information** 里记下 `Client ID`、`Client Secret`、`Signing Secret`
4. 部署后在 **Event Subscriptions** 里把 Request URL 指到 `https://<你的域名>/slack`，
   订阅 `app_mention` 与 `message.im` 两个 bot 事件

## 运行

```bash
npm install
npx wrangler types
npx tsc

# 本地开发：复制 .dev.vars.example 为 .dev.vars 并填入三个凭据
npm run dev

# 部署 + 配置生产凭据
npx wrangler deploy
npx wrangler secret put SLACK_CLIENT_ID
npx wrangler secret put SLACK_CLIENT_SECRET
npx wrangler secret put SLACK_SIGNING_SECRET
```

安装到 workspace：浏览器访问 `https://<部署地址>/install` → Allow → 显示
"Successfully registered!" 后即可在 Slack 里私信或 @机器人。

## 线上实测记录（Free 计划）

本项目已部署并完成端到端验证（线上地址见仓库总 README）：

| 验证项 | 方法 | 结果 |
|---|---|---|
| `/slack` 验签 | 本地模拟签名 challenge 请求（HMAC v0） | ✅ 正确回显 challenge；无签名请求正确 401 |
| Request URL 验证 | Slack App Manifest 保存触发 | ✅ "Request URL Verified" |
| OAuth 流程 | `/install` → Allow → `/accept` | ✅ "Successfully registered!"，bot token 存入 DO |
| 事件投递 + AI 回复 | Slack 里 DM 机器人 | ✅ "你好，请用一句话自我介绍" → Workers AI 中文回复 |

完整链路：`Slack DM → POST /slack（HMAC 验签）→ team_id 路由到 DO
→ fetchConversation 拉上下文 → Workers AI 生成 → chat.postMessage 回复`。

**bot token 存在哪？** OAuth `/accept` 换取后写入该 workspace 专属 Durable Object 实例的
state（SQLite），多工作区互不可见。重新安装（再次走 /install）会覆盖更新。

## 实际配置全流程（含踩坑，自动化完成）

本项目配置 Slack App 时踩过的坑，按时间顺序：

1. **新版创建向导 "Create and Install" 会卡死**——按钮一直 disabled，
   页面每秒轮询 `check_app_install_status` 但永不通过。
   解法：向导里跳过 scopes/events 直接 "Create"（空 App 可创建），
   然后走 **App Manifest** 页编辑 JSON 一次配齐：
   `oauth_config.scopes.bot`、`settings.event_subscriptions`（request_url + bot_events）、
   `oauth_config.redirect_urls`。
2. **Socket Mode 默认开启**——开着时 Slack 不投递 HTTP 事件，Request URL 永远
   验证不了。去 Socket Mode 页把 "Enable Socket Mode" 关掉。
3. **App Home 的 Messages Tab 默认禁止用户发消息**（"向此应用发送消息的功能已关闭"）
   ——去 App Home 设置勾选 "Allow users to send Slash commands and messages"。
4. **Request URL 验证失败时先自测**：用 Signing Secret 在本地算 HMAC v0 签名，
   curl 一个签名过的 challenge 请求到自己的端点——能回显 challenge 就说明端点没问题，
   问题在 Slack 配置（本项目靠这招发现了坑 5）。
5. **wrangler.jsonc 的 vars 会顶掉同名 secret**（错误 10053；deploy 也会用占位值
   覆盖 secret）——凭据一律 `wrangler secret put`，类型用接口合并补齐
   （见 `src/env-extra.d.ts`）。
6. **OAuth 需要 Redirect URL**：`oauth_config.redirect_urls` 加上
   `https://<部署地址>/accept`，否则 `/install` 跳转授权后回不来。

## 核心概念速查（学习重点）

## 核心概念速查（学习重点）

### `src/slack.ts`（基类）

| 概念 | 说明 |
|---|---|
| OAuth 流程 | `/install` 重定向授权页；`/accept` 用 code 调 `oauth.v2.access` 换 bot token |
| 多租户路由 | `event_callback.team_id` → `idFromName(team_id)` → 该 workspace 专属 DO 实例 |
| 验签 | `v0:{timestamp}:{body}` 的 HMAC-SHA256 与 `X-Slack-Signature` 比对；时间窗 5 分钟防重放 |
| `ensureAppUserId()` | `auth.test` 拿 bot 自己的 user id，用于识别/忽略自己的消息（防自问自答死循环） |
| `fetchConversation()` | `conversations.history` 拉频道/线程最近 20 条，时间正序交给 LLM |
| `sendMessage()` | `chat.postMessage`，支持 `thread_ts` 线程回复 |
| URL 验证握手 | Slack 配置事件订阅时发的 `url_verification` 要原样返回 `challenge` |

### `src/index.ts`（Agent 实现）

| 概念 | 说明 |
|---|---|
| `onSlackEvent()` | 文档定义的事件入口：私信走 `message`，@提及走 `app_mention`（线程回复） |
| `normalizeForLLM()` | 自己的消息 → `assistant`，用户的 → `user`；`<@UXXX>` 替换掉 |
| `generateAIReply()` | `streamText` 流式收集为完整文本（Slack 是整条发送，不是流式） |
| 事件幂等 | Slack 会重试投递，同一 `event_id` 只处理一次 |

## 自动化配置（可选阅读）

本项目的 Slack App 全套配置（创建 App、加 Scopes、关 Socket Mode、
验证 Request URL、加 Redirect URL、读取凭据、点 Allow 授权、发送测试 DM）
是由 AI 通过 [BrowserSkill](https://github.com/Tencent/BrowserSkill) 驱动
**真实登录的 Chrome** 自动完成的——包括绕过向导卡死、修复 secret 覆盖问题。
配置 Slack App 时遇到同类问题，可直接参照上面的踩坑顺序操作。

## 与文档示例的差异

- LLM：文档用 OpenAI；本仓库按文档「使用其他 LLM 提供商」章节改用 Workers AI（Free ✓）
- 基类：文档指向官方 GitHub 完整实现；本仓库自行实现并注释了每个环节
- 模型：`glm-4.7-flash`（Free 可用）；付费后可换 `kimi-k2.6` / `glm-5.3` 等
