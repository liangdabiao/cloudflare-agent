/**
 * 服务端：聊天 Agent（对应文档「聊天 Agent 示例」第 3 步）
 *
 * 核心概念：
 * - AIChatAgent：Agents SDK 提供的基类，运行在 Durable Object 中，
 *   自带 SQLite 消息持久化、WebSocket 实时连接与可恢复的流式传输。
 * - onChatMessage()：每当用户发来一条聊天消息时被调用，返回流式响应。
 * - 三种 tool 类型：
 *   1. 服务端 tool（有 execute、无 needsApproval）—— 在服务器自动执行
 *   2. 客户端 tool（无 execute）—— 发给浏览器，由 onToolCall 提供结果
 *   3. 审批 tool（有 needsApproval）—— 等用户点击 Approve 后才执行
 */
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
// 注：文档示例使用的 workers-ai-provider（v4.0.1）存在流式 delta 重复发射的 bug，
// 且已被官方废弃。这里改用官方推荐的 agents/models/ai-sdk —— 接口几乎一致：
//   旧：const workersai = createWorkersAI({ binding: this.env.AI });
//   新：const ai = createAI({ binding: this.env.AI });
import { createAI } from "agents/models/ai-sdk";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
} from "ai";
import { z } from "zod";

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    // 用 Workers AI 创建 provider —— 由 wrangler.jsonc 的 ai 绑定驱动，无需 API key
    const ai = createAI({ binding: this.env.AI });

    const result = streamText({
      // 文档示例模型：Llama 4 Scout
      model: ai("@cf/meta/llama-4-scout-17b-16e-instruct"),
      system:
        "You are a helpful assistant. You can check the weather, " +
        "get the user's timezone, and run calculations.",
      // convertToModelMessages：把 UI 消息（含 tool 调用记录）转成模型消息
      // pruneMessages：裁剪旧消息里的 tool 调用结果，控制上下文长度
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // ─────────────────────────────────────────────────────────────
        // 1. 服务端 tool：无 needsApproval —— 模型调用后在 server 自动运行
        // ─────────────────────────────────────────────────────────────
        getWeather: tool({
          description: "Get the current weather for a city",
          inputSchema: z.object({
            city: z.string().describe("City name"),
          }),
          execute: async ({ city }) => {
            // 生产环境请替换为真实天气 API
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

        // ─────────────────────────────────────────────────────────────
        // 2. 客户端 tool：没有 execute —— 请求发给浏览器，
        //    由客户端 onToolCall 返回结果后，对话自动继续
        // ─────────────────────────────────────────────────────────────
        getUserTimezone: tool({
          description: "Get the user's timezone from their browser",
          inputSchema: z.object({}),
        }),

        // ─────────────────────────────────────────────────────────────
        // 3. 审批 tool（human-in-the-loop）：needsApproval 返回 true 时，
        //    流暂停，等用户在 UI 点击 Approve / Reject 后才执行
        // ─────────────────────────────────────────────────────────────
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
          // 数字绝对值超过 1000 时需要人工审批
          needsApproval: async ({ a, b }) =>
            Math.abs(a) > 1000 || Math.abs(b) > 1000,
          execute: async ({ a, b, operator }) => {
            const ops = {
              "+": (x: number, y: number) => x + y,
              "-": (x: number, y: number) => x - y,
              "*": (x: number, y: number) => x * y,
              "/": (x: number, y: number) => x / y,
              "%": (x: number, y: number) => x % y,
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
      // 最多 5 步（模型回复 → 调 tool → 拿结果继续回复…），防止无限循环
      stopWhen: stepCountIs(5),
    });

    // 以 UI 消息流的形式返回，客户端可流式渲染，断线后可从中断处恢复
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request, env) {
    // routeAgentRequest：把 /agent/ChatAgent/... 形式的请求
    // 路由到对应 Agent 实例（含 WebSocket 升级请求）
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
