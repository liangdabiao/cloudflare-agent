/**
 * 服务端：浏览器 Agent（对应文档「Browser Agent 示例」+「直接使用 Puppeteer」章节）
 *
 * ⚠️ 方案选型（Free 计划实测结论）：
 * - 文档主推的 Code Mode 方案（createBrowserTools + worker_loaders 沙箱）
 *   依赖 Dynamic Workers，部署时报错 10195：**需要 Workers 付费计划**。
 * - Free 计划按文档「直接使用 Puppeteer」章节实现：
 *   用 @cloudflare/puppeteer 驱动 Browser Rendering 绑定，
 *   把固定操作封装成 tool 交给 LLM 编排——能力相同（浏览/检查/截图/求值），
 *   区别是 LLM 选择工具而非亲手写 CDP 代码。
 * - 付费后想升级 Code Mode：装回 @cloudflare/codemode、加 worker_loaders、
 *   换 createBrowserTools 即可（见 git 历史或官方文档）。
 *
 * 核心概念：
 * - puppeteer.launch(this.env.BROWSER)：从 Browser Rendering 绑定启动浏览器实例
 * - 每个工具内部：启动浏览器 → 操作 → browser.close()（及时释放免费额度）
 * - Free 计划有每日浏览器时长限制，测试足够、别拿去当爬虫
 */
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createAI } from "agents/models/ai-sdk";
import puppeteer from "@cloudflare/puppeteer";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
} from "ai";
import { z } from "zod";

/**
 * Free 计划浏览器节流重试：
 * Browser Rendering Free 限制 = 每天 10 分钟时长、每 20 秒最多启动 1 个新浏览器。
 * 撞上 429/节流时等一个窗口再试一次。
 */
async function withBrowserRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|rate|limit|too many/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 21000));
      return fn();
    }
    throw e;
  }
}

/** 轻量打开策略：DOM 就绪即可（省免费额度），正文读取由 waitForSelector 兜底 */
const GOTO_OPTIONS = { waitUntil: "domcontentloaded" as const, timeout: 30000 };

export class BrowserAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const ai = createAI({ binding: this.env.AI });

    const result = streamText({
      // Free 计划可用模型。注：实测 llama-4-scout 在多步工具循环中会把
      // 工具调用写成正文文本（结构化 tool call 丢失），换 glm-4.7-flash 更稳
      model: ai("@cf/zai-org/glm-4.7-flash"),
      system:
        "You are a web browsing assistant. Use the browser tools to open " +
        "web pages and inspect their content.\n" +
        "Flow: call browser_open first, then browser_content to read text, " +
        "or browser_eval for custom JS. Always say which URL you visited. " +
        "Keep answers concise.",
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // 打开页面：返回标题 / 描述 / 状态码
        browser_open: tool({
          description: "Open a web page in a real browser and get its title and meta description.",
          inputSchema: z.object({
            url: z.string().describe("Page URL to open"),
          }),
          execute: async ({ url }) => {
            return withBrowserRetry(async () => {
              const browser = await puppeteer.launch(this.env.BROWSER);
              try {
                const page = await browser.newPage();
                const response = await page.goto(url, GOTO_OPTIONS);
                // 给轻量页面一点渲染时间（比 networkidle 省额度）
                await new Promise((r) => setTimeout(r, 1500));
                const title = await page.title();
                const description = await page
                  .$eval('meta[name="description"]', (el) =>
                    el.getAttribute("content"),
                  )
                  .catch(() => null);
                return {
                  url,
                  status: response?.status() ?? null,
                  title,
                  description,
                };
              } finally {
                // 及时关闭，释放免费计划的浏览器时长
                await browser.close();
              }
            });
          },
        }),

        // 读取页面正文（截断到 4000 字符，防上下文爆炸）
        browser_content: tool({
          description:
            "Open a web page and return its visible body text (truncated to 4000 chars).",
          inputSchema: z.object({
            url: z.string().describe("Page URL to read"),
          }),
          execute: async ({ url }) => {
            return withBrowserRetry(async () => {
              const browser = await puppeteer.launch(this.env.BROWSER);
              try {
                const page = await browser.newPage();
                await page.goto(url, GOTO_OPTIONS);
                await page.waitForSelector("body");
                const text = await page.$eval(
                  "body",
                  (el) => el.innerText,
                );
                return {
                  url,
                  length: text.length,
                  text: text.slice(0, 4000),
                  truncated: text.length > 4000,
                };
              } finally {
                await browser.close();
              }
            });
          },
        }),

        // 自定义 JS 求值：接近 Code Mode 的灵活性（仍是固定工具，非 LLM 写码）
        browser_eval: tool({
          description:
            "Open a web page, run a JS snippet in the page context and return its JSON-serializable result. Use document.querySelector etc.",
          inputSchema: z.object({
            url: z.string().describe("Page URL to load"),
            js: z
              .string()
              .describe(
                "JS expression to evaluate in the page, e.g. JSON.stringify([...document.querySelectorAll('h2')].map(h => h.textContent))",
              ),
          }),
          execute: async ({ url, js }) => {
            return withBrowserRetry(async () => {
              const browser = await puppeteer.launch(this.env.BROWSER);
              try {
                const page = await browser.newPage();
                await page.goto(url, GOTO_OPTIONS);
                await page.waitForSelector("body");
                // eval 是本工具的设计目的（在目标页面执行 LLM 给的查询代码）
                const value = await page.evaluate(js);
                return { url, result: value };
              } finally {
                await browser.close();
              }
            });
          },
        }),
      },
      // 浏览器任务链路长，放宽到 8 步
      stopWhen: stepCountIs(8),
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
} satisfies ExportedHandler<Env>;
