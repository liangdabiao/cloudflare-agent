/**
 * 客户端：RAG Agent 界面 = 聊天 + 知识库管理面板
 *
 * - useAgentChat：聊天与流式渲染（与 chat-agent 同款）
 * - agent.call("addDocument", ...)：调用服务端 @callable 方法管理知识库
 * - tool 结果卡片展示检索到的片段与相似度分数（RAG 的可解释性）
 */
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderMarkdown } from "./lib/markdown";
import "./styles.css";

type ToolPart = ToolUIPart | DynamicToolUIPart;

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return "toolCallId" in part && "state" in part;
}

function toolDisplayName(part: ToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

interface KbDoc {
  docId: string;
  title: string;
  chunks: number;
  createdAt: string;
}

/** untyped agent 的 call 签名（调用服务端 @callable 方法；args 数组展开为方法参数） */
interface AgentCaller {
  call: (method: string, args?: unknown[]) => Promise<unknown>;
}

function KnowledgeBase({ agent }: { agent: AgentCaller }) {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = () => {
    agent.call("listDocuments")
      .then((r) => setDocs(r as KbDoc[]))
      .catch(() => setDocs([]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  const add = async () => {
    if (!title.trim() || !text.trim() || busy) return;
    setBusy(true);
    setMsg("嵌入并入库中…（分块 → bge-m3 向量化 → Vectorize）");
    try {
      const r = (await agent.call("addDocument", [title.trim(), text.trim()])) as {
        chunks: number;
      };
      setMsg(`✅ 已入库：${r.chunks} 个分块`);
      setTitle("");
      setText("");
      refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (docId: string) => {
    setBusy(true);
    try {
      await agent.call("deleteDocument", [docId]);
      refresh();
      setMsg("✅ 已删除（向量 + 原文）");
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb">
      <h2>📚 知识库管理</h2>
      <div className="kb-form">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴文档内容（自动分块 500 字符/50 重叠，中英文均可——bge-m3 多语言嵌入）"
          rows={4}
        />
        <button onClick={add} disabled={busy || !title.trim() || !text.trim()}>
          添加到知识库
        </button>
        <span className="kb-msg">{msg}</span>
      </div>
      {docs.length > 0 && (
        <ul className="kb-list">
          {docs.map((d) => (
            <li key={d.docId}>
              <span>
                <strong>{d.title}</strong> · {d.chunks} 个分块 ·{" "}
                {new Date(d.createdAt).toLocaleString()}
              </span>
              <button
                className="delete"
                disabled={busy}
                onClick={() => remove(d.docId)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chat() {
  const agent = useAgent({ agent: "RagAgent" });
  const toolRoundsRef = useRef(0);

  const { messages, sendMessage, clearHistory, status } = useAgentChat({
    agent,
  });

  return (
    <div className="app">
      <header>
        <h1>Cloudflare RAG Agent</h1>
        <p className="subtitle">
          Agentic RAG · Workers AI (bge-m3) 嵌入 · Vectorize 相似度检索 ·
          检索做成 Agent 工具
        </p>
      </header>

      <KnowledgeBase agent={agent as unknown as AgentCaller} />

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p>先在上面添加文档，然后提问试试：</p>
            <ul>
              <li>「这个项目是做什么的？」</li>
              <li>「总结一下知识库里关于 XX 的内容」</li>
            </ul>
            <p>
              观察工具卡片 <code>search_knowledge_base result</code>
              ——那就是向量检索返回的片段和相似度分数。
            </p>
          </div>
        )}

        {messages.map((msg: UIMessage) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong>
            {msg.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div
                    key={i}
                    className="md"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(part.text),
                    }}
                  />
                );
              }
              if (isToolPart(part) && part.state === "output-available") {
                return (
                  <details key={part.toolCallId} className="tool-result">
                    <summary>{toolDisplayName(part)} result</summary>
                    <pre>
                      {JSON.stringify(part.output, null, 2).slice(0, 2000)}
                    </pre>
                  </details>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("message");
          if (!(input instanceof HTMLInputElement) || !input.value.trim())
            return;
          toolRoundsRef.current = 0;
          sendMessage({ text: input.value });
          input.value = "";
        }}
      >
        <input name="message" placeholder="基于知识库提问…" autoFocus />
        <button type="submit" disabled={status === "streaming"}>
          {status === "streaming" ? "…" : "Send"}
        </button>
        <button type="button" className="clear" onClick={clearHistory}>
          Clear
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
);
