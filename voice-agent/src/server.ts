/**
 * 服务端：语音 Agent（对应文档「Voice Agent 示例」第 3 步）
 *
 * 核心概念：
 * - withVoice(Agent)：mixin，为普通 Agent 类添加完整语音管线 ——
 *   STT（语音转文字）、句子分块、TTS（文字转语音）与对话持久化（SQLite）
 * - transcriber：WorkersAIFluxSTT，流式 STT，模型自动检测"说完一轮"，
 *   无需客户端做静音检测
 * - tts：WorkersAITTS，把 LLM 回复逐句合成音频
 * - onTurn()：收到一轮完整 transcript 后触发，返回文本流；
 *   mixin 负责把流分句、逐句送 TTS、通过 WebSocket 把音频推给浏览器
 * - onCallStart()：用户接通时打招呼
 */
import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS } from "@cloudflare/voice";
import { streamText, tool, stepCountIs } from "ai";
// 注：workers-ai-provider 已废弃且有流式 delta 重复 bug，改用官方推荐写法
import { createAI } from "agents/models/ai-sdk";
import { z } from "zod";

const VoiceAgent = withVoice(Agent);

export class MyVoiceAgent extends VoiceAgent<Env> {
  // 流式 STT：Flux 模型自带轮次结束检测（end-of-turn）
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  // TTS：默认 @cf/deepgram/aura-1，可传 { model, speaker } 换音色
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, context: { messages: Array<{ role: string; content: string }>; signal: AbortSignal }) {
    const ai = createAI({ binding: this.env.AI });

    const result = streamText({
      // 注：文档示例模型 @cf/moonshotai/kimi-k2.6 需要 Workers 付费计划；
      // Free 计划可用 glm-4.7-flash（推理 token 走独立 reasoning 字段，
      // 不会出现在语音里，但会增加少量首响应延迟）。付费后可换 kimi/glm-5.3。
      model: ai("@cf/zai-org/glm-4.7-flash"),
      system:
        "You are a helpful voice assistant. Keep responses concise — " +
        "you are being spoken aloud.",
      // context.messages 是 SQLite 里的完整对话历史
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
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
      // 用户打断（interrupt）或断开连接时该 signal 会被 abort
      abortSignal: context.signal,
    });

    // 返回文本流；mixin 会自动分句并逐句合成语音
    return result.textStream;
  }

  async onCallStart(connection: Connection) {
    await this.speak(connection, "Hi there! How can I help you today?");
  }
}

export default {
  async fetch(request, env) {
    // routeAgentRequest：把 /agents/MyVoiceAgent/... 的请求（含 WebSocket 升级）
    // 路由到对应语音 Agent 实例
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
