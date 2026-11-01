在 Cloudflare 上构建 Agents
最后更新
2026年8月9日

复制为 Markdown
查看 Markdown
Agent 设置
在  Cloudflare 上构建并托管 Agent，将聊天、语音、邮件、Slack 和 Webhook 连接到持久化 Agent 运行时，并集成 Browser、Sandbox、AI Search、MCP、Payments 及其他 MCP 工具。体验AI智能工具

在 Cloudflare 上托管 Agent 时，每个 Agent 会话都拥有持久化身份、本地 SQL 存储、实时连接、调度任务以及可恢复的执行。

部署一次，Cloudflare 即可在全球网络上运行你的 Agent，扩展至数千万实例。无需管理基础设施，无需重建会话，也无需将状态外置。
 
Cloudflare 上的 Agent 由四个部分组成：

通信渠道 定义用户和系统如何访问 Agent，例如聊天、语音、邮件、Slack、Webhook 及其他事件源。
Agent 控制循环（harness） 定义循环：Agent 如何调用模型、选择工具、处理工具结果、流式返回响应，以及决定是否继续。使用 Project Think 作为开箱即用的控制循环，或直接在 Agents SDK 运行时 上构建自定义循环。
Agents SDK 运行时 提供持久化基础设施：Agent 类、状态、会话、路由、WebSocket、调度、持久执行（fiber） 以及可观测性。
工具 赋予 Agent 能力：浏览器自动化、沙箱代码执行、AI Search、MCP 工具 以及支付。Code Mode 让模型通过编写代码来发现并编排多个工具。
快速入门
三条命令即可运行 Agent。无需 API 密钥——入门模板默认使用 Workers AI。

npx create-cloudflare@latest --template cloudflare/agents-starter
cd agents-starter && npm install
npm run dev

入门模板包含流式 AI 聊天、服务端与客户端工具、人在回路（human-in-the-loop）审批以及任务调度——既可在此基础上扩展，也可按需拆解。你也可以切换为 OpenAI、Anthropic、Google Gemini 或其他提供商。

示例 Agent
聊天 Agent
构建带工具和人在回路（human-in-the-loop）审批的流式 AI 聊天 Agent。

Slack Agent
构建可响应 Slack 消息、提及和命令的 Agent。订阅生产力软件

语音 Agent
构建具备语音转文字和文字转语音的实时语音 Agent。

浏览器 Agent
构建可检查页面、截取屏幕截图并使用浏览器工具的 Agent。

邮件 Agent
构建可发送、接收、路由和回复邮件的 Agent。





聊天 Agent 示例
最后更新
2026年8月15日

复制为 Markdown
查看 Markdown
Agent 设置
构建流式 AI 响应、调用服务端 tool、在 browser 执行 client-side tool，并在敏感操作前请求用户审批的聊天 Agent。

你将构建： 由 Workers AI 驱动的聊天 Agent，含三种 tool 类型 — 自动、client-side 与需审批。

时间： 约 15 分钟

本教程从最小 Hello World Worker 开始，便于看清每个组成部分。若想要已接好核心组件的完整 starter，请从快速入门开始，再回来看聊天部分如何组合。

前提条件：

Node.js 18+
 Cloudflare 账户（Free 计划即可）
1. 创建项目
npm create cloudflare@latest chat-agent

提示时选择 "Hello World" Worker。然后安装依赖：

cd chat-agent
npm install agents @cloudflare/ai-chat ai workers-ai-provider zod

2. 配置 Wrangler
将 wrangler.jsonc 替换为：

wrangler.jsonc
wrangler.toml
{
	"name": "chat-agent",
	"main": "src/server.ts",
	// Set this to today's date
	"compatibility_date": "2026-08-17",
	"compatibility_flags": ["nodejs_compat"],
	"ai": { "binding": "AI" },
	"durable_objects": {
		"bindings": [{ "name": "ChatAgent", "class_name": "ChatAgent" }],
	},
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }],
}

关键设置：

ai 绑定 Workers AI — 无需 API key
durable_objects 注册 chat agent 类
new_sqlite_classes 启用消息持久化的 SQLite 存储
3. 编写服务端
创建 src/server.ts，Agent 在此运行：学习编程课程

JavaScript
TypeScript
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
	streamText,
	convertToModelMessages,
	pruneMessages,
	tool,
	stepCountIs,
} from "ai";
import { z } from "zod";

export class ChatAgent extends AIChatAgent {
	async onChatMessage() {
		const workersai = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct"),
			system:
				"You are a helpful assistant. You can check the weather, " +
				"get the user's timezone, and run calculations.",
			messages: pruneMessages({
				messages: await convertToModelMessages(this.messages),
				toolCalls: "before-last-2-messages",
			}),
			tools: {
				// Server-side tool: runs automatically on the server
				getWeather: tool({
					description: "Get the current weather for a city",
					inputSchema: z.object({
						city: z.string().describe("City name"),
					}),
					execute: async ({ city }) => {
						// Replace with a real weather API in production
						const conditions = ["sunny", "cloudy", "rainy"];
						const temp = Math.floor(Math.random() * 30) + 5;
						return {
							city,
							temperature: temp,
							condition:
								conditions[Math.floor(Math.random() * conditions.length)],
						};
					},
				}),

				// Client-side tool: no execute function — the browser handles it
				getUserTimezone: tool({
					description: "Get the user's timezone from their browser",
					inputSchema: z.object({}),
				}),

				// Approval tool: requires user confirmation before executing
				calculate: tool({
					description:
						"Perform a math calculation with two numbers. " +
						"Requires user approval for large numbers.",
					inputSchema: z.object({
						a: z.coerce.number().describe("First number"),
						b: z.coerce.number().describe("Second number"),
						operator: z
							.enum(["+", "-", "*", "/", "%"])
							.describe("Arithmetic operator"),
					}),
					needsApproval: async ({ a, b }) =>
						Math.abs(a) > 1000 || Math.abs(b) > 1000,
					execute: async ({ a, b, operator }) => {
						const ops = {
							"+": (x, y) => x + y,
							"-": (x, y) => x - y,
							"*": (x, y) => x * y,
							"/": (x, y) => x / y,
							"%": (x, y) => x % y,
						};
						if (operator === "/" && b === 0) {
							return { error: "Division by zero" };
						}
						return {
							expression: `${a} ${operator} ${b}`,
							result: ops[operator](a, b),
						};
					},
				}),
			},
			stopWhen: stepCountIs(5),
		});

		return result.toUIMessageStreamResponse();
	}
}

export default {
	async fetch(request, env) {
		return (
			(await routeAgentRequest(request, env)) ||
			new Response("Not found", { status: 404 })
		);
	},
};

各 tool 类型行为
Tool	execute?	needsApproval?	行为
getWeather	是	否	在 server 上自动运行
getUserTimezone	否	否	发送到 client；browser 提供结果
calculate	是	是（大数字）	等待用户审批后在 server 运行
4. 编写 client
创建 src/client.tsx：

JavaScript
TypeScript
import { useAgent } from "agents/react";
import { useAgentChat, getToolApproval } from "@cloudflare/ai-chat/react";

function Chat() {
	const agent = useAgent({ agent: "ChatAgent" });

	const {
		messages,
		sendMessage,
		clearHistory,
		addToolApprovalResponse,
		status,
	} = useAgentChat({
		agent,
		// Handle client-side tools (tools with no server execute function)
		onToolCall: async ({ toolCall, addToolOutput }) => {
			if (toolCall.toolName === "getUserTimezone") {
				addToolOutput({
					toolCallId: toolCall.toolCallId,
					output: {
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						localTime: new Date().toLocaleTimeString(),
					},
				});
			}
		},
	});

	return (
		<div>
			<div>
				{messages.map((msg) => (
					<div key={msg.id}>
						<strong>{msg.role}:</strong>
						{msg.parts.map((part, i) => {
							if (part.type === "text") {
								return <span key={i}>{part.text}</span>;
							}

							// Render approval UI for tools that need confirmation
							if (part.state === "approval-requested") {
								const approval = getToolApproval(part);
								if (!approval) return null;
								return (
									<div key={part.toolCallId}>
										<p>
											Approve <strong>{part.toolName}</strong>?
										</p>
										<pre>{JSON.stringify(part.input, null, 2)}</pre>
										<button
											onClick={() =>
												addToolApprovalResponse({
													id: approval.id,
													approved: true,
												})
											}
										>
											Approve
										</button>
										<button
											onClick={() =>
												addToolApprovalResponse({
													id: approval.id,
													approved: false,
												})
											}
										>
											Reject
										</button>
									</div>
								);
							}

							// Show completed tool results
							if (part.state === "output-available") {
								return (
									<details key={part.toolCallId}>
										<summary>{part.toolName} result</summary>
										<pre>{JSON.stringify(part.output, null, 2)}</pre>
									</details>
								);
							}

							return null;
						})}
					</div>
				))}
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					const input = e.currentTarget.elements.namedItem("message");
					sendMessage({ text: input.value });
					input.value = "";
				}}
			>
				<input name="message" placeholder="Try: What's the weather in Paris?" />
				<button type="submit" disabled={status === "streaming"}>
					Send
				</button>
			</form>

			<button onClick={clearHistory}>Clear history</button>
		</div>
	);
}

export default function App() {
	return <Chat />;
}

Client 关键概念
useAgent 通过 WebSocket 连接到 ChatAgent
useAgentChat 管理聊天生命周期（消息、流式、tool）
onToolCall 处理 client-side tool — LLM 调用 getUserTimezone 时 browser 提供结果并自动继续对话
addToolApprovalResponse 批准或拒绝带 needsApproval 的 tool
消息、流式与恢复均自动处理
5. 本地运行
生成类型并启动 dev server：

npx wrangler types
npm run dev

尝试这些 prompt：

"What is the weather in Tokyo?" — 调用服务端 getWeather tool
"What timezone am I in?" — 调用 client-side getUserTimezone tool（browser 提供答案）
"What is 5000 times 3?" — 执行前触发审批 UI（数字超过 1000）
6. 部署
npx wrangler deploy

Agent 现已在  Cloudflare 全球网络上运行。消息持久化在 SQLite，断开时流可恢复，空闲时 Agent hibernate 以节省资源。注册网站域名

你构建的内容
你的 chat agent 具备：

通过 Workers AI 的流式 AI 响应（无需 API key）
SQLite 消息持久化 — 对话在重启后仍保留
服务端 tool 自动执行
客户端 tool 在 browser 运行并将结果回传 LLM
敏感操作的 Human-in-the-loop 审批
可恢复流式传输 — client 在 stream 中途断开时可从中断处继续





Slack Agent 示例
最后更新
2026年8月16日

复制为 Markdown
查看 Markdown
Agent 设置
部署你的第一个 Slack Agent
本指南将展示如何在 Cloudflare Workers 上构建并部署 AI 驱动的 Slack bot，它可以：

响应私信
在频道中被 @提及时回复
在线程中保持对话上下文
使用 AI 生成智能回复
你的 Slack Agent 将是多租户应用，即单次部署可服务多个 Slack 工作区。每个工作区拥有由 Agents SDK 驱动的独立 Agent 实例与专用存储。

完整示例代码见此处 ↗。

前提条件
开始前，你需要：

Cloudflare 账户 ↗
已安装 Node.js ↗（v18 或更高）
拥有安装应用权限的 Slack 工作区 ↗
OpenAI API key ↗（或其他 LLM 提供商）
1. 创建 Slack App
首先，创建 Agent 用于与 Slack 交互的新 Slack App：

前往 api.slack.com/apps ↗ 并选择 Create New App（创建新应用）。
选择 From scratch（从零开始）。
为应用命名（例如 "My AI Assistant"）并选择工作区。
选择 Create App（创建应用）。
配置 OAuth 与权限
在 Slack App 设置中，前往 OAuth & Permissions（OAuth 与权限） 并添加以下 Bot Token Scopes（Bot 令牌范围）：

chat:write — 以 bot 身份发送消息
chat:write.public — 无需加入频道即可发送消息
channels:history — 查看公开频道中的消息
app_mentions:read — 接收 @提及
im:write — 发送私信
im:history — 查看私信历史
启用 Event Subscriptions
部署 Agent 后你将配置 Event Subscriptions URL。现在请先在 Slack App 设置中前往 Event Subscriptions（事件订阅） 并做好启用准备。

订阅以下 bot 事件：

app_mention — bot 被 @提及时
message.im — 发给 bot 的私信
暂时不要启用。部署后再启用。

获取 Slack 凭据
从 Slack App 设置中收集以下值：

Basic Information（基本信息） > App Credentials（应用凭据）：
Client ID（客户端 ID）
Client Secret（客户端密钥）
Signing Secret（签名密钥）
请妥善保存 — 下一步会用到。

2. 创建 Slack Agent 项目
为 Slack Agent 创建新项目：
npm
yarn
pnpm
npm create cloudflare@latest -- my-slack-agent

进入项目目录：
cd my-slack-agent

安装所需依赖：
npm install agents openai

3. 设置环境变量
在项目根目录创建 .env 文件用于本地开发密钥：
touch .env

将凭据添加到 .env：
SLACK_CLIENT_ID="your-slack-client-id"
SLACK_CLIENT_SECRET="your-slack-client-secret"
SLACK_SIGNING_SECRET="your-slack-signing-secret"
OPENAI_API_KEY="your-openai-api-key"
OPENAI_BASE_URL="https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/YOUR_GATEWAY/openai"

说明

OPENAI_BASE_URL 可选但推荐。使用 Cloudflare AI Gateway 可为 AI 请求提供缓存、速率限制与分析。

更新 wrangler.jsonc 以配置 Agent：
wrangler.jsonc
wrangler.toml
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "my-slack-agent",
	"main": "src/index.ts",
	// Set this to today's date
	"compatibility_date": "2026-08-17",
	"compatibility_flags": [
		"nodejs_compat"
	],
	"durable_objects": {
		"bindings": [
			{
				"name": "MyAgent",
				"class_name": "MyAgent",
				"script_name": "my-slack-agent"
			}
		]
	},
	"migrations": [
		{
			"tag": "v1",
			"new_classes": [
				"MyAgent"
			]
		}
	]
}

4. 创建 Slack Agent
首先在 src/slack.ts 创建基础 SlackAgent 类。该类处理 OAuth、request 验证与事件路由。完整实现见 GitHub ↗。

在 src/index.ts 创建 Agent 实现：

import { env } from "cloudflare:workers";
import { SlackAgent } from "./slack";
import { OpenAI } from "openai";

const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY,
	baseURL: env.OPENAI_BASE_URL,
});

type SlackMsg = {
	user?: string;
	text?: string;
	ts: string;
	thread_ts?: string;
	subtype?: string;
	bot_id?: string;
};

function normalizeForLLM(msgs: SlackMsg[], selfUserId: string) {
	return msgs.map((m) => {
		const role = m.user && m.user !== selfUserId ? "user" : "assistant";
		const text = (m.text ?? "").replace(/<@([A-Z0-9]+)>/g, "@$1");
		return { role, content: text };
	});
}

export class MyAgent extends SlackAgent {
	async generateAIReply(conversation: SlackMsg[]) {
		const selfId = await this.ensureAppUserId();
		const messages = normalizeForLLM(conversation, selfId);

		const system = `You are a helpful AI assistant in Slack.
Be brief, specific, and actionable. If you're unsure, ask a single clarifying question.`;

		const input = [{ role: "system", content: system }, ...messages];

		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: input,
		});

		const msg = response.choices[0].message.content;
		if (!msg) throw new Error("No message from AI");

		return msg;
	}

	async onSlackEvent(event: { type: string } & Record<string, unknown>) {
		// Ignore bot messages and subtypes (edits, joins, etc.)
		if (event.bot_id || event.subtype) return;

		// Handle direct messages
		if (event.type === "message") {
			const e = event as unknown as SlackMsg & { channel: string };
			const isDM = (e.channel || "").startsWith("D");
			const mentioned = (e.text || "").includes(
				`<@${await this.ensureAppUserId()}>`,
			);

			if (!isDM && !mentioned) return;

			const conversation = await this.fetchConversation(e.channel);
			const content = await this.generateAIReply(conversation);
			await this.sendMessage(content, { channel: e.channel });
			return;
		}

		// Handle @mentions in channels
		if (event.type === "app_mention") {
			const e = event as unknown as SlackMsg & {
				channel: string;
				text?: string;
			};
			const thread = await this.fetchThread(e.channel, e.thread_ts || e.ts);
			const content = await this.generateAIReply(thread);
			await this.sendMessage(content, {
				channel: e.channel,
				thread_ts: e.thread_ts || e.ts,
			});
			return;
		}
	}
}

export default MyAgent.listen({
	clientId: env.SLACK_CLIENT_ID,
	clientSecret: env.SLACK_CLIENT_SECRET,
	slackSigningSecret: env.SLACK_SIGNING_SECRET,
	scopes: [
		"chat:write",
		"chat:write.public",
		"channels:history",
		"app_mentions:read",
		"im:write",
		"im:history",
	],
});

5. 本地测试
启动开发服务器：

npm run dev

Agent 现运行于 http://localhost:8787。

配置 Slack Event Subscriptions
Agent 本地运行后，需要将其暴露给 Slack。使用 Cloudflare Tunnel 创建安全隧道：

npx cloudflared tunnel --url http://localhost:8787

将输出类似 https://random-subdomain.trycloudflare.com 的公开 URL。

返回 Slack App 设置：

前往 Event Subscriptions（事件订阅）。

将 Enable Events 切换为 On。

输入 Request URL：https://random-subdomain.trycloudflare.com/slack。

Slack 会发送验证 request — 若 Agent 运行正确，应显示 Verified。

在 Subscribe to bot events（订阅机器人事件） 下添加：

app_mention
message.im
选择 Save Changes（保存更改）。

说明

Cloudflare Tunnel URL 是临时的。本地测试时，每次重启隧道都需要更新 Request URL。

将应用安装到 Slack
在浏览器中访问 http://localhost:8787/install。将重定向到 Slack 授权页。选择 Allow（允许） 将应用安装到工作区。

授权后，浏览器应显示 "Successfully registered!"。

测试 Agent
打开 Slack。然后：

向 bot 发送私信 — 应收到 AI 生成的回复。
在频道中 @提及 bot（例如 @My AI Assistant hello）— 应在线程中回复。
若一切正常，即可部署到生产环境！

6. 部署到生产环境
部署前，将 secret 添加到 Cloudflare：
npx wrangler secret put SLACK_CLIENT_ID
npx wrangler secret put SLACK_CLIENT_SECRET
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL

说明

若未使用 AI Gateway，可跳过 OPENAI_BASE_URL。

部署 Agent：
npx wrangler deploy

部署后将获得类似以下生产 URL：

https://my-slack-agent.your-account.workers.dev

更新 Slack Event Subscriptions
返回 Slack App 设置：

前往 Event Subscriptions（事件订阅）。
将 Request URL 更新为生产 URL：https://my-slack-agent.your-account.workers.dev/slack。
选择 Save Changes（保存更改）。
分发应用
Agent 部署后，可与他人共享：

单工作区：通过 https://my-slack-agent.your-account.workers.dev/install 安装。
公开分发：将应用提交到 Slack App Directory ↗。
每个安装应用的工作区都将获得具有专用存储的隔离 Agent 实例。

工作原理
使用 Durable Objects 的多租户
Slack Agent 使用 Durable Objects 为每个 Slack 工作区提供隔离、有状态的实例：

每个工作区的 team_id 用作 Durable Object ID。
每个 Agent 实例在 KV 存储中保存自己的 Slack access token。
对话按需从 Slack API 获取。
所有 Agent 逻辑在隔离、一致的环境中运行。
OAuth 流程
Agent 处理 Slack 的 OAuth 2.0 流程：

用户访问 /install > 重定向到 Slack 授权。
用户选择 Allow（允许） > Slack 重定向到 /accept 并携带 authorization code。
Agent 用 code 交换 access token。
Agent 将 token 存储在工作区的 Durable Object 中。
事件处理
Slack 发送事件时：

Request 到达 /slack 端点。
Agent 使用 HMAC-SHA256 验证 request 签名。
Agent 将事件路由到正确工作区的 Durable Object。
onSlackEvent 方法处理事件并生成响应。
自定义 Agent
更改 AI model
在 src/index.ts 中更新 model：

const response = await openai.chat.completions.create({
	model: "gpt-4o", // 或其他 model
	messages: input,
});

添加对话 memory
在 Durable Object 存储中保存对话历史：

async storeMessage(channel: string, message: SlackMsg) {
  const history = await this.ctx.storage.kv.get(`history:${channel}`) || [];
  history.push(message);
  await this.ctx.storage.kv.put(`history:${channel}`, history);
}

响应特定关键词
在 onSlackEvent 中添加自定义逻辑：

async onSlackEvent(event: { type: string } & Record<string, unknown>) {
  if (event.type === "message") {
    const e = event as unknown as SlackMsg & { channel: string };

    if (e.text?.includes("help")) {
      await this.sendMessage("Here's how I can help...", {
        channel: e.channel
      });
      return;
    }
  }

  // ... rest of your event handling
}

使用其他 LLM 提供商
将 OpenAI 替换为 Workers AI：

import { Ai } from "@cloudflare/ai";

export class MyAgent extends SlackAgent {
	async generateAIReply(conversation: SlackMsg[]) {
		const ai = new Ai(this.ctx.env.AI);
		const response = await ai.run("@cf/meta/llama-3-8b-instruct", {
			messages: normalizeForLLM(conversation, await this.ensureAppUserId()),
		});
		return response.response;
	}
}

后续步骤
添加 Slack Interactive Components ↗（按钮、modal）
将 Agent 连接到 MCP server
添加速率限制以防止滥用
实现对话 state 管理
使用 Workers Analytics Engine 跟踪使用情况
添加 schedules 用于定时任务





Browser Agent 示例
最后更新
2026年8月9日

复制为 Markdown
查看 Markdown
Agent 设置
构建一个 Agent，它可以浏览网页、检查页面、截取屏幕截图，并使用 Browser Run tool 调试前端问题。 Beta

与固定 browser 操作集（click、screenshot、navigate）不同，LLM 编写 JavaScript 代码对 live browser session 运行 CDP 命令——访问协议中所有 domain、command、event 与 type。

提供两个 tool：

Tool	描述
browser_search	查询 CDP spec 以发现 command、event 与 type。spec 从 browser 的 CDP 端点动态获取并缓存。
browser_execute	通过 cdp helper 对 live browser 运行 CDP 命令。每次调用打开新的 browser session，执行代码后关闭。
何时使用 browser tools
当 Agent 需要以下能力时，browser tool 很有用：

检查网页 — DOM 结构、computed style、无障碍树
调试前端问题 — 网络瀑布图、console 错误、性能 trace
抓取结构化 数据 — 从渲染后的页面提取内容
截取屏幕截图或 PDF — 网页内容的视觉快照
分析性能 — Core Web Vitals、JavaScript profiling、内存分析
不需要渲染 DOM 的基本页面 fetch 请改用 fetch()。

安装
Browser tool 需要 Agents SDK 与 @cloudflare/codemode：订阅生产力软件

npm install agents @cloudflare/codemode ai zod

快速入门
1. 配置 binding
在 wrangler 配置中添加 Browser Run（原 Browser Rendering）与 Worker Loader 绑定（binding）：

wrangler.jsonc
wrangler.toml
{
	"compatibility_flags": ["nodejs_compat"],
	"browser": {
		"binding": "BROWSER",
	},
	"worker_loaders": [
		{
			"binding": "LOADER",
		},
	],
}

2. 创建 browser tool
JavaScript
TypeScript
import { createBrowserTools } from "agents/browser/ai";

const browserTools = createBrowserTools({
	browser: env.BROWSER,
	loader: env.LOADER,
});

若要连接自定义 CDP 端点而非 Browser Run 绑定（binding），请传入 cdpUrl。

3. 与 streamText 配合使用
将 browser tool 与其他 tool 一并传入。model 可为任意 AI SDK provider——此处使用 Workers AI：订阅生产力软件

JavaScript
TypeScript
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

const workersai = createWorkersAI({ binding: env.AI });

const result = streamText({
	model: workersai("@cf/zai-org/glm-4.7-flash"),
	system: "You are a helpful assistant that can inspect web pages.",
	messages,
	tools: {
		...browserTools,
		...otherTools,
	},
});

两个 tool 均接受含 JavaScript async 箭头函数的 code 参数。Sandbox 按 tool 注入全局变量——browser_search 用 spec，browser_execute 用 cdp。

LLM 使用 browser_search 时，代码通过注入的 spec 对象查询 CDP spec：

async () => {
	const s = await spec.get();
	return s.domains
		.find((d) => d.name === "Network")
		.commands.map((c) => ({ method: c.method, description: c.description }));
};

LLM 使用 browser_execute 时，代码通过注入的 cdp helper 运行 CDP 命令：

async () => {
	const { targetId } = await cdp.send("Target.createTarget", {
		url: "https://example.com",
	});
	const sessionId = await cdp.attachToTarget(targetId);
	const { root } = await cdp.send("DOM.getDocument", {}, { sessionId });
	const { outerHTML } = await cdp.send(
		"DOM.getOuterHTML",
		{ nodeId: root.nodeId },
		{ sessionId },
	);
	await cdp.send("Target.closeTarget", { targetId });
	return outerHTML;
};

与 Agent 配合使用
典型模式是在 AIChatAgent 消息 handler 内创建 browser tool，从而获得消息持久化与流式传输：

JavaScript
TypeScript
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createBrowserTools } from "agents/browser/ai";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, stepCountIs } from "ai";

export class MyAgent extends AIChatAgent {
	async onChatMessage() {
		const workersai = createWorkersAI({ binding: this.env.AI });
		const browserTools = createBrowserTools({
			browser: this.env.BROWSER,
			loader: this.env.LOADER,
		});

		const result = streamText({
			model: workersai("@cf/zai-org/glm-4.7-flash"),
			system: "You can browse the web and inspect pages.",
			messages: await convertToModelMessages(this.messages),
			tools: {
				...browserTools,
			},
			stopWhen: stepCountIs(10),
		});

		return result.toUIMessageStreamResponse();
	}
}

TanStack AI
TanStack AI 使用 /tanstack-ai 导出：

JavaScript
TypeScript
import { createBrowserTools } from "agents/browser/tanstack-ai";
import { chat, workersAIText } from "@tanstack/ai";

const browserTools = createBrowserTools({
	browser: env.BROWSER,
	loader: env.LOADER,
});

const stream = chat({
	adapter: workersAIText(env.AI, "@cf/zai-org/glm-4.7-flash"),
	tools: [...browserTools, ...otherTools],
	messages,
});

执行模型
browser_search 从 browser 的 /json/protocol 端点获取 live CDP 协议并短暂缓存。
browser_execute 每次调用打开新的 browser session，向 sandbox 代码暴露小型 cdp 辅助 API，执行完成后关闭 session。
LLM 生成的代码在 Worker sandbox 中运行。CDP 流量保留在 host Worker 中。
CDP 辅助 API
在 browser_execute 内，sandbox 代码可使用以下函数。

cdp.send(method, params?, options?)
发送 CDP 命令并等待响应。

参数	类型	描述
method	string	CDP method，例如 "DOM.getDocument" 或 "Network.enable"
params	unknown	方法参数
options.timeoutMs	number	单条 command 超时（默认：10 秒）
options.sessionId	string	Target session ID（页面级 command 必需）
cdp.attachToTarget(targetId, options?)
attach 到 target 并获取 session ID。使用 flatten: true 的 Target.attachToTarget。

参数	类型	描述
targetId	string	要 attach 的 target
options.timeoutMs	number	attach command 超时
返回 sessionId 字符串。

cdp.getDebugLog(limit?)
获取最近 CDP debug log 条目（send、receive、error）。默认最后 50 条，最多 400。

cdp.clearDebugLog()
清空 debug log 缓冲区。

配置
createBrowserTools(options)
返回 AI SDK tool（browser_search 与 browser_execute）。订阅生产力软件

选项	类型	默认值	描述
browser	Fetcher	—	Browser Run 绑定（binding）
cdpUrl	string	—	自定义 CDP 端点的可选 override
cdpHeaders	Record<string, string>	—	CDP URL 发现用的 header（例如 Cloudflare Access）
loader	WorkerLoader	必需	sandbox 执行的 Worker Loader 绑定（binding）
timeout	number	30000	执行超时（毫秒）
必须提供 browser 或 cdpUrl 之一。两者均设置时 cdpUrl 优先。

原始访问
自定义集成时直接 import 构建块：

JavaScript
TypeScript
import {
	CdpSession,
	connectBrowser,
	connectUrl,
	createBrowserToolHandlers,
} from "agents/browser";

// Connect to a custom CDP endpoint
const session = await connectUrl("http://localhost:9222");
const version = await session.send("Browser.getVersion");
session.close();

本地开发
新版 Wrangler 支持本地开发中的 Browser Run。npx wrangler dev 自动 provision browser，因此相同 browser: env.BROWSER 设置在本地与部署后均可用。

仅当有意连接其他 CDP 兼容 browser 端点（如 tunnel 或手动管理的 Chrome 实例）时使用 cdpUrl。

安全注意事项
LLM 生成的代码在隔离的 Worker sandbox 中运行——每次执行获得独立 Worker 实例
外部网络访问（fetch、connect）在 runtime 层于 sandbox 中被阻止
CDP command 通过 Workers RPC 分发——WebSocket 位于 host，不在 sandbox 中
CDP spec 保留在服务端——仅查询结果流向 LLM
响应截断至约 6,000 token，防止 context window 溢出
当前限制
每次 execute 调用一个 session — 每次 browser_execute 调用打开新的 browser session。多步 workflow 必须在单个代码块内完成。
无认证 session — browser 启动时不带任何 cookie 或登录 state。
需要 @cloudflare/codemode 作为 peer dependency（对等依赖）。
sandbox 中仅支持 JavaScript 执行（不支持 TypeScript 语法）。
直接使用 Puppeteer
若希望以编程方式控制 browser 而不使用 LLM 生成代码，可直接用 Puppeteer 配合 Browser Run API。学习编程课程

npm
yarn
pnpm
bun
npm i -D @cloudflare/puppeteer

JavaScript
TypeScript
import puppeteer from "@cloudflare/puppeteer";

export class MyAgent extends Agent {
	async browse(browserInstance, urls) {
		let responses = [];
		for (const url of urls) {
			const browser = await puppeteer.launch(browserInstance);
			const page = await browser.newPage();
			await page.goto(url);

			await page.waitForSelector("body");
			const bodyContent = await page.$eval(
				"body",
				(element) => element.innerHTML,
			);

			let resp = await this.env.AI.run("@cf/zai-org/glm-4.7-flash", {
				messages: [
					{
						role: "user",
						content: `Return a JSON object with the product names, prices and URLs from the website content below. <content>${bodyContent}</content>`,
					},
				],
			});

			responses.push(resp);
			await browser.close();
		}

		return responses;
	}
}

在 wrangler 配置中添加 browser 绑定（binding）：

wrangler.jsonc
wrangler.toml
{
	"ai": {
		"binding": "AI",
	},
	"browser": {
		"binding": "BROWSER",
	},
}

使用 Browserbase
也可在 Agent 内直接调用 Browserbase API 使用 Browserbase ↗。学习编程课程

获得 Browserbase API key ↗ 后，通过创建 secret 添加到 Agent：

cd your-agent-project-folder
npx wrangler@latest secret put BROWSERBASE_API_KEY

安装 @cloudflare/puppeteer 包并在 Agent 内调用 Browserbase API：

npm
yarn
pnpm
bun
npm i @cloudflare/puppeteer

JavaScript
TypeScript
import puppeteer from "@cloudflare/puppeteer";

export class MyAgent extends Agent {
	async browse(url) {
		const browser = await puppeteer.connect({
			browserWSEndpoint: `wss://connect.browserbase.com?apiKey=${this.env.BROWSERBASE_API_KEY}`,
		});
		const page = await browser.newPage();
		await page.goto(url);
		const content = await page.content();
		await browser.close();
		return content;
	}
}

上一页







Email Agent 示例
最后更新
2026年8月16日

复制为 Markdown
查看 Markdown
Agent 设置
Agents 可通过  Cloudflare Email Service 发送和接收邮件。本指南展示如何使用 Workers 绑定发送出站邮件、将入站邮件路由到 Agent，并安全处理后续回复。注册网站域名

前提条件
在 Agent 中使用邮件前，你需要：

已在 Cloudflare Email Service 中接入的域名。
在 wrangler.jsonc 中配置 send_email 绑定，用于出站邮件。
Email Service 路由规则，将入站邮件发送到 Worker。
可选：若需安全回复路由，配置 EMAIL_SECRET secret。
域设置
登录 Cloudflare 仪表板 ↗。
前往 Compute & AI（计算与 AI） > Email Service。
选择 Onboard Domain（接入域名） 并选择你的域名。
添加 DNS 记录（SPF 与 DKIM）以授权发送。
DNS 变更通常在 5–15 分钟内完成（使用 Cloudflare DNS 的域名），但全球传播最多可能需要 24 小时。升级网络设备

Wrangler 配置
向 Worker 添加 email binding：

wrangler.jsonc
wrangler.toml
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "send_email": [
    {
      "name": "EMAIL",
      "remote": true
    }
  ]
}

remote = true 选项让你在 wrangler dev 本地开发期间调用真实的 Email Service API。学习编程课程

快速入门
JavaScript
TypeScript
import { Agent, callable, routeAgentEmail } from "agents";
import { createAddressBasedEmailResolver } from "agents/email";
import PostalMime from "postal-mime";

export class EmailAgent extends Agent {
	@callable()
	async sendWelcomeEmail(to) {
		await this.sendEmail({
			binding: this.env.EMAIL,
			to,
			from: "support@yourdomain.com",
			replyTo: "support@yourdomain.com",
			subject: "Welcome to our service",
			text: "Thanks for signing up. Reply to this email if you need help.",
		});
	}

	async onEmail(email) {
		const raw = await email.getRaw();
		const parsed = await PostalMime.parse(raw);

		console.log("Received email from:", email.from);
		console.log("Subject:", parsed.subject);

		await this.replyToEmail(email, {
			fromName: "Support Agent",
			body: "Thanks for your email! We received it.",
		});
	}
}

export default {
	async email(message, env) {
		await routeAgentEmail(message, env, {
			resolver: createAddressBasedEmailResolver("EmailAgent"),
		});
	},
};

发送出站邮件
使用 sendEmail()
sendEmail() 通过你显式传入的 send_email 绑定发送出站邮件。它会自动向每条消息注入 Agent 路由头（X-Agent-Name、X-Agent-ID），并可选择用 HMAC-SHA256 签名，以便回复能路由回同一 Agent 实例。

JavaScript
TypeScript
class MyAgent extends Agent {
	@callable()
	async sendReceipt(to, orderId) {
		const result = await this.sendEmail({
			binding: this.env.EMAIL,
			to,
			from: { email: "billing@yourdomain.com", name: "Billing Bot" },
			replyTo: "billing@yourdomain.com",
			subject: `Receipt for order ${orderId}`,
			text: `Your receipt for order ${orderId} is ready.`,
			secret: this.env.EMAIL_SECRET,
		});

		return result.messageId;
	}
}

提供 secret 时，Agent 会签名路由头，使经 createSecureReplyEmailResolver 验证的回复能路由回同一 Agent 实例。

若希望收件人继续与同一 Agent 对话，将 replyTo 设为会路由回 Worker 的邮箱。

路由入站邮件
Resolver 决定哪一 Agent 实例接收入站邮件。按用例选择合适的 resolver。

对于基本的 Email Service 收发，createAddressBasedEmailResolver() 已足够。下文的安全回复 resolver 是可选的，专用于 Agents SDK 回复签名，并非 Email Service 的硬性要求。订阅生产力软件

createAddressBasedEmailResolver
推荐用于入站邮件。根据收件地址路由邮件。

JavaScript
TypeScript
import { createAddressBasedEmailResolver } from "agents/email";

const resolver = createAddressBasedEmailResolver("EmailAgent");

路由逻辑：

收件地址	Agent 名称	Agent ID
support@example.com	EmailAgent（默认）	support
sales@example.com	EmailAgent（默认）	sales
NotificationAgent+user123@example.com	NotificationAgent	user123
子地址格式（agent+id@domain）允许从单一邮件域名路由到不同 Agent 命名空间与实例。

说明

收件地址中的 Agent 类名匹配不区分大小写。邮件基础设施常将地址转为小写，因此 NotificationAgent+user123@example.com 与 notificationagent+user123@example.com 都会路由到 NotificationAgent 类。

createSecureReplyEmailResolver
用于带签名验证的回复流程。验证入站邮件是否为对你出站邮件的真实回复，防止攻击者伪造头将邮件路由到任意 Agent 实例。

JavaScript
TypeScript
import { createSecureReplyEmailResolver } from "agents/email";

const resolver = createSecureReplyEmailResolver(env.EMAIL_SECRET);

当 Agent 使用 replyToEmail() 或 sendEmail() 并传入 secret 发送邮件时，会用时间戳签名路由头。回复返回时，此 resolver 在路由前验证签名并检查是否过期。

选项：

JavaScript
TypeScript
const resolver = createSecureReplyEmailResolver(env.EMAIL_SECRET, {
	// 签名最大有效期（秒）（默认：30 天）
	maxAge: 7 * 24 * 60 * 60, // 7 天

	// 签名失败时的日志/调试回调
	onInvalidSignature: (email, reason) => {
		console.warn(`Invalid signature from ${email.from}: ${reason}`);
		// reason 可为："missing_headers"、"expired"、"invalid"、"malformed_timestamp"
	},
});

适用场景： Agent 发起邮件对话且需要回复安全路由回同一 Agent 实例时。

createCatchAllEmailResolver
用于单实例路由。无论收件地址为何，都将所有邮件路由到指定 Agent 实例。

JavaScript
TypeScript
import { createCatchAllEmailResolver } from "agents/email";

const resolver = createCatchAllEmailResolver("EmailAgent", "default");

适用场景： 单一 Agent 实例处理所有邮件时（例如共享收件箱）。

组合 resolver
可组合多个 resolver 处理不同场景：

JavaScript
TypeScript
export default {
	async email(message, env) {
		const secureReplyResolver = createSecureReplyEmailResolver(
			env.EMAIL_SECRET,
		);
		const addressResolver = createAddressBasedEmailResolver("EmailAgent");

		await routeAgentEmail(message, env, {
			resolver: async (email, env) => {
				// 首先检查是否为已签名回复
				const replyRouting = await secureReplyResolver(email, env);
				if (replyRouting) return replyRouting;

				// 否则按收件地址路由
				return addressResolver(email, env);
			},

			// 处理未匹配任何路由规则的邮件
			onNoRoute: (email) => {
				console.warn(`No route found for email from ${email.from}`);
				email.setReject("Unknown recipient");
			},
		});
	},
};

在 Agent 中处理邮件
AgentEmail 接口
调用 Agent 的 onEmail 方法时，会收到 AgentEmail 对象：

type AgentEmail = {
	from: string; // 发件人邮箱地址
	to: string; // 收件人邮箱地址
	headers: Headers; // 邮件头（subject、message-id 等）
	rawSize: number; // 原始邮件大小（字节）

	getRaw(): Promise<Uint8Array>; // 获取完整原始邮件内容
	reply(options): Promise<void>; // 发送回复
	forward(rcptTo, headers?): Promise<void>; // 转发邮件
	setReject(reason): void; // 拒收并附带原因
};

解析邮件内容
使用 postal-mime ↗ 等库解析原始邮件：

JavaScript
TypeScript
import PostalMime from "postal-mime";

class MyAgent extends Agent {
	async onEmail(email) {
		const raw = await email.getRaw();
		const parsed = await PostalMime.parse(raw);

		console.log("Subject:", parsed.subject);
		console.log("Text body:", parsed.text);
		console.log("HTML body:", parsed.html);
		console.log("Attachments:", parsed.attachments);
	}
}

检测自动回复邮件
使用 isAutoReplyEmail() 检测自动回复，避免邮件循环：

JavaScript
TypeScript
import { isAutoReplyEmail } from "agents/email";
import PostalMime from "postal-mime";

class MyAgent extends Agent {
	async onEmail(email) {
		const raw = await email.getRaw();
		const parsed = await PostalMime.parse(raw);

		// 检测自动回复，避免重复响应
		if (isAutoReplyEmail(parsed.headers)) {
			console.log("Skipping auto-reply email");
			return;
		}

		// 处理邮件...
	}
}

这会检查标准 RFC 3834 头（Auto-Submitted、X-Auto-Response-Suppress、Precedence），判断邮件是否为自动回复。

回复邮件
使用 this.replyToEmail() 通过入站邮件的回复通道发送回复：

JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		await this.replyToEmail(email, {
			fromName: "Support Bot", // 发件人显示名
			subject: "Re: Your inquiry", // 可选，默认为 "Re: "
			body: "Thanks for contacting us!", // 邮件正文
			contentType: "text/plain", // 可选，默认为 "text/plain"
			headers: {
				// 可选自定义头
				"X-Custom-Header": "value",
			},
			secret: this.env.EMAIL_SECRET, // 可选，签名头以实现安全回复路由
		});
	}
}

延迟回复
replyToEmail() 需要实时的 AgentEmail 对象，因此只能在 onEmail() 内使用。若需稍后回复——例如定时任务、callable 方法或人工审批后——将发件人信息存入 state 并使用 sendEmail()：

JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		const raw = await email.getRaw();
		const parsed = await PostalMime.parse(raw);

		this.setState({
			...this.state,
			pendingReply: {
				to: email.from,
				messageId: parsed.messageId,
				subject: parsed.subject,
			},
		});
	}

	@callable()
	async sendDelayedReply(body) {
		const { pendingReply } = this.state;
		if (!pendingReply) return;

		await this.sendEmail({
			binding: this.env.EMAIL,
			to: pendingReply.to,
			from: "support@yourdomain.com",
			subject: `Re: ${pendingReply.subject}`,
			text: body,
			inReplyTo: pendingReply.messageId,
			secret: this.env.EMAIL_SECRET,
		});
	}
}

inReplyTo 字段设置 In-Reply-To 头，使邮件客户端正确串接回复线程。secret 签名 Agent 路由头，使后续回复经 createSecureReplyEmailResolver 路由回此 Agent 实例。

转发邮件
JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		await email.forward("admin@example.com");
	}
}

拒收邮件
JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		if (isSpam(email)) {
			email.setReject("Message rejected as spam");
			return;
		}
		// 处理邮件...
	}
}

错误处理
通过 sendEmail() 或 replyToEmail() 发送邮件时，请处理以下常见错误：

JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		try {
			await this.replyToEmail(email, {
				fromName: "Support Bot",
				body: "Thanks for your email!",
			});
		} catch (error) {
			switch (error.code) {
				case "E_SENDER_NOT_VERIFIED":
					console.error("发件人域名未验证。请在仪表板中验证。");
					break;
				case "E_RATE_LIMIT_EXCEEDED":
					console.error("超出速率限制。退避后重试。");
					break;
				case "E_DAILY_LIMIT_EXCEEDED":
					console.error("已达每日发送配额。");
					break;
				case "E_CONTENT_TOO_LARGE":
					console.error("邮件内容超出大小限制。");
					break;
				default:
					console.error("邮件发送失败:", error.message);
			}
		}
	}
}

常见错误码
错误码	描述	解决方案
E_SENDER_NOT_VERIFIED	发件人域名/地址未验证	在 Cloudflare 仪表板中验证
E_RATE_LIMIT_EXCEEDED	达到发送速率限制	实现指数退避
E_DAILY_LIMIT_EXCEEDED	超出每日配额	等待配额重置或升级套餐
E_CONTENT_TOO_LARGE	邮件超出大小限制	减少附件或内容
E_RECIPIENT_NOT_ALLOWED	收件人不在允许列表	检查允许的目标地址
E_RECIPIENT_SUPPRESSED	收件人在抑制列表	从抑制列表移除
E_VALIDATION_ERROR	邮件格式无效	检查邮箱地址
E_TOO_MANY_RECIPIENTS	超过 50 个收件人	拆分为多次发送
安全回复路由
当 Agent 发送邮件并期望收到回复时，使用安全回复路由，防止攻击者伪造头将邮件路由到任意 Agent 实例。

工作原理
出站： 调用 replyToEmail() 或 sendEmail() 并传入 secret 时，Agent 使用 HMAC-SHA256 签名路由头（X-Agent-Name、X-Agent-ID）。
入站： createSecureReplyEmailResolver 在路由前验证签名。
强制： 若邮件经安全 resolver 路由，replyToEmail() 必须提供 secret（或显式传入 null 以选择退出）。
设置
向 Worker 添加 secret：

wrangler.jsonc
wrangler.toml
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "vars": {
    "EMAIL_SECRET": "change-me-in-production"
  }
}

生产环境请改用 Wrangler secret：

npx wrangler secret put EMAIL_SECRET

使用组合 resolver 模式：

JavaScript
TypeScript
export default {
	async email(message, env) {
		const secureReplyResolver = createSecureReplyEmailResolver(
			env.EMAIL_SECRET,
		);
		const addressResolver = createAddressBasedEmailResolver("EmailAgent");

		await routeAgentEmail(message, env, {
			resolver: async (email, env) => {
				const replyRouting = await secureReplyResolver(email, env);
				if (replyRouting) return replyRouting;
				return addressResolver(email, env);
			},
		});
	},
};

对出站邮件签名：

JavaScript
TypeScript
class MyAgent extends Agent {
	async onEmail(email) {
		await this.replyToEmail(email, {
			fromName: "My Agent",
			body: "Thanks for your email!",
			secret: this.env.EMAIL_SECRET, // 签名路由头
		});
	}
}

强制行为
当邮件经 createSecureReplyEmailResolver 路由时，replyToEmail() 会强制签名：

secret 值	行为
"my-secret"	签名头（安全）
undefined（省略）	抛出错误 — 必须提供 secret 或显式选择退出
null	允许但不推荐 — 显式选择不签名
完整示例
以下是一个完整的 Email Service Agent，可发送出站邮件并处理安全回复：

JavaScript
TypeScript
import { Agent, callable, routeAgentEmail } from "agents";
import {
	createAddressBasedEmailResolver,
	createSecureReplyEmailResolver,
} from "agents/email";
import PostalMime from "postal-mime";

export class EmailAgent extends Agent {
	@callable()
	async sendWelcome(to) {
		return this.sendEmail({
			binding: this.env.EMAIL,
			to,
			from: "support@yourdomain.com",
			subject: "Welcome!",
			text: "Thanks for signing up.",
			secret: this.env.EMAIL_SECRET,
		});
	}

	async onEmail(email) {
		const raw = await email.getRaw();
		const parsed = await PostalMime.parse(raw);

		console.log(`Email from ${email.from}: ${parsed.subject}`);

		const emails = this.state.emails || [];
		emails.push({
			from: email.from,
			subject: parsed.subject,
			receivedAt: new Date().toISOString(),
		});
		this.setState({ ...this.state, emails });

		await this.replyToEmail(email, {
			fromName: "Support Bot",
			body: `Thanks for your email! We received: "${parsed.subject}"`,
			secret: this.env.EMAIL_SECRET,
		});
	}
}

export default {
	async email(message, env) {
		const secureReplyResolver = createSecureReplyEmailResolver(
			env.EMAIL_SECRET,
			{
				maxAge: 7 * 24 * 60 * 60, // 7 days
				onInvalidSignature: (email, reason) => {
					console.warn(`Invalid signature from ${email.from}: ${reason}`);
				},
			},
		);
		const addressResolver = createAddressBasedEmailResolver("EmailAgent");

		await routeAgentEmail(message, env, {
			resolver: async (email, env) => {
				const replyRouting = await secureReplyResolver(email, env);
				if (replyRouting) return replyRouting;
				return addressResolver(email, env);
			},
			onNoRoute: (email) => {
				console.warn(`No route found for email from ${email.from}`);
				email.setReject("Unknown recipient");
			},
		});
	},
};

API 参考
EmailAddress
interface EmailAddress {
	email: string;
	name?: string;
}

sendEmail
async sendEmail(options: {
	binding: EmailSendBinding;
	to: string | EmailAddress | (string | EmailAddress)[];
	from: string | EmailAddress;
	subject: string;
	text?: string;
	html?: string;
	replyTo?: string | EmailAddress;
	cc?: string | EmailAddress | (string | EmailAddress)[];
	bcc?: string | EmailAddress | (string | EmailAddress)[];
	inReplyTo?: string;
	headers?: Record<string, string>;
	secret?: string;
}): Promise<EmailSendResult>;

通过 Email Service 绑定发送出站邮件。自动注入 X-Agent-Name 与 X-Agent-ID 头。提供 secret 时，用 HMAC-SHA256 签名头以实现安全回复路由。

选项	描述
binding	send_email 绑定（例如 this.env.EMAIL）。必需。
to	收件地址、地址数组或 EmailAddress 对象
from	发件地址或 EmailAddress 对象
subject	邮件主题
text	纯文本正文（text/html 至少填一项）
html	HTML 正文（text/html 至少填一项）
replyTo	回复地址或 EmailAddress 对象
cc	抄送地址、地址数组或 EmailAddress 对象
bcc	密送地址、地址数组或 EmailAddress 对象
inReplyTo	用于串接的 Message-ID（设置 In-Reply-To 头）
headers	额外自定义头（与 Agent 头冲突时以 Agent 头为准）
secret	用于 HMAC 签名 Agent 路由头的 secret
routeAgentEmail
function routeAgentEmail<Env>(
	email: ForwardableEmailMessage,
	env: Env,
	options: {
		resolver: EmailResolver;
		onNoRoute?: (email: ForwardableEmailMessage) => void | Promise<void>;
	},
): Promise<void>;

根据 resolver 决策，将入站邮件路由到相应 Agent。

选项	描述
resolver	决定邮件路由到哪个 Agent 的函数
onNoRoute	可选回调，未找到路由信息时调用。可用于拒收或自定义处理。未提供时记录警告并丢弃邮件。
createSecureReplyEmailResolver
function createSecureReplyEmailResolver(
	secret: string,
	options?: {
		maxAge?: number;
		onInvalidSignature?: (
			email: ForwardableEmailMessage,
			reason: SignatureFailureReason,
		) => void;
	},
): EmailResolver;

type SignatureFailureReason =
	| "missing_headers"
	| "expired"
	| "invalid"
	| "malformed_timestamp";

创建带签名验证的回复路由 resolver。

选项	描述
secret	HMAC 验证密钥（须与签名时使用的密钥一致）
maxAge	签名最大有效期（秒）（默认：30 天 / 2592000 秒）
onInvalidSignature	签名验证失败时的可选日志回调
signAgentHeaders
function signAgentHeaders(
	secret: string,
	agentName: string,
	agentId: string,
): Promise<Record<string, string>>;

手动签名 Agent 路由头。返回包含 X-Agent-Name、X-Agent-ID、X-Agent-Sig、X-Agent-Sig-Ts 的对象。

适用于通过外部服务发送邮件同时保持安全回复路由。签名含时间戳，默认 30 天内有效。







Voice Agent 示例
最后更新
2026年8月14日

复制为 Markdown
查看 Markdown
Agent 设置
构建 voice agent：聆听用户、用 LLM 思考并实时通过 WebSocket 语音回复。 Beta

本指南结束时你将拥有：

带 speech-to-text 与 text-to-speech 的服务端 voice agent
流式响应的 LLM 驱动 onTurn handler
对话期间 agent 可调用的 tool
带 push-to-talk 风格 UI 的 React client
前置条件
具备 Workers AI 访问权限的 Cloudflare 账户
Node.js 18+
1. 创建项目
用 Vite 与 React 脚手架新建 Workers 项目，然后添加 voice 依赖：

npm create cloudflare@latest voice-agent -- --template cloudflare/agents-starter
cd voice-agent
npm install @cloudflare/voice

Starter 提供可用的 Vite + React + Cloudflare Workers 设置。后续步骤将替换 server 与 client 代码。

2. 配置 wrangler
更新 wrangler.jsonc，包含 Workers AI binding 与 voice agent 的 Durable Object：

wrangler.jsonc
wrangler.toml
{
	"name": "voice-agent",
	// Set this to today's date
	"compatibility_date": "2026-08-17",
	"compatibility_flags": ["nodejs_compat"],
	"main": "src/server.ts",
	"ai": {
		"binding": "AI"
	},
	"durable_objects": {
		"bindings": [
			{
				"name": "MyVoiceAgent",
				"class_name": "MyVoiceAgent"
			}
		]
	},
	"migrations": [
		{
			"tag": "v1",
			"new_sqlite_classes": ["MyVoiceAgent"]
		}
	]
}

3. 构建 server
将 src/server.ts 替换为以下内容。withVoice mixin 为 standard Agent 类添加完整 voice pipeline — STT、句子分块、TTS 与对话持久化。

JavaScript
TypeScript
import { Agent, routeAgentRequest } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS } from "@cloudflare/voice";
import { streamText, tool, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

const VoiceAgent = withVoice(Agent);

export class MyVoiceAgent extends VoiceAgent {
	transcriber = new WorkersAIFluxSTT(this.env.AI);
	tts = new WorkersAITTS(this.env.AI);

	async onTurn(transcript, context) {
		const workersAi = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersAi("@cf/moonshotai/kimi-k2.6"),
			system:
				"You are a helpful voice assistant. Keep responses concise — you are being spoken aloud.",
			messages: [
				...context.messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				{ role: "user", content: transcript },
			],
			tools: {
				get_current_time: tool({
					description: "Get the current date and time.",
					inputSchema: z.object({}),
					execute: async () => ({
						time: new Date().toLocaleTimeString("en-US", {
							hour: "2-digit",
							minute: "2-digit",
						}),
					}),
				}),
			},
			stopWhen: stepCountIs(3),
			abortSignal: context.signal,
		});

		return result.textStream;
	}

	async onCallStart(connection) {
		await this.speak(connection, "Hi there! How can I help you today?");
	}
}

export default {
	async fetch(request, env) {
		return (
			(await routeAgentRequest(request, env)) ??
			new Response("Not found", { status: 404 })
		);
	},
};

要点：

WorkersAIFluxSTT 处理 continuous speech-to-text — model 检测用户何时说完。
WorkersAITTS 将 LLM 响应逐句转为 audio。
onTurn 接收 transcript 并返回 stream。Mixin 将 stream 分句并合成每一句。
onCallStart 在用户连接时发送问候。
context.messages 含 SQLite 中的完整对话历史。
用户 interrupt 或 disconnect 时 context.signal 会被 abort。
4. 构建 client
将 src/client.tsx 替换为使用 useVoiceAgent hook 的 React 组件。Hook 管理 WebSocket 连接、mic 采集、audio 播放与 interrupt 检测。

import { useVoiceAgent } from "@cloudflare/voice/react";

function App() {
	const {
		status,
		transcript,
		interimTranscript,
		metrics,
		audioLevel,
		isMuted,
		startCall,
		endCall,
		toggleMute,
	} = useVoiceAgent({ agent: "MyVoiceAgent" });

	return (
		<div>
			<h1>Voice Agent</h1>
			<p>Status: {status}</p>

			<div>
				<button onClick={status === "idle" ? startCall : endCall}>
					{status === "idle" ? "Start Call" : "End Call"}
				</button>
				{status !== "idle" && (
					<button onClick={toggleMute}>{isMuted ? "Unmute" : "Mute"}</button>
				)}
			</div>

			{interimTranscript && (
				<p>
					<em>{interimTranscript}</em>
				</p>
			)}

			{transcript.map((msg, i) => (
				<p key={i}>
					<strong>{msg.role}:</strong> {msg.text}
				</p>
			))}

			{metrics && (
				<p>
					LLM: {metrics.llm_ms}ms | TTS: {metrics.tts_ms}ms | First audio:{" "}
					{metrics.first_audio_ms}ms
				</p>
			)}
		</div>
	);
}

status 字段循环 "idle" → "listening" → "thinking" → "speaking" → "listening"，足以构建响应式 UI。

5. 运行
npm run dev

在浏览器打开应用，选择 Start Call（开始通话） 并说话。你将实时看到 transcript，agent 回复会通过扬声器播放。

添加 pipeline hook
可在 pipeline 各阶段 intercept 并 transform 数据。例如过滤短 transcript（噪声）并在 TTS 前调整发音：

JavaScript
TypeScript
export class MyVoiceAgent extends VoiceAgent {
	transcriber = new WorkersAIFluxSTT(this.env.AI);
	tts = new WorkersAITTS(this.env.AI);

	afterTranscribe(transcript, connection) {
		if (transcript.length < 3) return null;
		return transcript;
	}

	beforeSynthesize(text, connection) {
		return text.replace(/\bAI\b/g, "A.I.");
	}

	async onTurn(transcript, context) {
		return "You said: " + transcript;
	}
}

从 afterTranscribe 返回 null 会完全丢弃该 utterance — 适用于过滤噪声或过短 transcript。

使用第三方 provider
更换第三方 STT 或 TTS provider 而无需改动 agent 逻辑：

JavaScript
TypeScript
import { ElevenLabsTTS } from "@cloudflare/voice-elevenlabs";
import { DeepgramSTT } from "@cloudflare/voice-deepgram";

export class MyVoiceAgent extends VoiceAgent {
	transcriber = new DeepgramSTT({
		apiKey: this.env.DEEPGRAM_API_KEY,
	});

	tts = new ElevenLabsTTS({
		apiKey: this.env.ELEVENLABS_API_KEY,
		voiceId: "21m00Tcm4TlvDq8ikWAM",
	});

	async onTurn(transcript, context) {
		return "You said: " + transcript;
	}
}

后续步骤