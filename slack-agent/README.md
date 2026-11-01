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

## 与文档示例的差异

- LLM：文档用 OpenAI；本仓库按文档「使用其他 LLM 提供商」章节改用 Workers AI（Free ✓）
- 基类：文档指向官方 GitHub 完整实现；本仓库自行实现并注释了每个环节
- 模型：`glm-4.7-flash`（Free 可用）；付费后可换 `kimi-k2.6` / `glm-5.3` 等
