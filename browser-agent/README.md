# Cloudflare Browser Agent 入门实战

基于 [Cloudflare Agents 官方文档「Browser Agent 示例」](https://developers.cloudflare.com/agents/) 实现的浏览器 Agent，
能打开真实网页、读取正文、在页面里执行 JS 查询——由 LLM 编排工具完成任务。

- ✅ `browser_open`：打开页面，返回标题 / meta 描述 / 状态码
- ✅ `browser_content`：读取页面可见正文（截断 4000 字符防上下文爆炸）
- ✅ `browser_eval`：页面内执行自定义 JS 表达式（接近 Code Mode 的灵活性）
- ✅ 429 节流自动重试（`withBrowserRetry`，等一个启动窗口再试）
- ✅ SQLite 消息持久化 + 流式输出（复用 AIChatAgent）

## ⚠️ 方案选型：为什么不是文档主推的 Code Mode

文档主推 **Code Mode**（`createBrowserTools` + `worker_loaders`）：LLM 亲手写 CDP 代码。
但 `worker_loaders`（Dynamic Workers）**需要 Workers 付费计划**，Free 部署直接报错：

```
In order to use Dynamic Workers, you must switch to a paid plan. [code: 10195]
```

因此本项目走文档「直接使用 Puppeteer」章节：`@cloudflare/puppeteer` + `browser` 绑定，
把固定操作封装成 tool 交给 LLM 编排——能力相同（浏览/检查/求值），
区别是 LLM 选择工具而非亲手写协议代码。

**付费后升级 Code Mode**：`npm i @cloudflare/codemode`，wrangler.jsonc 加
`"worker_loaders": [{ "binding": "LOADER" }]`，服务端换
`createBrowserTools({ ctx, browser, loader })` 并 `export { CodemodeRuntime }`。

## 项目结构

```
browser-agent/
├── index.html              # 前端入口
├── vite.config.ts          # Vite + @cloudflare/vite-plugin
├── wrangler.jsonc          # AI 绑定 / browser 绑定 / Durable Object
└── src/
    ├── server.ts           # ★ 三个浏览器工具（puppeteer.launch → 操作 → close）
    ├── client.tsx          # 聊天界面（含建议 prompt 按钮）
    └── styles.css
```

## 快速开始

```bash
npm install
npx wrangler login        # browser 绑定本地 dev 也需要账号
npx wrangler types
npm run dev               # http://localhost:5173
```

试试这些 prompt：

- `Open https://example.com and tell me the exact h1 heading text.`（多步工具链）
- `Summarize https://blog.cloudflare.com in 3 bullet points.`（读长文）

## 核心概念速查（学习重点）

| 概念 | 说明 |
|---|---|
| `puppeteer.launch(this.env.BROWSER)` | 从 Browser Rendering 绑定启动浏览器实例，用完 `browser.close()` 释放额度 |
| 工具设计 | 固定操作封装成 tool（open/content/eval），LLM 负责编排而非写协议代码 |
| `withBrowserRetry` | Free 计划节流（见下）时等 21 秒重试一次 |
| `GOTO_OPTIONS` | `domcontentloaded` 代替 `networkidle`，省免费时长 |
| AIChatAgent | 消息持久化 + 流式，与 chat-agent 同源 |
| 模型选型 | 必须选支持**结构化 function calling** 的模型（见下） |

## Free 计划额度（Browser Rendering）

| 限制 | 数值 |
|---|---|
| 每日浏览器时长 | **10 分钟**（超出返回 429 到次日重置） |
| 新浏览器启动频率 | **每 20 秒 1 个** |
| 并发浏览器 | 3 |

本项目实测：一次任务连续 5 次真实浏览器调用（open → content → eval×3）全部通过，
中途撞限流由 `withBrowserRetry` 自动恢复。

## 模型选型实测结论

- ❌ `llama-4-scout`：多步工具循环中会把工具调用**写成正文文本**
  （如 `[browser_eval(url=...)]`），结构化 tool call 丢失，流程中断
- ✅ `glm-4.7-flash`：多步结构化工具调用稳定（本项目默认）
- 记住：**Agent 的可靠性 = 模型的工具调用能力**，换模型前先验证这点

## 部署

```bash
npm run deploy           # vite build + wrangler deploy
```

建议绑定自定义域名（`workers.dev` 部分地区不可达），方法见仓库总 README。

## 下一步

- 加 `browser_screenshot` 工具（`page.screenshot()` 返回 base64，经文件 part 回传前端展示）
- 单会话复用浏览器实例（当前每工具启动一次，改为每次 `onChatMessage` 共享）
- 付费后升级 Code Mode（见上）
