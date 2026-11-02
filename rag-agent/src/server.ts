/**
 * 服务端：RAG Agent（基于 RAG Workers AI + Vectorize 教程 + 本仓库 Agent 风格）
 *
 * 架构（Agentic RAG：检索做成 Agent 的工具，由模型决定何时检索）：
 *
 *   入库（@callable addDocument）
 *     文本 → splitText 分块(500字符/50重叠) → AI.run("@cf/baai/bge-m3") 批量嵌入
 *     → VECTORIZE.upsert(向量+metadata) + DO SQLite 存原文与向量 id
 *
 *   查询（tool search_knowledge_base）
 *     问题 → 嵌入 → VECTORIZE.query(topK=5) → 过滤低分 → 返回片段+分数
 *     → LLM 基于检索内容作答（要求引用来源、允许说不知道）
 *
 *   删除（@callable deleteDocument）
 *     VECTORIZE.deleteByIds(该文档全部向量 id) + 删 DO 记录
 *
 * 知识库要点：
 * - 嵌入模型用 bge-m3（1024 维，多语言）而非教程的 bge-base-en-v1.5（英文优化），
 *   中文知识库检索效果显著更好；维度必须与索引一致（1024）
 * - 教程用 D1 + Workflows 做异步向量化；本仓库 demo 规模直接同步处理，
 *   原文存 Agent 的 SQLite（免引 D1）；大批量导入再升级 Workflows（见 README）
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

/** 嵌入模型（bge-m3 多语言，1024 维——与 Vectorize 索引维度一致） */
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** 分块参数（与教程一致：500 字符、50 重叠） */
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

/** 知识库文档（存 Agent state，SQLite 持久化） */
interface KbDocument {
  docId: string;
  title: string;
  text: string;
  chunks: number;
  vectorIds: string[];
  createdAt: string;
}

/** 简单分块：滑动窗口（对中英文都按字符切，demo 足够） */
function splitText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
  }
  return chunks.filter((c) => c.trim().length > 0);
}

export class RagAgent extends AIChatAgent<Env, { docs: KbDocument[] }> {
  /** 批量嵌入：调用 Workers AI 嵌入模型，返回向量数组 */
  private async embed(texts: string[]): Promise<number[][]> {
    const result = (await this.env.AI.run(EMBEDDING_MODEL, {
      text: texts,
    })) as { data?: number[][] };
    if (!result.data || result.data.length !== texts.length) {
      throw new Error(`Embedding failed: got ${result.data?.length} of ${texts.length}`);
    }
    return result.data;
  }

  // ─────────────────────────────────────────────────────────────
  // 知识库管理（@callable：客户端经 agent.call() 调用）
  // ─────────────────────────────────────────────────────────────

  /** 添加文档：分块 → 嵌入 → 向量入库 + 原文存 state */
  @callable()
  async addDocument(title: string, text: string): Promise<{ docId: string; chunks: number }> {
    if (!text.trim()) throw new Error("Document text is empty");

    const docId = crypto.randomUUID();
    const chunks = splitText(text);

    // 批量嵌入（bge-m3 单次最多 100 条文本，demo 规模一次够用）
    const vectors = await this.embed(chunks);

    // 向量入库：id 规则 "{docId}-{chunkIndex}"，
    // metadata 带标题与分块原文——查询时 returnMetadata:"all" 直接取回内容
    await this.env.VECTORIZE.upsert(
      chunks.map((chunk, i) => ({
        id: `${docId}-${i}`,
        values: vectors[i],
        metadata: { docId, title, chunkIndex: i, text: chunk },
      })),
    );

    // 原文与向量 id 存 state（SQLite 持久化，删除时要按 id 清理向量）
    const docs: KbDocument[] = this.state?.docs ?? [];
    docs.push({
      docId,
      title,
      text,
      chunks: chunks.length,
      vectorIds: chunks.map((_, i) => `${docId}-${i}`),
      createdAt: new Date().toISOString(),
    });
    this.setState({ ...((this.state ?? {}) as object), docs });

    return { docId, chunks: chunks.length };
  }

  /** 列出知识库文档 */
  @callable()
  async listDocuments(): Promise<Array<Pick<KbDocument, "docId" | "title" | "chunks" | "createdAt">>> {
    return (this.state?.docs ?? []).map(({ docId, title, chunks, createdAt }) => ({
      docId,
      title,
      chunks,
      createdAt,
    }));
  }

  /** 删除文档：向量 + 原文一起删 */
  @callable()
  async deleteDocument(docId: string): Promise<{ ok: boolean }> {
    const docs: KbDocument[] = this.state?.docs ?? [];
    const doc = docs.find((d) => d.docId === docId);
    if (!doc) throw new Error(`Document ${docId} not found`);

    await this.env.VECTORIZE.deleteByIds(doc.vectorIds);
    this.setState({
      ...((this.state ?? {}) as object),
      docs: docs.filter((d) => d.docId !== docId),
    });
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────
  // 聊天：RAG 检索做成工具（Agentic RAG）
  // ─────────────────────────────────────────────────────────────

  async onChatMessage() {
    const ai = createAI({ binding: this.env.AI });

    const result = streamText({
      model: ai("@cf/zai-org/glm-4.7-flash"),
      system:
        "You are a knowledge-base assistant. Use the search_knowledge_base tool " +
        "to look up relevant passages BEFORE answering questions about the " +
        "documents.\n" +
        "Rules:\n" +
        "- Answer ONLY based on retrieved content; cite which document (title) " +
        "each fact comes from.\n" +
        "- If retrieval returns nothing relevant, say you don't know — do not " +
        "make things up.\n" +
        "- For greetings or small talk, no retrieval is needed.",
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // RAG 检索工具：模型自主决定何时检索（Agentic RAG 的核心）
        search_knowledge_base: tool({
          description:
            "Search the user's knowledge base for passages relevant to a query. " +
            "Call this before answering any question about the documents.",
          inputSchema: z.object({
            query: z.string().describe("Search query, key facts or question"),
          }),
          execute: async ({ query }) => {
            // 问题 → 向量 → topK 相似度搜索
            const [queryVector] = await this.embed([query]);
            const res = await this.env.VECTORIZE.query(queryVector, {
              topK: 5,
              returnMetadata: "all",
            });

            // 过滤低分结果（bge-m3 余弦分数分布较宽，取 0.4 兜底，交给 LLM 判断相关性）
            const matches = (res.matches ?? [])
              .filter((m) => m.score > 0.4)
              .map((m) => ({
                score: Number(m.score.toFixed(3)),
                title: (m.metadata as { title?: string })?.title ?? "unknown",
                text: (m.metadata as { text?: string })?.text ?? "",
              }));

            return {
              matchCount: matches.length,
              matches,
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
} satisfies ExportedHandler<Env>;
