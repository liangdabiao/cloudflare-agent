/**
 * 客户端：浏览器 Agent 聊天界面（复用 chat-agent 的模式）
 *
 * - useAgent：WebSocket 连接 BrowserAgent（Durable Object）
 * - useAgentChat：消息、流式渲染、tool 结果展示
 * - tool 结果通过 <details> 折叠展示（页面内容可能很长）
 */
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ToolPart = ToolUIPart | DynamicToolUIPart;

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return "toolCallId" in part && "state" in part;
}

/** ai v7 中静态 tool 名称在 part.type（"tool-xxx"）里 */
function toolDisplayName(part: ToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

const SUGGESTIONS = [
  "Open https://example.com and tell me the page title and heading.",
  "Summarize https://blog.cloudflare.com in 3 bullet points.",
];

function Chat() {
  const agent = useAgent({ agent: "BrowserAgent" });

  const { messages, sendMessage, clearHistory, status } = useAgentChat({
    agent,
  });

  return (
    <div className="app">
      <header>
        <h1>Cloudflare Browser Agent</h1>
        <p className="subtitle">
          Code Mode · LLM 写 CDP 代码操作真实浏览器 · 会话持久化
        </p>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p>试试这些 prompt：</p>
            <ul>
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    className="suggestion"
                    onClick={() => sendMessage({ text: s })}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg: UIMessage) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong>
            {msg.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <span key={i} className="text">
                    {part.text}
                  </span>
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
          sendMessage({ text: input.value });
          input.value = "";
        }}
      >
        <input
          name="message"
          placeholder="让 Agent 打开并检查任意网页…"
          autoFocus
        />
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
