/**
 * 客户端：React 语音界面（对应文档「Voice Agent 示例」第 4 步）
 *
 * 核心概念：
 * - useVoiceAgent：一个 hook 管完全套语音客户端 ——
 *   WebSocket 连接、麦克风采集（getUserMedia）、音频播放、打断检测
 * - status 状态机："idle" → "listening" → "thinking" → "speaking" → "listening"
 * - sendText()：不说话也能测试 —— 文本直接走 LLM + TTS 管线
 * - metrics：实时显示 LLM / TTS / 首音频延迟
 */
import { useVoiceAgent } from "@cloudflare/voice/react";
import { useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const {
    status,
    transcript,
    interimTranscript,
    metrics,
    audioLevel,
    isMuted,
    connected,
    error,
    startCall,
    endCall,
    toggleMute,
    sendText,
  } = useVoiceAgent({ agent: "MyVoiceAgent" });

  const [textInput, setTextInput] = useState("");

  return (
    <div className="app">
      <header>
        <h1>Cloudflare Voice Agent</h1>
        <p className="subtitle">
          语音转文字（STT）→ LLM → 文字转语音（TTS）· 实时 WebSocket · 打断检测
        </p>
      </header>

      <div className="status-panel">
        <p>
          Status:{" "}
          <strong className={`status status-${status}`}>{status}</strong>
          {connected ? " ✅ 已连接" : " ⚠️ 未连接"}
        </p>

        {/* 麦克风音量条：listening 状态下说话可以看到它跳动 */}
        {status !== "idle" && (
          <div className="audio-level">
            <div
              className="audio-level-bar"
              style={{ width: `${Math.min(100, audioLevel * 100)}%` }}
            />
          </div>
        )}

        <div className="call-buttons">
          <button onClick={status === "idle" ? startCall : endCall}>
            {status === "idle" ? "🎙️ Start Call" : "📞 End Call"}
          </button>
          {status !== "idle" && (
            <button onClick={toggleMute} className="clear">
              {isMuted ? "Unmute" : "Mute"}
            </button>
          )}
        </div>

        {error && <p className="error">错误：{error}</p>}
      </div>

      {/* 中间态：正在识别中的"半句" */}
      {interimTranscript && (
        <p className="interim">
          <em>{interimTranscript}…</em>
        </p>
      )}

      <div className="messages">
        {transcript.length === 0 && (
          <div className="empty">
            <p>点击 Start Call 后直接说话，或用下方文本框测试（无需麦克风）。</p>
            <p>试试：「What time is it right now?」—— 会触发服务端 get_current_time 工具。</p>
          </div>
        )}
        {transcript.map((msg) => (
          <p key={msg.timestamp} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong> {msg.text}
          </p>
        ))}
      </div>

      {/* 文本输入：sendText 直接走 LLM + TTS 管线，适合无麦克风时调试 */}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!textInput.trim()) return;
          sendText(textInput);
          setTextInput("");
        }}
      >
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="不想说话？直接打字测试（Text → LLM → TTS）"
        />
        <button type="submit">Send Text</button>
      </form>

      {metrics && (
        <p className="metrics">
          LLM: {metrics.llm_ms}ms | TTS: {metrics.tts_ms}ms | 首音频:{" "}
          {metrics.first_audio_ms}ms
        </p>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
