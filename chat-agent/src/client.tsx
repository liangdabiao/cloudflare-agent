/**
 * 客户端：React 聊天界面（对应文档「聊天 Agent 示例」第 4 步）
 *
 * 核心概念：
 * - useAgent：通过 WebSocket 连接到 ChatAgent（Durable Object）
 * - useAgentChat：管理聊天生命周期 —— 消息、流式渲染、tool 调用、断线恢复
 * - onToolCall：处理「客户端 tool」—— LLM 调用无 execute 的 tool 时，
 *   浏览器在这里提供结果，返回后对话自动继续
 * - addToolApprovalResponse：批准 / 拒绝 needsApproval 的 tool
 */
import { useAgent } from "agents/react";
import { useAgentChat, getToolApproval } from "@cloudflare/ai-chat/react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/** tool 类型的消息 part（含审批状态），用于渲染审批 UI 与 tool 结果 */
type ToolPart = ToolUIPart | DynamicToolUIPart;

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return "toolCallId" in part && "state" in part;
}

/**
 * 取 tool 名称：ai v7 中静态 tool 的名称编码在 part.type（"tool-xxx"）里，
 * 动态 tool 才有 toolName 字段。
 */
function toolDisplayName(part: ToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

function Chat() {
  // agent: "ChatAgent" 对应 wrangler.jsonc 中注册的 Durable Object 绑定名
  const agent = useAgent({ agent: "ChatAgent" });

  const {
    messages,
    sendMessage,
    clearHistory,
    addToolApprovalResponse,
    status,
  } = useAgentChat({
    agent,
    // 处理客户端侧 tool（即服务端没有 execute 函数的 tool）
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName === "getUserTimezone") {
        addToolOutput({
          toolCallId: toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString(),
          },
        });
      }
    },
  });

  return (
    <div className="app">
      <header>
        <h1>Cloudflare 聊天 Agent</h1>
        <p className="subtitle">
          流式响应 · 服务端/客户端/审批 三类 tool · SQLite 消息持久化
        </p>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p>试试这些 prompt：</p>
            <ul>
              <li>What is the weather in Tokyo?（服务端 tool）</li>
              <li>What timezone am I in?（客户端 tool，浏览器作答）</li>
              <li>What is 5000 times 3?（触发人工审批 UI）</li>
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

              if (!isToolPart(part)) return null;

              // 为需要确认的 tool 渲染审批 UI（human-in-the-loop）
              if (part.state === "approval-requested") {
                const approval = getToolApproval(part);
                if (!approval) return null;
                return (
                  <div key={part.toolCallId} className="approval">
                    <p>
                      Approve <strong>{toolDisplayName(part)}</strong>?
                    </p>
                    <pre>{JSON.stringify(part.input, null, 2)}</pre>
                    <div className="approval-buttons">
                      <button
                        className="approve"
                        onClick={() =>
                          addToolApprovalResponse({
                            id: approval.id,
                            approved: true,
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="reject"
                        onClick={() =>
                          addToolApprovalResponse({
                            id: approval.id,
                            approved: false,
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              }

              // 展示已完成 tool 的返回结果
              if (part.state === "output-available") {
                return (
                  <details key={part.toolCallId} className="tool-result">
                    <summary>{toolDisplayName(part)} result</summary>
                    <pre>{JSON.stringify(part.output, null, 2)}</pre>
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
          placeholder="Try: What's the weather in Paris?"
          autoFocus
        />
        <button type="submit" disabled={status === "streaming"}>
          {status === "streaming" ? "…" : "Send"}
        </button>
        <button type="button" className="clear" onClick={clearHistory}>
          Clear history
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
