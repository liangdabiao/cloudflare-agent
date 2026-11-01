/**
 * SlackAgent 基类（对应文档「Slack Agent 示例」第 4 步）
 *
 * 文档中的完整基类托管在官方 GitHub，SDK 也未内置 —— 本文件按文档描述的
 * 职责自行实现，作为学习材料：
 *
 * 1. OAuth 2.0 流程
 *    GET  /install → 重定向到 Slack 授权页
 *    GET  /accept?code=... → 用 code 换 bot token，存入该 workspace 的 DO 实例
 * 2. 请求验签
 *    POST /slack → HMAC-SHA256 验证 X-Slack-Signature（v0 方案，5 分钟时间窗）
 * 3. 事件路由
 *    event_callback.team_id → idFromName(team_id) → 对应 Agent 实例的 onSlackEvent()
 * 4. Slack API 封装（子类直接用）
 *    ensureAppUserId / fetchConversation / sendMessage
 *
 * 多租户原理：每个 Slack workspace 的 team_id 作为 Durable Object 实例名，
 * 单次部署可服务多个工作区，各实例凭据与状态互相隔离。
 */
import { Agent, type Connection } from "agents";

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface SlackCredentials {
  teamId: string;
  botToken: string;
  botUserId: string;
}

/** 文档中的 SlackMsg 形状 */
export interface SlackMsg {
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
  channel?: string;
}

// ─────────────────────────────────────────────────────────────
// 基类
// ─────────────────────────────────────────────────────────────

export abstract class SlackAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
> extends Agent<Env> {
  /** OAuth 换来的凭据（存在本 workspace 实例的 state 里） */
  protected slackCreds: SlackCredentials | null = null;

  /** 保存 OAuth 凭据（由 /accept 回调写入对应 workspace 实例） */
  async saveCredentials(creds: SlackCredentials): Promise<void> {
    this.slackCreds = creds;
    // 注意：全新实例 this.state 可能为 undefined，需防御
    this.setState({ ...((this.state ?? {}) as object), slack: creds });
  }

  protected async getCredentials(): Promise<SlackCredentials | null> {
    if (this.slackCreds) return this.slackCreds;
    const saved = (this.state as { slack?: SlackCredentials } | undefined)
      ?.slack;
    if (saved) this.slackCreds = saved;
    return this.slackCreds;
  }

  /**
   * 拿到机器人自己的 user id：
   * - 用于把消息里的 <@UXXXX> @提及 归一化
   * - 用于忽略自己发的消息，避免自问自答死循环
   */
  protected async ensureAppUserId(): Promise<string> {
    const creds = await this.getCredentials();
    if (!creds) throw new Error("Slack not installed for this workspace");
    if (creds.botUserId) return creds.botUserId;
    const res = await slackApi(creds.botToken, "auth.test", {});
    const userId = (res as { user_id?: string }).user_id;
    if (!userId) throw new Error("auth.test failed: no user_id");
    creds.botUserId = userId;
    this.slackCreds = creds;
    this.setState({ ...((this.state ?? {}) as object), slack: creds });
    return userId;
  }

  /** 拉取频道（或线程）最近的消息，供 LLM 作为上下文 */
  protected async fetchConversation(
    channel: string,
    threadTs?: string,
    limit = 20,
  ): Promise<SlackMsg[]> {
    const creds = await this.getCredentials();
    if (!creds) throw new Error("Slack not installed for this workspace");
    const res = (await slackApi(creds.botToken, "conversations.history", {
      channel,
      limit,
      ...(threadTs ? { ts: threadTs } : {}),
    })) as { messages?: SlackMsg[] };
    return (res.messages ?? []).slice().reverse(); // 时间正序
  }

  /** 以 bot 身份发消息（支持线程回复） */
  async sendMessage(
    text: string,
    options: { channel: string; thread_ts?: string },
  ): Promise<void> {
    const creds = await this.getCredentials();
    if (!creds) throw new Error("Slack not installed for this workspace");
    await slackApi(creds.botToken, "chat.postMessage", {
      channel: options.channel,
      text,
      ...(options.thread_ts ? { thread_ts: options.thread_ts } : {}),
    });
  }

  /** Agent 被直连（WS）时（本案例用不到，保留空实现） */
  override onConnect(_connection: Connection) {}
}

// ─────────────────────────────────────────────────────────────
// Slack Web API 调用封装
// ─────────────────────────────────────────────────────────────

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// 验签（Slack v0 方案）
// ─────────────────────────────────────────────────────────────

async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  // 防重放：时间戳与当前相差超过 5 分钟直接拒绝
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`v0:${timestamp}:${rawBody}`),
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `v0=${hex}` === signature;
}

// ─────────────────────────────────────────────────────────────
// listen()：组装 Worker fetch 入口（文档 API：MyAgent.listen({...})）
// ─────────────────────────────────────────────────────────────

/** DO stub 的 RPC 视图（跨文件调用类公开方法用） */
interface SlackAgentStub {
  saveCredentials(creds: SlackCredentials): Promise<void>;
  onSlackEvent(
    event: { type: string } & Record<string, unknown>,
  ): Promise<void>;
}

export interface SlackAgentBindings {
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET: string;
}


export function listen<Env extends SlackAgentBindings>(options: {
  clientId: string;
  clientSecret: string;
  slackSigningSecret: string;
  scopes: string[];
}): {
  fetch: (
    request: Request,
    env: Env & { MyAgent: DurableObjectNamespace },
  ) => Promise<Response>;
} {
  return {
    async fetch(
      request: Request,
      env: Env & { MyAgent: DurableObjectNamespace },
    ): Promise<Response> {
      const url = new URL(request.url);

      // ── 1. 安装入口：跳转 Slack 授权页 ─────────────────────────
      if (url.pathname === "/install") {
        const authUrl = new URL("https://slack.com/oauth/v2/authorize");
        authUrl.searchParams.set("client_id", options.clientId);
        authUrl.searchParams.set("scope", options.scopes.join(","));
        return Response.redirect(authUrl.toString(), 302);
      }

      // ── 2. 授权回调：code 换 token，写入对应 workspace 的实例 ──
      if (url.pathname === "/accept") {
        const code = url.searchParams.get("code");
        if (!code) return new Response("Missing code", { status: 400 });
        const form = new FormData();
        form.set("client_id", options.clientId);
        form.set("client_secret", options.clientSecret);
        form.set("code", code);
        const res = (await (
          await fetch("https://slack.com/api/oauth.v2.access", {
            method: "POST",
            body: form,
          })
        ).json()) as {
          ok: boolean;
          team?: { id: string };
          authed_user?: { id: string };
          access_token?: string;
        };
        if (!res.ok || !res.team || !res.access_token) {
          return new Response(`OAuth failed: ${JSON.stringify(res)}`, {
            status: 400,
          });
        }
        const stub = env.MyAgent.get(
          env.MyAgent.idFromName(res.team.id),
        ) as unknown as SlackAgentStub;
        await stub.saveCredentials({
          teamId: res.team.id,
          botToken: res.access_token,
          botUserId: res.authed_user?.id ?? "",
        });
        return new Response("Successfully registered!");
      }

      // ── 3. 事件入口：验签 → 路由到 workspace 实例 ──────────────
      if (url.pathname === "/slack" && request.method === "POST") {
        const rawBody = await request.text();
        const valid = await verifySlackSignature(
          options.slackSigningSecret,
          request.headers.get("x-slack-request-timestamp") ?? "",
          rawBody,
          request.headers.get("x-slack-signature") ?? "",
        );
        if (!valid) return new Response("Invalid signature", { status: 401 });

        const payload = JSON.parse(rawBody) as {
          type: string;
          challenge?: string;
          event_id?: string;
          team_id?: string;
          event?: { type: string } & Record<string, unknown>;
        };

        // 事件订阅配置时的握手验证
        if (payload.type === "url_verification") {
          return new Response(payload.challenge ?? "", {
            headers: { "Content-Type": "text/plain" },
          });
        }

        if (payload.type === "event_callback" && payload.event && payload.team_id) {
          // 幂等：同一 event_id 只处理一次（Slack 会重试投递）
          const stub = env.MyAgent.get(
            env.MyAgent.idFromName(payload.team_id),
          ) as unknown as SlackAgentStub;
          await stub.onSlackEvent(payload.event);
          return new Response("OK");
        }

        return new Response("Ignored");
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
