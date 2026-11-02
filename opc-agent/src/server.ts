/**
 * 服务端：OPC 经营 Agent（第 7 个案例）
 *
 * 来源：opc-ops skill（https://github.com/liangdabiao/opc-ops-skill）
 * 架构映射：
 *   skill 的"渐进式加载"    → Stage Router 判定阶段 → 只注入该阶段 reference
 *   skill 的 scripts/*.py   → 移植为确定性 tool（0 LLM 成本，结果可复现）
 *   skill 的 assets/*.md    → 模板引擎（原文件 1:1 同步，占位符填充）
 *   skill 缺失的"记忆"      → 项目工作台（DO SQLite 持久化多项目）
 *
 * 关键设计：金额与风险判断**绝不交给模型**。LLM 只负责判断话术潜台词、
 * 给结论、写话术——这才是不烧额度又不出错的做法。
 */
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest, callable } from "agents";
import { createAI } from "agents/models/ai-sdk";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
} from "ai";
import { z } from "zod";

import { scanText, buildRiskReport } from "./lib/risk-scan";
import { splitDeal, settleDeal, maintainDeal } from "./lib/deal-calc";
import {
  routeStage,
  routeCandidates,
  STAGES,
  type Stage,
} from "./lib/stage-router";
import { extractProject } from "./lib/extract-project";
import {
  renderTemplate,
  listPlaceholders,
  suggestFileName,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
} from "./lib/templates";
import { DATA as REFERENCES } from "./knowledge/references-data";
import { SKILL_MD } from "./knowledge/skill-data";
import type { OpcState, Project, UpsertProjectInput } from "./lib/types";

/** 单次注入的知识上限（字符），防止提示过长烧 Neurons */
const KNOWLEDGE_BUDGET = 7000;

/** 精简版核心（general 阶段用，避免注入整份 SKILL.md） */
const CORE_PRINCIPLES = `
## 五条底层原则
1. 风险在决定接单那一刻就已确定。先筛客户，再谈方案。
2. 定金不到账 = 项目没开始。不做前置投入，不给任何代码。
3. 一切以书面为准。口头承诺不算。
4. 付款与交付交替进行。
5. 边界先定死：范围、期限、售后。

## 接单交付主流程
B1 线索筛选 → B2 报价分期 → B3 合同 → B4 收定金 → B5 需求确认
→ B6 周报 → B7 中期交付+中期款 → B8 交付四件套 → B9 验收 → B10 尾款 → B11 售后边界

## 金额基准
默认 50% / 30% / 20%（定金/中期/尾款）；大额或首次合作 30/40/30。
定金下限 30%，不接受先做后付。维护报价 = 项目总价 5%~10%/月，按季度签。
`.trim();

/** 按阶段取知识（截断到预算内） */
function knowledgeFor(stageId: Stage): string {
  const meta = STAGES[stageId];
  if (!meta.reference) return CORE_PRINCIPLES;
  const raw = REFERENCES[meta.reference] ?? "";
  if (raw.length <= KNOWLEDGE_BUDGET) return raw;
  return raw.slice(0, KNOWLEDGE_BUDGET) + "\n\n（知识已截断，需要细节请追问）";
}

function projectBrief(p?: Project | null): string {
  if (!p) return "（当前没有选中的项目；用户提到项目信息时可主动用 save_project 建档）";
  return [
    `- 项目ID: ${p.id}`,
    `- 客户: ${p.clientName}`,
    `- 项目: ${p.title}`,
    `- 合同额: ¥${p.total.toLocaleString("en-US")}`,
    `- 分期: ${p.plan}`,
    `- 已收: ¥${p.received.toLocaleString("en-US")}`,
    `- 当前阶段: ${p.stage} ${STAGES[p.stage]?.label ?? ""}`,
    p.notes ? `- 备注: ${p.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class OpcAgent extends AIChatAgent<Env, OpcState> {
  private get projects(): Project[] {
    return this.state?.projects ?? [];
  }

  private get activeProject(): Project | null {
    const id = this.state?.activeId;
    if (!id) return this.projects[0] ?? null;
    return this.projects.find((p) => p.id === id) ?? null;
  }

  private saveProjects(projects: Project[], activeId?: string) {
    this.setState({
      ...((this.state ?? {}) as object),
      projects,
      activeId: activeId ?? this.state?.activeId,
    } as OpcState);
  }

  // ─────────────────────────────────────────────────────────────
  // 工作台（@callable：前端面板直接调用）
  // ─────────────────────────────────────────────────────────────

  @callable()
  async listProjects(): Promise<Project[]> {
    return this.projects;
  }

  @callable()
  async upsertProject(input: UpsertProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const existing = input.id
      ? this.projects.find((p) => p.id === input.id)
      : this.projects.find(
          (p) => p.clientName === input.clientName && p.title === input.title,
        );

    if (existing) {
      const updated: Project = {
        ...existing,
        ...input,
        plan: input.plan ?? existing.plan,
        stage: input.stage ?? existing.stage,
        received: input.received ?? existing.received,
        updatedAt: now,
      };
      this.saveProjects(
        this.projects.map((p) => (p.id === existing.id ? updated : p)),
        updated.id,
      );
      return updated;
    }

    const project: Project = {
      id: crypto.randomUUID().slice(0, 8),
      clientName: input.clientName,
      title: input.title,
      total: input.total,
      plan: input.plan ?? "50/30/20",
      stage: input.stage ?? "B1",
      received: input.received ?? 0,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    this.saveProjects([...this.projects, project], project.id);
    return project;
  }

  @callable()
  async setActiveProject(id: string): Promise<boolean> {
    if (!this.projects.some((p) => p.id === id)) return false;
    this.setState({ ...((this.state ?? {}) as object), activeId: id } as OpcState);
    return true;
  }

  @callable()
  async deleteProject(id: string): Promise<boolean> {
    const next = this.projects.filter((p) => p.id !== id);
    if (next.length === this.projects.length) return false;
    this.setState({
      ...((this.state ?? {}) as object),
      projects: next,
      activeId: this.state?.activeId === id ? next[0]?.id : this.state?.activeId,
    } as OpcState);
    return true;
  }

  @callable()
  async renderDoc(
    template: string,
    vars: Record<string, string>,
    clientName = "客户",
  ): Promise<{ content: string; missing: string[]; fileName: string }> {
    const { content, missing } = renderTemplate(template, vars);
    return {
      content,
      missing,
      fileName: suggestFileName(template, clientName),
    };
  }

  @callable()
  async detectStage(text: string): Promise<{ id: Stage; label: string }> {
    const s = routeStage(text);
    return { id: s.id, label: s.label };
  }

  /** 供 UI 查看：某阶段注入给模型的知识原文 */
  @callable()
  async getKnowledge(stageId: Stage): Promise<{
    label: string;
    actions: string[];
    content: string;
  }> {
    const meta = STAGES[stageId] ?? STAGES.general;
    return {
      label: meta.label,
      actions: meta.actions,
      content: knowledgeFor(meta.id),
    };
  }

  /** 供 UI 查看：完整方法论目录（skill 原文的章节标题） */
  @callable()
  async getPlaybookOutline(): Promise<string[]> {
    return SKILL_MD.split("\n")
      .filter((l) => /^#{2,3}\s/.test(l))
      .map((l) => l.replace(/^#{2,3}\s*/, ""));
  }

  // ─────────────────────────────────────────────────────────────
  // 聊天：注入阶段知识 + 确定性工具
  // ─────────────────────────────────────────────────────────────

  async onChatMessage() {
    const ai = createAI({ binding: this.env.AI });

    // 用最后一条用户消息判定阶段（渐进式加载：只注入这一阶段的知识）
    const lastUser = [...this.messages]
      .reverse()
      .find((m) => m.role === "user");
    const lastText =
      lastUser?.parts
        ?.map((p) => (p.type === "text" ? p.text : ""))
        .join(" ") ?? "";
    // 阶段：只给**候选线索**，判断权留给模型（模糊表述下关键词必然误判）
    const candidates = routeCandidates(lastText);
    const primary = candidates[0].meta;

    // 确定性建档：命中「客户名 + 金额」就落库（不依赖模型判断，避免漏建）
    const extracted = extractProject(lastText);
    if (
      extracted &&
      !this.projects.some((p) => p.clientName === extracted.clientName)
    ) {
      await this.upsertProject(extracted);
    }

    const candidateLines = candidates
      .map(
        (c) =>
          `- ${c.meta.id} ${c.meta.label}（关键词命中 ${c.score} 次）` +
          (c.meta.actions.length
            ? `：${c.meta.actions.join("；")}`
            : ""),
      )
      .join("\n");

    const system = `你是「OPC 经营与接单交付」顾问，服务对象是接私活/做外包的独立开发者。
你的价值不是帮人写代码，而是帮用户在正确的时点做正确的动作、留下正确的书面痕迹。

${CORE_PRINCIPLES}

## 阶段线索（仅供参考，不是路由指令）
${candidateLines}

这些只是关键词匹配出来的**可能方向**，不是答案。用户的话大多是模糊的：
「整体还行，但那个啥你再改改」既可能是验收、也可能是变更、还可能是压价——
**最终由你判断**，你可以改判、同时覆盖多个阶段、指出判断依据，或者干脆先反问一句。
用户的处境比编号重要。

## 当前项目
${projectBrief(this.activeProject)}

## 起步知识（下面是与你可能相关的阶段资料；不够用就调 read_reference 取）
${knowledgeFor(primary.id)}

## 工具使用规则（重要）
- 涉及金额拆分/结算/维护报价 → 必须调用 calc_deal，**绝不自己算**
- 风险扫描 → 调 scan_client_risk，但它只是**文本匹配的初步信号**：
  它给的红线/正向是线索，最终"接不接"要结合三问（预算数字 / 时间点 / 可量化效果）
  和你对语气的理解来判断。你对它的机械结论有异议时，说明理由后按你的判断说，
  并把"脚本命中什么、你为什么不完全同意"讲清楚。
- 需要某个阶段的详细资料（合同条款、交付流程、经营打法…）→ 调 read_reference
- 涉及生成合同/报价单/需求文档/周报/验收清单等 → 必须调用 render_doc
- 生成文档的正确做法：**先用已知信息生成草稿**（未提供的占位符会原样保留），
  再把工具返回的 missing 清单一次性问用户补齐。
  不要因为缺几条信息就完全不生成——用户要的是能马上改的底稿。
- 用户提到客户名称与金额 → 可调 save_project 补全项目档案
- 工具返回什么就基于什么说，不要把自己的估算说成工具结果

## 输出方式
接单/交付类问题，通常按这个顺序说会更清楚：
判断结论 → 现在该做哪几步 → 要产出什么（能调工具就调工具）→ 一句话点明最该防的那条风险。
但**不要机械套模板**：用户只是随口问一句、或者情况还没清楚时，
先用一两句话把关键点说透、必要时反问，比凑齐四段更有价值。

## 语气与边界
- 直接、可执行、不绕弯。用户问"要不要接"就给明确结论和理由，不要罗列一堆"取决于"。
- 但不要在用户没问的时候把整套 SOP 倒出来——只给当下用得上的那几步。
- 合同/条款是结构与清单参考，不构成法律意见；涉及签约时提醒找律师复核。
- 金额交给工具算。`;

    const result = streamText({
      model: ai("@cf/zai-org/glm-4.7-flash"),
      system,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // ── 确定性工具 1：客户风险扫描（25 条规则，0 LLM 成本）──
        scan_client_risk: tool({
          description:
            "扫描客户沟通记录原文，命中红线/需留意/正向信号并给出「接/不接/条件接」结论。涉及判断客户是否靠谱时必须先调用。",
          inputSchema: z.object({
            text: z
              .string()
              .describe("客户沟通记录原文，一行一句，可多行"),
          }),
          execute: async ({ text }) => buildRiskReport(scanText(text)),
        }),

        // ── 确定性工具 2：金额计算 ──
        calc_deal: tool({
          description:
            "计算分期金额（split）/ 中途叫停结算（settle）/ 维护报价（maintain）。任何金额问题都必须调用，不要自己算。",
          inputSchema: z.object({
            op: z
              .enum(["split", "settle", "maintain"])
              .describe("split=分期拆分, settle=中途结算, maintain=维护报价"),
            total: z.number().describe("合同总额（元）"),
            plan: z
              .string()
              .optional()
              .describe("分期比例，默认 50/30/20，可写 30/40/30"),
            progress: z
              .number()
              .optional()
              .describe("settle 用：已完成进度 0~100"),
            cost: z.number().optional().describe("settle 用：未摊销的前期成本（元）"),
            received: z.number().optional().describe("settle 用：已收款项（元）"),
          }),
          execute: async ({ op, total, plan, progress, cost, received }) => {
            if (op === "split") return splitDeal(total, plan ?? "50/30/20");
            if (op === "maintain") return maintainDeal(total);
            return settleDeal({
              total,
              progress: progress ?? 0,
              cost,
              received,
            });
          },
        }),

        // ── 确定性工具 3：模板生成 ──
        render_doc: tool({
          description:
            "用官方模板生成交付文档（合同大纲/报价单/需求文档/周报/中期确认单/验收清单/结项报告/维护合同）。占位符未填会返回 missing 清单。",
          inputSchema: z.object({
            template: z
              .enum(TEMPLATE_KEYS as [string, ...string[]])
              .describe(
                "模板标识：" +
                  Object.entries(TEMPLATE_LABELS)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("，"),
              ),
            vars: z
              .record(z.string(), z.string())
              .describe("占位符变量，键为模板里的 {{名称}}"),
            clientName: z.string().optional().describe("客户名，用于文件名"),
          }),
          execute: async ({ template, vars, clientName }) => {
            const { content, missing } = renderTemplate(template, vars);
            return {
              template,
              fileName: suggestFileName(template, clientName ?? "客户"),
              missing,
              placeholderHint:
                missing.length > 0
                  ? "这些占位符还没填，请向用户确认后重新调用，不要留空交付"
                  : undefined,
              content,
            };
          },
        }),

        // ── 工具 4：项目建档/更新 ──
        save_project: tool({
          description:
            "保存或更新项目档案（客户、项目名、合同额、分期、阶段、已收款项）。用户提到具体项目信息时调用，便于后续追踪。",
          inputSchema: z.object({
            id: z.string().optional().describe("已有项目 id，更新时传"),
            clientName: z.string(),
            title: z.string(),
            total: z.number().describe("合同总额（元）"),
            plan: z.string().optional(),
            stage: z
              .enum(Object.keys(STAGES) as [string, ...string[]])
              .optional()
              .describe("阶段，如 B1~B11"),
            received: z.number().optional().describe("已收款项（元）"),
            notes: z.string().optional(),
          }),
          execute: async (input) => {
            const project = await this.upsertProject(input as UpsertProjectInput);
            return {
              saved: true,
              projectId: project.id,
              stage: project.stage,
              summary: projectBrief(project),
            };
          },
        }),

        // ── 工具 5：按需取资料（渐进式加载由模型自己决定，而不是关键词）──
        read_reference: tool({
          description:
            "读取某个阶段的详细手册（客户筛选/合同与付款/交付与验收/一人公司打法）。当当前注入的知识不够、或用户的问题跨了多个阶段时调用。",
          inputSchema: z.object({
            name: z
              .enum(Object.keys(REFERENCES) as [string, ...string[]])
              .describe(
                "client-screening=客户筛选与红线, contract-and-payment=报价合同定金, delivery-and-acceptance=需求交付验收尾款, opc-playbook=一人公司方向与复盘",
              ),
          }),
          execute: async ({ name }) => {
            const raw = REFERENCES[name] ?? "";
            return {
              name,
              chars: raw.length,
              content:
                raw.length > 8000
                  ? raw.slice(0, 8000) + "\n\n（已截断）"
                  : raw,
            };
          },
        }),

        list_placeholders: tool({
          description:
            "查看某个模板需要填哪些占位符（生成文档前调用，先问用户要这些信息）。",
          inputSchema: z.object({
            template: z.enum(TEMPLATE_KEYS as [string, ...string[]]),
          }),
          execute: async ({ template }) => ({
            template,
            placeholders: listPlaceholders(template),
          }),
        }),
      },
      stopWhen: stepCountIs(6),
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
