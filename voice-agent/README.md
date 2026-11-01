# Cloudflare Voice Agent 入门实战

基于 [Cloudflare Agents 官方文档「Voice Agent 示例」](https://developers.cloudflare.com/agents/) 实现的语音 Agent：
聆听用户 → LLM 思考 → 通过 WebSocket 实时语音回复。

```
麦克风音频 ──WebSocket──▶ WorkersAIFluxSTT（流式 STT，自动检测说完）
                              │
                              ▼ transcript
                        onTurn() → streamText（LLM + 工具）
                              │
                              ▼ 文本流
                    mixin 自动分句 → WorkersAITTS 逐句合成
                              │
                              ▼ 音频流
浏览器播放 ◀──────────── WebSocket ──────────┘
```

## 项目结构

```
voice-agent/
├── index.html              # 前端入口
├── vite.config.ts          # Vite + @cloudflare/vite-plugin
├── wrangler.jsonc          # AI 绑定 / MyVoiceAgent Durable Object / SQLite 迁移
└── src/
    ├── server.ts           # ★ withVoice mixin + STT/TTS + onTurn + 语音工具
    ├── client.tsx          # ★ useVoiceAgent hook：麦克风采集、播放、打断、指标
    └── styles.css
```

## 快速开始

```bash
npm install
npx wrangler login      # Workers AI 免 API key，但需账号身份（一次即可）
npx wrangler types
npm run dev
```

打开 http://localhost:5173（浏览器会请求麦克风权限），点击 **Start Call** 直接说话。

**没有麦克风 / 不想说话？** 页面下方有文本输入框 —— `sendText()` 会跳过 STT，
直接走 LLM → TTS 管线，照样能听到语音回复，适合快速调试。

试试：**What time is it right now?** —— 会触发服务端 `get_current_time` 工具。

## 核心概念速查（学习重点）

### 服务端 `src/server.ts`

| 概念 | 说明 |
|---|---|
| `withVoice(Agent)` | mixin：为普通 Agent 添加完整语音管线（STT、分句、TTS、对话持久化） |
| `transcriber` | `WorkersAIFluxSTT`：流式 STT，模型自带轮次结束检测（end-of-turn），无需客户端静音检测 |
| `tts` | `WorkersAITTS`：默认 `@cf/deepgram/aura-1`，可传 `{ model, speaker }` 换音色 |
| `onTurn(transcript, context)` | 每轮触发；`context.messages` 是 SQLite 中的对话历史，`context.signal` 在用户打断/断开时 abort |
| `onCallStart(connection)` | 接通时触发，`this.speak(connection, text)` 直接合成语音问候 |
| 管线 hook | `afterTranscribe`（过滤噪声）、`beforeSynthesize`（调整发音）可在各阶段拦截转换 |

### 客户端 `src/client.tsx`

| 概念 | 说明 |
|---|---|
| `useVoiceAgent({ agent })` | 一个 hook 管完全套：WebSocket、麦克风采集、音频播放、打断检测 |
| `status` | 状态机：`idle → listening → thinking → speaking → listening` |
| `interimTranscript` | 正在识别的"半句"，实时更新 |
| `audioLevel` | 麦克风音量（0-1），可做音量条动画 |
| `sendText(text)` | 文本输入直达 LLM+TTS，无麦克风也可用 |
| `metrics` | 延迟指标：LLM / TTS / 首音频 |

## 换第三方 STT / TTS 提供商

无需改动 Agent 逻辑，只换 transcriber / tts 两个字段：

```bash
npm install @cloudflare/voice-deepgram @cloudflare/voice-elevenlabs
```

```ts
import { ElevenLabsTTS } from "@cloudflare/voice-elevenlabs";
import { DeepgramSTT } from "@cloudflare/voice-deepgram";

export class MyVoiceAgent extends VoiceAgent<Env> {
  transcriber = new DeepgramSTT({ apiKey: this.env.DEEPGRAM_API_KEY });
  tts = new ElevenLabsTTS({ apiKey: this.env.ELEVENLABS_API_KEY, voiceId: "..." });
  // onTurn 等其余代码完全不变
}
```

## 常见问题

**启动报 `Not logged in` / `CLOUDFLARE_API_TOKEN`**
先执行 `npx wrangler login`（STT/TTS 是 Workers AI 远程模型，本地开发必须连远程）。

**麦克风没权限**
浏览器 getUserMedia 只在 `localhost` 或 HTTPS 下可用；开发服务器默认满足。

**想改 LLM**
`onTurn` 里 `ai("@cf/zai-org/glm-4.7-flash")` 换成任意 Workers AI 模型即可。
注：文档示例的 `kimi-k2.6` 与 `glm-5.3-flash` 需要 Workers 付费计划（`require_workers_paid`），
Free 计划可用 `glm-4.7-flash`（默认，推理 token 走独立字段不会进语音，但增加少量延迟）、
`llama-3.3-70b-instruct-fp8-fast`、`llama-4-scout` 等。

## 下一步

- 加 `afterTranscribe` 过滤过短的噪声输入
- 接入真实信息 API（天气、日程…），让语音助手有实际用途
- 部署：`npm run deploy`，Agent 将运行在 Cloudflare 全球网络
