/**
 * Slack Agent 实现（对应文档「Slack Agent 示例」src/index.ts）
 *
 * 能力：
 * - 响应私信（DM）
 * - 响应频道里的 @提及，并在线程中回复（保持上下文）
 * - 多租户：每个 workspace 一个 Agent 实例，凭据隔离
 *
 * LLM 按文档「使用其他 LLM 提供商」定制章节改用 Workers AI（Free 可用），
 * 无需 OpenAI API key。模型用 glm-4.7-flash（Free ✓，见 README 踩坑记录）。
 */
import { env } from "cloudflare:workers";
import { createAI } from "agents/models/ai-sdk";
import { streamText, stepCountIs } from "ai";
import { SlackAgent, listen, type SlackMsg } from "./slack";

export class MyAgent extends SlackAgent<Env> {
  /** 把 Slack 消息数组归一化为 LLM 消息（替换 @提及、区分自己/用户） */
  private async normalizeForLLM(
    msgs: SlackMsg[],
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const selfId = await this.ensureAppUserId();
    return msgs
      .filter((m) => !m.subtype) // 编辑/加入等系统事件跳过
      .map((m) => {
        const isSelf =
          m.bot_id !== undefined || m.user === undefined || m.user === selfId;
        const role: "user" | "assistant" = isSelf ? "assistant" : "user";
        const text = (m.text ?? "").replace(/<@([A-Z0-9]+)>/g, "@user");
        return { role, content: text || "(empty)" };
      });
  }

  /** 用 Workers AI 生成回复（流式收集为完整文本） */
  async generateAIReply(conversation: SlackMsg[]): Promise<string> {
    const ai = createAI({ binding: this.env.AI });
    const messages = await this.normalizeForLLM(conversation);

    const result = streamText({
      model: ai("@cf/zai-org/glm-4.7-flash"),
      system:
        "You are a helpful AI assistant in Slack.\n" +
        "Be brief, specific, and actionable. " +
        "If you're unsure, ask a single clarifying question.",
      messages,
      stopWhen: stepCountIs(3),
    });

    let reply = "";
    for await (const delta of result.textStream) reply += delta;
    if (!reply.trim()) throw new Error("No message from AI");
    return reply;
  }

  /** 事件入口：私信 + @提及（文档 onSlackEvent 逻辑） */
  async onSlackEvent(event: { type: string } & Record<string, unknown>) {
    // 忽略 bot 消息与系统子类型（编辑、加入等）
    if (event.bot_id || event.subtype) return;

    // ── 私信（channel 以 D 开头即 DM）──
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

    // ── 频道 @提及：拉线程上下文，在线程里回复 ──
    if (event.type === "app_mention") {
      const e = event as unknown as SlackMsg & { channel: string };
      const thread = await this.fetchConversation(e.channel, e.thread_ts || e.ts);
      const content = await this.generateAIReply(thread);
      await this.sendMessage(content, {
        channel: e.channel,
        thread_ts: e.thread_ts || e.ts,
      });
      return;
    }
  }
}

// 文档 API：export default MyAgent.listen({ ... })
export default listen({
  clientId: env.SLACK_CLIENT_ID,
  clientSecret: env.SLACK_CLIENT_SECRET,
  slackSigningSecret: env.SLACK_SIGNING_SECRET,
  scopes: [
    "chat:write", // 以 bot 身份发消息
    "chat:write.public", // 免加入频道即可发消息
    "channels:history", // 读公开频道历史
    "app_mentions:read", // 接收 @提及
    "im:write", // 发私信
    "im:history", // 读私信历史
  ],
});
