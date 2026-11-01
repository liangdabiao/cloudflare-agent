/**
 * 服务端：邮件 Agent（对应文档「Email Agent 示例」）
 *
 * 核心概念：
 * - send_email 绑定（EMAIL）：出站邮件通道，remote=true 时本地 dev 也能发真实邮件
 * - sendEmail()：出站发送，自动注入 Agent 路由头（X-Agent-Name/X-Agent-ID），
 *   传 secret 时用 HMAC-SHA256 签名，回复邮件可安全路由回同一 Agent 实例
 * - onEmail()：收到入站邮件时触发；用 postal-mime 解析原始邮件
 * - replyToEmail()：回复入站邮件（只能在 onEmail 内使用，需要活跃的 AgentEmail 对象）
 * - isAutoReplyEmail()：RFC 3834 自动回复检测，避免邮件死循环
 * - routeAgentEmail + resolver：入站邮件 → 决定路由到哪个 Agent 实例
 *   · createAddressBasedEmailResolver：按收件地址路由（support@ → 实例 "support"）
 *   · createSecureReplyEmailResolver：验签的回复路由（防伪造头）
 *   · createCatchAllEmailResolver：全部路由到单实例
 * - @callable()：把方法暴露给客户端 / 测试端点调用
 */
import {
  Agent,
  callable,
  routeAgentRequest,
  routeAgentEmail,
  type Connection,
} from "agents";
import {
  createAddressBasedEmailResolver,
  createSecureReplyEmailResolver,
  isAutoReplyEmail,
  type AgentEmail,
} from "agents/email";
import PostalMime from "postal-mime";

/** 收件记录（持久化在 Durable Object 的 state 里） */
interface ReceivedEmail {
  from: string;
  subject: string;
  receivedAt: string;
  preview: string;
}

export class EmailAgent extends Agent<
  Env,
  { emails: ReceivedEmail[] }
> {
  /**
   * 出站测试：发送一封欢迎邮件。
   * 经 /test-send 端点或客户端 callable 调用。
   */
  @callable()
  async sendWelcomeEmail(to: string, name?: string): Promise<{ messageId: string }> {
    const result = await this.sendEmail({
      binding: this.env.EMAIL,
      to,
      from: `support@${this.env.AGENT_DOMAIN}`,
      replyTo: `support@${this.env.AGENT_DOMAIN}`,
      subject: "Welcome from your Cloudflare Email Agent!",
      text:
        `Hi ${name || "there"},\n\n` +
        "This email was sent by an Agent running on Cloudflare Workers.\n" +
        `Reply directly to this address (${`support@${this.env.AGENT_DOMAIN}`}) ` +
        "and the Agent will respond.\n",
      // secret 签名路由头：你的回复会被验签后路由回这个 Agent 实例
      secret: this.env.EMAIL_SECRET,
    });
    return { messageId: result.messageId };
  }

  /** 入站邮件处理：解析 → 防循环 → 记录 → 回复 */
  async onEmail(email: AgentEmail) {
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);

    console.log("Received email from:", email.from);
    console.log("Subject:", parsed.subject);

    // 检测自动回复（Auto-Submitted / X-Auto-Response-Suppress / Precedence 头），
    // 避免两个机器人互相回复形成死循环
    if (isAutoReplyEmail(parsed.headers)) {
      console.log("Skipping auto-reply email");
      return;
    }

    // 记录到 Agent state（SQLite 持久化）
    // 注意：全新实例的 this.state 可能为 undefined，务必用可选链
    const emails: ReceivedEmail[] = this.state?.emails ?? [];
    emails.push({
      from: email.from,
      subject: parsed.subject ?? "(no subject)",
      receivedAt: new Date().toISOString(),
      preview: (parsed.text || "").slice(0, 200),
    });
    this.setState({ ...this.state, emails });

    // 回复发件人。replyToEmail 只能在 onEmail 内使用（需要活跃的邮件对象）。
    await this.replyToEmail(email, {
      fromName: "Email Agent",
      body:
        `Thanks for your email! We received: "${parsed.subject}".\n\n` +
        "This auto-reply comes from an Agent running on Cloudflare Workers.",
      // 签名回复头，使后续回复继续路由回本实例
      secret: this.env.EMAIL_SECRET,
    });
  }

  /** 查看已收到的邮件（测试用） */
  @callable()
  async getEmails(): Promise<ReceivedEmail[]> {
    return this.state?.emails ?? [];
  }

  /** Agent 实例被 HTTP/WS 访问时（本 demo 未用前端，保留空实现即可） */
  override onConnect(connection: Connection) {
    console.log("Client connected:", connection.id);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── 测试端点：触发出站邮件 ──────────────────────────────────
    // GET /test-send?to=you@example.com
    if (url.pathname === "/test-send") {
      const to = url.searchParams.get("to");
      if (!to) return new Response("Missing ?to= parameter", { status: 400 });
      const stub = env.EmailAgent.get(env.EmailAgent.idFromName("support"));
      try {
        const result = await stub.sendWelcomeEmail(to);
        return Response.json({ ok: true, ...result });
      } catch (e) {
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }

    // ── 测试端点：查看已收到的邮件 ──────────────────────────────
    if (url.pathname === "/emails") {
      const stub = env.EmailAgent.get(env.EmailAgent.idFromName("support"));
      return Response.json(await stub.getEmails());
    }

    // /agents/... 路径交给 Agents SDK 路由（WebSocket、callable 等）
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },

  // ── 入站邮件入口：Cloudflare Email Service 路由到 Worker ──────
  async email(message, env) {
    // 组合 resolver：先验签（防伪造回复头），再按收件地址路由
    const secureReplyResolver = createSecureReplyEmailResolver(env.EMAIL_SECRET, {
      maxAge: 7 * 24 * 60 * 60, // 签名 7 天有效（默认 30 天）
      onInvalidSignature: (email, reason) => {
        console.warn(`Invalid signature from ${email.from}: ${reason}`);
      },
    });
    const addressResolver = createAddressBasedEmailResolver("EmailAgent");

    await routeAgentEmail(message, env, {
      resolver: async (email, env) => {
        // 首先检查是否为已签名的真实回复
        const replyRouting = await secureReplyResolver(email, env);
        if (replyRouting) return replyRouting;
        // 否则按收件地址路由：support@348349.xyz → 实例 "support"
        return addressResolver(email, env);
      },
      onNoRoute: (email) => {
        console.warn(`No route found for email from ${email.from}`);
        email.setReject("Unknown recipient");
      },
    });
  },
} satisfies ExportedHandler<Env>;
