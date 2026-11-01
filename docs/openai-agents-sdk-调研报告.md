# 调研报告：从 Cloudflare Agents SDK 迁移到 OpenAI Agents SDK

> 调研日期：2026-11-02
> 背景：本仓库五个 Agent 案例（chat / voice / email / browser / slack）全部基于 Cloudflare Agents SDK 实现。
> 本文回答一个问题：**换成 OpenAI Agents SDK 可行吗？代价是什么？怎么迁？**

---

## 一、结论摘要（TL;DR）

**可行，但"换框架"不是翻译，而是换一层架构。**

两个框架根本不是同一层的东西：

| | Cloudflare Agents SDK | OpenAI Agents SDK |
|---|---|---|
| 本质 | **有状态的 Agent 运行时基础设施** | **无状态的 Agent 编排原语库** |
| 提供什么 | Durable Object 实例化、SQLite 持久化、WebSocket 实时连接、请求路由、休眠唤醒、定时任务、可恢复流 | Agent 定义、Runner 执行循环、Handoffs 多代理编排、Guardrails、Sessions 抽象、Tracing 可观测、托管工具 |
| 不提供什么 | Handoffs/Guardrails/Tracing 原语、托管工具 | 运行时（进程/托管）、状态存储、聊天 UI 组件、通道集成（邮件/Slack/浏览器） |
| 模型绑定 | 无（Workers AI / 任意 provider） | 任意（但 Tracing 需要 OpenAI key；JS 多模型经 AI SDK 桥接有粗糙边） |
| 费用 | Workers AI Free 计划 **$0** | **必须 OpenAI API key，按 token 计费，无免费额度** |

**核心判断**：

1. **能不能？** 能。OpenAI Agents SDK（JS 版 `@openai/agents`）官方支持 Cloudflare Workers（`nodejs_compat`，标注 experimental），也有 Node 22+ / Deno / Bun 官方支持。
2. **代价多大？** 迁移的真正成本不在 AI 调用层（五个项目的 `streamText` 调用已经与框架解耦），而在**重建有状态运行时**：消息持久化、实时连接、UI hook、多租户路由都要自己搭或换方案。
3. **值不值？** 取决于你要什么：要 Handoffs/Guardrails/Tracing/托管工具/与 OpenAI 模型的深度优化 → 值；只是想跑五个单代理 demo → 不值（现有架构更省、更全）。

---

## 二、OpenAI Agents SDK 全貌

### 2.1 版本与成熟度

| | Python（openai-agents） | JS/TS（openai-agents-js，`@openai/agents`） |
|---|---|---|
| 发布 | 2025-03（GA） | 2025-03 alpha → 2025-06 正式发布 |
| 定位 | 主力版本，集成最多 | 核心原语对齐 Python，部分集成滞后（如 Temporal 持久执行只有 Python 有） |
| 运行时 | Python 3.9+ | **Node.js 22+ / Deno / Bun 官方；Cloudflare Workers（nodejs_compat）实验性** |

### 2.2 核心原语（JS 版 API 概览）

```
Agent        = { name, instructions, model, tools, handoffs, outputType }
run()        → Runner 执行循环（支持流式：StreamedRunResult + 细粒度事件）
Handoffs     → agent 间转交（point-to-point，含输入过滤/条件启用）
Guardrails   → 输入/输出校验（tripwire 触发即中止），工具级 guardrail 也有
Sessions     → 会话记忆抽象：
               · MemorySession（内存）
               · OpenAIConversationsSession（官方 Conversations API 存储）
               · OpenAIResponsesCompactionSession（上下文压缩）
               · 自定义：实现 Session 接口（可接 DO/D1/Redis/Postgres）
Tracing      → 内置，OpenAI 平台 dashboard 查看（需 OPENAI_API_KEY，非 OpenAI 模型也可用）
MCP          → MCPServerStdio / SSE / StreamableHttp，hostedMcpTool
托管工具      → webSearchTool / fileSearchTool / codeInterpreterTool /
               imageGenerationTool / computerTool / shellTool / hostedMcpTool
实时语音      → @openai/agents-realtime：RealtimeAgent + RealtimeSession，
               WebRTC / WebSocket / SIP 传输，支持输出 guardrail 与 MCP 工具
```

### 2.3 与本仓库特别相关的官方扩展

- **`extensions/cloudflare`（Voice Agents on Cloudflare）**：官方指南，讲 `@openai/agents-realtime` 与 Cloudflare（Workers WebSocket / Durable Objects）结合做实时语音——voice 迁移有官方路径。
- **`extensions/ai-sdk`**：JS 版可桥接 Vercel AI SDK 的 provider（多模型入口），但社区记录了粗糙边（如 openAICompatible 的图片输入序列化 bug）。
- **模型多路**：Python 有 LiteLLM（100+ provider）；JS 主要走 OpenAI-compatible base URL 或 AI SDK 桥接。

### 2.4 部署形态

Agents SDK 是**库**，不是平台。你要自己回答三个 Cloudflare Agents SDK 替你回答的问题：

1. **跑在哪**：Node 服务（Next.js API route / Hono / Express）、Workers（实验性）、或任意能发 HTTPS 的环境。
2. **状态放哪**：会话历史必须外置（自定义 Session → D1 / DO storage / Redis / Postgres），SDK 只给接口。
3. **通道怎么接**：Web 前端、Slack webhook、邮件投递、浏览器工具全部自理。

---

## 三、概念映射表

| Cloudflare Agents SDK 概念 | OpenAI Agents SDK 对应物 | 缺口 |
|---|---|---|
| `Agent` 基类（DO 内有状态实例） | `Agent` 类（纯配置，无状态） | **实例化/有状态运行时没有**——需自建（DO/单例服务）+ 外置 Session |
| `AIChatAgent` + `onChatMessage()` | `Agent` + `run(message, { session })` | 循环结构类似（模型→工具→结果→续跑），语义可平移 |
| `routeAgentRequest`（URL→实例路由） | 无 | 自己写（HTTP 路由 + idFromName 等价物） |
| WebSocket 实时连接 + 可恢复流 | `StreamedRunResult` 流式事件 | 无 WS 长连接协议、无断线恢复——自建或降级为 HTTP 流 |
| `useAgentChat`（React hook） | **无内置等价物** | 自建 hook（包装 StreamedRunResult）或用 Vercel AI SDK UI 组件 |
| SQLite 消息持久化 | `Session` 接口 | 自定义 Session 实现（工作量 1-2 天） |
| `withVoice` mixin（STT/分句/TTS 全管线） | `@openai/agents-realtime`（Realtime API 端到端语音） | 管线形态不同：OpenAI 是端到端语音模型，非"STT→LLM→TTS"三段式；STT/TTS provider 不可插拔 |
| `sendEmail` / `routeAgentEmail` / 邮件 resolver | **无** | 保留 Cloudflare Email Service（它与框架无关），只换 AI 脑 |
| Browser Rendering 绑定 | `webSearchTool`（托管搜索，非浏览器）/ `computerTool`（Computer Use） | 无浏览器运行时；渲染类任务需保留 Puppeteer 方案或改用托管搜索 |
| `@callable()` RPC | 无（SDK 不绑定传输层） | 普通 HTTP/RPC 自建 |
| Tracing | **原生内置**（这是 OpenAI 强项） | — |
| Handoffs 多代理 | **原生内置**（这是 OpenAI 强项） | — |

**一句话**：OpenAI SDK 把"编排"做厚（handoffs/guardrails/tracing/托管工具），把"运行时和状态"完全留给你；Cloudflare 把"运行时和状态"做厚，把"编排"留给你。

---

## 四、五个项目逐项迁移评估

### 4.1 chat-agent —— 迁移可行性：★★★★☆（最容易）

**现状依赖**：`AIChatAgent`（消息持久化+WS）、`useAgentChat`（UI hook）、`stopWhen` 步数控制、三种 tool（服务端/客户端/审批）。

**迁移方案**：
- Agent 定义平移：三个 `tool()` 定义（getWeather / getUserTimezone / calculate）结构几乎不变；
- 客户端工具（无 execute）在 OpenAI SDK 里需要自己实现"挂起→前端执行→回填结果→续跑"协议——**这正是我们踩过死循环坑的地方**（踩坑 #15），OpenAI SDK 同样存在该问题且需要类似护栏；
- 人工审批（needsApproval）→ 用 `HumanInTheLoop` 工具模式或 Guardrails 实现，官方有 interrupt 模式；
- 持久化：自定义 Session（D1 或 DO storage）约 1-2 天；
- UI：自建 React hook 包装流式事件（约 1-2 天），或前端改用 Vercel AI SDK 的 `useChat` + 桥接。

**估算**：3-5 人日。功能不缩水，但失去 WS 断线恢复与 hibernate 零成本在线。

### 4.2 voice-agent —— 迁移可行性：★★★☆☆

**现状依赖**：`withVoice` mixin（Flux STT + 分句 + Aura TTS + 打断检测 + 延迟指标），全部 Workers AI 免费。

**迁移方案**：改用 `@openai/agents-realtime`（官方甚至有 Cloudflare 扩展指南）。但形态变化大：
- OpenAI 是 **Realtime API 端到端语音模型**（语音进→语音出，工具调用内嵌），不是我们"STT→LLM→TTS"的三段管线；
- STT/TTS **不可换 provider**（绑定 OpenAI 模型），打断检测/回声抑制由 Realtime 会话处理；
- **成本剧增**：Realtime API 按音频 token 计费，是目前最贵的消费形态；Workers AI 版本 $0。

**估算**：4-6 人日（含前端临时 token 发放、传输层重写）。能力上限更高（语音原生 agent），但运行成本从 0 变为持续计费。

### 4.3 email-agent —— 迁移可行性：★★★★☆，但性质是"换脑不换框架"

**关键事实**：邮件收发靠的是 **Cloudflare Email Service**（`send_email` 绑定、`email()` handler、路由 resolver）——这些与 Agents SDK **完全无关**，OpenAI SDK 也没有任何邮件能力。我们代码里真正"框架内"的只有 `Agent` 基类的 state 存储和 `@callable`。

**迁移方案**：保留全部邮件基础设施，把 `generateAIReply`（若有）从 Workers AI 换成 Agents SDK 调用。若想在 Workers 上用 `@openai/agents`（实验性支持）需要重写 state 层；若在 Node 服务上则无法收邮件（Email Service 只投递给 Cloudflare Worker）。

**估算**：1-2 人日（其实只是换 LLM 调用）。结论：**迁移收益最低**——这个案例的价值全在邮件基础设施层。

### 4.4 browser-agent —— 迁移可行性：★★☆☆☆（最伤）

**现状依赖**：Browser Rendering 绑定 + Puppeteer 三工具（open/content/eval）——这是 Cloudflare 独有的能力。

**OpenAI 侧替代**：
- `webSearchTool`（托管网络搜索）：能"查"，但**不能"渲染指定页面并检查 DOM"**——能力不等价；
- `computerTool`（Computer Use）：能操作浏览器截图点击，但贵、慢、且非渲染级 DOM 访问；
- 保留 Puppeteer：在 Node 服务上用 Playwright/Puppeteer 做工具（可行但失去 Workers 免运维 + Browser Rendering 的额度管理），在 Workers 上则现有代码不用动，只是"脑"换掉。

**估算**：若"换脑不换手"（Workers + Agents SDK 做脑 + 保留 Puppeteer 工具）1-2 人日；若整体搬到 Node + 自管浏览器 3-5 人日且多一台常驻服务。**能力/成本比变差**。

### 4.5 slack-agent —— 迁移可行性：★★★★★

**关键事实**：OAuth、HMAC-SHA256 验签、team_id→DO 路由、Slack API 封装——全是我们手写的，**与框架零耦合**（SlackAgent 基类继承 Agent 只为用 state 存储）。AI 回复已经是一个独立的 `streamText` 调用。

**迁移方案**：把 `generateAIReply` 内部换成 Agents SDK（顺手可加 Guardrails：输入过敏感词、输出长度限制），其余一行不改。多租户路由本来就是自研的。

**估算**：0.5-1 人日。**迁移摩擦最小**。

---

## 五、三种迁移架构方案

### 方案 A：留在 Cloudflare Workers，引入 `@openai/agents` 做"脑"

```
[现有 Workers + DO + 域名 + Email/Browser 绑定]
        └── AI 调用层：Workers AI (createAI)  →  替换为  →  @openai/agents（experimental）
                                                      + OPENAI_API_KEY (secret)
                                                      + 自定义 Session（DO storage / D1）
```
- ✅ 保留全部基础设施（邮件、浏览器、域名、免运维、免费额度）
- ✅ 渐进式：一个项目一个项目换，随时可回退
- ⚠️ Workers 支持是 experimental；voice 需按官方 Cloudflare 扩展重做传输层
- 适合：想要 OpenAI 编排能力但不想换基础设施

### 方案 B：整体迁到 Node 服务（Next.js / Hono），标准 OpenAI 姿势

```
[Next.js 22+ 应用：Agent 定义 + API routes + 自建 Session (Postgres/Redis)]
        ├── Web 聊天（自建 hook 或 AI SDK UI）
        ├── Slack webhook（代码平移）
        ├── Realtime 语音（agents-realtime）
        └── 邮件：❌ 需保留一个 Cloudflare Worker 做 Email 接收（混合）
            浏览器：自管 Playwright（新常驻依赖）
```
- ✅ SDK 官方支持的主场（Node 22），社区示例全部直接可用
- ✅ Session 存储选择多（Postgres/Redis），Handoffs/Guardrails/Tracing 完整体验
- ❌ 失去：免运维、Email 直投、Browser Rendering、Workers AI 免费额度、hibernate
- ❌ 邮件被迫保留混合架构；新增服务器运维
- 适合：要做大规模多代理编排（Handoffs）、深度依赖 OpenAI 生态

### 方案 C（推荐）：混合渐进 —— "脑可以换，地基不动"

1. **第一步（零风险）**：slack-agent 与 email-agent 的 AI 调用换成 `@openai/agents`（半天），体验 Handoffs/Guardrails/Tracing——它们的框架耦合最薄；
2. **第二步**：chat-agent 在 Workers 上试点 `@openai/agents` + 自定义 Session（3-5 人日），重点评估 experimental Workers 支持的稳定性与 Tracing 的实际价值；
3. **第三步（可选）**：voice-agent 按官方 Cloudflare 扩展迁 Realtime（仅在愿意承担 Realtime 计费时做）；
4. **browser-agent 保持现状**（Puppeteer + Workers AI），或仅把"脑"换成 Agents SDK。

---

## 六、成本对比（务必看清）

| 项 | 现状（Workers AI） | OpenAI Agents SDK |
|---|---|---|
| 模型调用 | Free 计划 **$0**（有额度） | **按 token 计费，无免费额度**；四大对话模型中最便宜的 mini 级也有单价 |
| 语音 | $0（Flux STT + Aura TTS） | Realtime API 按音频 token 计费，**同一使用量下成本高 1-2 个数量级** |
| 浏览器 | 10 分钟/天 Free | 无内置；webSearchTool 按次计费 |
| Tracing | 无 | 需 OpenAI key（免费层有保留期限制） |
| 运维 | Workers 免费托管 | 方案 B 需自付服务器 |

> 建议迁移前用真实流量估一版账：以本仓库 demo 级流量，OpenAI 账单约在每月几美元量级即可支撑，但语音若开放使用会显著放大。

---

## 七、迁移工作量汇总

| 项目 | 可行性 | 估算 | 备注 |
|---|---|---|---|
| slack-agent | ★★★★★ | 0.5-1 天 | 只换脑，手写代码全复用 |
| email-agent | ★★★★☆ | 1-2 天 | 换脑不换框架；价值全在邮件层 |
| chat-agent | ★★★★☆ | 3-5 天 | Session + UI hook + 审批/客户端工具协议重建 |
| voice-agent | ★★★☆☆ | 4-6 天 | Realtime 重写；成本结构改变 |
| browser-agent | ★★☆☆☆ | 1-5 天 | 能力不等价，建议保留现状或只换脑 |
| **合计** | | **约 10-19 人日** | 方案 A/C 渐进式可再摊薄 |

---

## 八、决策建议

**建议采用方案 C（混合渐进）**，理由：

1. 本仓库五个项目的 AI 调用层已经与框架解耦（统一走 AI SDK 的 `streamText`），换"脑"的成本天然低；
2. 真正值钱的 OpenAI 能力（Handoffs / Guardrails / Tracing / 托管工具）可以在**不放弃任何现有基础设施**的前提下增量引入；
3. 唯一不可替代的 Cloudflare 资产是：Email Service、Browser Rendering、Workers AI 免费额度——方案 B 会全部失去，方案 C 全部保留；
4. 先做 slack/email（1-2 天）验证 Tracing 与 Guardrails 是否真的解决了你的痛点，再决定是否深度迁移 chat/voice。

**什么时候应该整体迁（方案 B）**：当你的需求从"单代理 + 工具"升级为"多代理协作（Handoffs 编排）+ 严格合规护栏 + 深度可观测"，且愿意为此承担 OpenAI 计费与自管服务器时。

---

## 九、参考资料

- [openai/openai-agents-js（GitHub）](https://github.com/openai/openai-agents-js) — 运行时支持（Node 22+/Deno/Bun/Workers experimental）、临时 token 机制
- [OpenAI Agents JS 文档](https://openai.github.io/openai-agents-js/) — Agent/Runner/Sessions/Handoffs/Guardrails/MCP/Realtime API
- [Voice Agents on Cloudflare（官方扩展指南）](https://openai.github.io/openai-agents-js/extensions/cloudflare/) — @openai/agents-realtime × Cloudflare
- [Sessions（Python 文档，概念通用）](https://openai.github.io/openai-agents-python/sessions/)
- [Models via LiteLLM](https://openai.github.io/openai-agents-python/models/litellm/) — 多模型支持
- [OpenAI Voice Agents 指南](https://developers.openai.com/api/docs/guides/voice-agents) — GPT-Live / Realtime 对比
- [openai-realtime-agents 示例](https://github.com/openai/openai-realtime-agents) — Realtime + Agents SDK 官方 demo
- [AI SDK Agent 抽象](https://ai-sdk.dev/) 与 [vercel/ai#7939](https://github.com/vercel/ai/issues/7939) — JS 多模型桥接的粗糙边
- [TrustVector：OpenAI Agents SDK 安全评估](https://trustvector.guard0.ai/agents/openai-agents-sdk)
- [社区讨论：生产环境使用 Agents SDK](https://community.openai.com/t/voice-ai-people-are-you-using-agents-sdk-on-prod/1380748)
