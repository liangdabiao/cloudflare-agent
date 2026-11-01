# Cloudflare Email Agent 入门实战

基于 [Cloudflare Agents 官方文档「Email Agent 示例」](https://developers.cloudflare.com/agents/) 实现的邮件 Agent，
通过 Cloudflare Email Service 收发邮件：

- ✅ 出站发送（`sendEmail`，带 HMAC-SHA256 签名的 Agent 路由头）
- ✅ 入站接收（`onEmail` + postal-mime 解析）
- ✅ 自动回复（`replyToEmail`，仅在 `onEmail` 内可用）
- ✅ 自动回复检测（`isAutoReplyEmail`，RFC 3834，防邮件死循环）
- ✅ 安全回复路由（`createSecureReplyEmailResolver` 验签，防伪造头）
- ✅ 地址路由（`createAddressBasedEmailResolver`：收件地址 → Agent 实例）
- ✅ 收件记录持久化（Agent state / SQLite）

## 项目结构

```
email-agent/
├── wrangler.jsonc          # send_email 绑定 / Durable Object / EMAIL_SECRET
└── src/
    └── server.ts           # ★ 全部逻辑：发信、收信、回复、路由、测试端点
```

## 前置条件（本仓库域名已配置完成）

1. 域名托管在 Cloudflare（示例用 `348349.xyz`，在 `wrangler.jsonc` 的 `AGENT_DOMAIN` 修改）
2. 仪表板 Compute & AI → Email Service → Onboard Domain（自动加 MX + SPF + DKIM 记录）
3. 配置 Email 路由：把入站邮件投递到本 Worker（部署后设置 catch-all → worker）

## 快速开始

```bash
npm install
npx wrangler login
npx wrangler types

# 本地开发（send_email remote=true：本地也能发真实邮件）
npm run dev
```

### 测试端点（dev server 运行在 http://localhost:8787）

```bash
# 发一封欢迎邮件（出站验证）
curl "http://localhost:8787/test-send?to=you@example.com"

# 查看已收到的邮件记录
curl http://localhost:8787/emails
```

### 入站验证（需要先部署）

```bash
npx wrangler deploy
# 然后把域名 Email 路由的 catch-all 指向 email-agent Worker
# 再从你的真实邮箱发一封信到 support@348349.xyz
```

Agent 会：解析邮件 → 检测是否自动回复 → 记录到 state → 自动回信。
你回信时，`createSecureReplyEmailResolver` 会验签并把邮件路由回同一个 Agent 实例。

## 核心概念速查（学习重点）

| 概念 | 说明 |
|---|---|
| `send_email` 绑定 | 出站邮件通道；`remote: true` 让 wrangler dev 也能真实发信 |
| `this.sendEmail({...})` | 出站发送；自动注入 `X-Agent-Name`/`X-Agent-ID` 头；传 `secret` 则 HMAC 签名 |
| `onEmail(email)` | 入站回调；`email.getRaw()` 拿原始邮件，postal-mime 解析主题/正文/附件 |
| `this.replyToEmail(email, {...})` | 回复入站邮件；**只能在 `onEmail` 内用**（需活跃邮件对象）；延迟回复用 `sendEmail` + `inReplyTo` |
| `isAutoReplyEmail(headers)` | 检查 RFC 3834 头（Auto-Submitted / X-Auto-Response-Suppress / Precedence），避免机器人互回死循环 |
| `routeAgentEmail` + resolver | 入站入口：resolver 决定路由到哪个 Agent 实例；`onNoRoute` 可拒收 |
| `createAddressBasedEmailResolver("EmailAgent")` | 按收件地址路由：`support@` → 实例 `support`；子地址 `Agent+id@` → 实例 `id` |
| `createSecureReplyEmailResolver(secret)` | 验签回复路由：签名过期/伪造时回调 `onInvalidSignature` |
| `@callable()` | 把方法暴露为可远程调用的 RPC（客户端或测试端点可调） |
| Agent state | `this.state` / `this.setState()`：JSON 状态存 SQLite，重启不丢 |

## 生产部署清单

```bash
# EMAIL_SECRET 换成强随机值（不要用 wrangler.jsonc 里的开发占位值）
npx wrangler secret put EMAIL_SECRET
npx wrangler deploy
```

## 常见错误码（sendEmail / replyToEmail）

| 错误码 | 含义 | 处理 |
|---|---|---|
| `E_SENDER_NOT_VERIFIED` | 发件域名未验证 | 在仪表板完成域名接入 |
| `E_RATE_LIMIT_EXCEEDED` | 触发发送限频 | 指数退避重试 |
| `E_DAILY_LIMIT_EXCEEDED` | 超每日配额 | 等配额重置或升级 |
| `E_CONTENT_TOO_LARGE` | 邮件过大 | 减少附件/内容 |
| `E_TOO_MANY_RECIPIENTS` | 收件人 > 50 | 拆分发送 |

## 下一步

- 接入 LLM：在 `onEmail` 里用 Workers AI 根据正文生成智能回复
- 加 `@callable` 命令接口：发邮件让 Agent 执行操作（如查天气回邮件）
- 多地址路由：`support@` / `sales@` / `billing@` 各自独立实例
