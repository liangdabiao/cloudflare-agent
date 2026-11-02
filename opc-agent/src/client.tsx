/**
 * 客户端：OPC 经营 Agent
 *
 * 三块界面：
 * 1. 项目工作台（顶部）——多项目建档、阶段推进、定金/收款进度
 * 2. 聊天（主体）——按阶段给建议、调用确定性工具
 * 3. 工具结果卡片——风险扫描结论 / 金额表格 / 生成文档（可下载）
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

function toolName(part: ToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

interface AgentCaller {
  call: (method: string, args?: unknown[]) => Promise<unknown>;
}

interface Project {
  id: string;
  clientName: string;
  title: string;
  total: number;
  plan: string;
  stage: string;
  received: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

const STAGE_OPTIONS = [
  ["B1", "线索筛选"],
  ["B2", "报价分期"],
  ["B3", "合同"],
  ["B4", "收定金"],
  ["B5", "需求确认"],
  ["B5-change", "需求变更"],
  ["B6", "周进度"],
  ["B7", "中期交付"],
  ["B8", "交付四件套"],
  ["B9", "验收"],
  ["B10", "尾款"],
  ["B11", "售后边界"],
  ["A0", "方向选择"],
  ["A2", "经营复盘"],
] as const;

/* ───────────────────────── 工具结果卡片 ───────────────────────── */

function scanColor(verdict: string) {
  if (verdict === "婉拒") return "#ff6b6b";
  if (verdict === "条件接" || verdict === "可接（补条款）") return "#fab005";
  return "#51cf66";
}

function RiskCard({ out }: { out: Record<string, unknown> }) {
  const verdict = String(out.verdict ?? "");
  const counts = (out.counts ?? {}) as Record<string, number>;
  const hits = (out.hits ?? []) as Array<Record<string, string | number>>;
  return (
    <div className="card">
      <div className="card-head">
        <span className="badge" style={{ background: scanColor(verdict) }}>
          {verdict}
        </span>
        <span className="muted">
          红线 {counts.red ?? 0} · 留意 {counts.warn ?? 0} · 正向 {counts.good ?? 0}
        </span>
      </div>
      <p className="card-advice">{String(out.advice ?? "")}</p>
      {hits.length > 0 && (
        <table className="mini">
          <tbody>
            {hits.map((h, i) => (
              <tr key={i}>
                <td className="num">{h.line}</td>
                <td>
                  <span className={`tag tag-${h.group === "红线" ? "red" : h.group === "需留意" ? "warn" : "good"}`}>
                    {h.group}
                  </span>{" "}
                  {h.name}
                </td>
                <td className="muted">{h.match}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DealCard({ out }: { out: Record<string, unknown> }) {
  if (out.rows) {
    const rows = out.rows as Array<Record<string, string>>;
    const isSplit = rows[0] && "percent" in rows[0];
    const isMaintain = rows[0] && "cycle" in rows[0];
    return (
      <div className="card">
        <div className="card-head">
          <strong>
            {isSplit ? "分期方案" : isMaintain ? "维护报价" : "中途结算"}
          </strong>
          {out.totalText ? <span className="muted">{String(out.totalText)}</span> : null}
        </div>
        <table className="mini">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.label ?? r.cycle}</td>
                {"percent" in r && <td className="num">{r.percent}</td>}
                <td className="num">{r.amountText ?? r.text ?? r.low}</td>
                {r.high && <td className="num">{r.high}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {out.balance !== undefined && (
          <p className="card-advice">
            待收 {String(out.balanceText)}{" "}
            <span className="muted">（{String(out.balanceSide)}）</span>
          </p>
        )}
        {(out.warnings as string[] | undefined)?.map((w, i) => (
          <p key={i} className="warn-line">
            ⚠ {w}
          </p>
        ))}
        {out.speech ? <p className="speech">话术：{String(out.speech)}</p> : null}
        {out.reminder ? <p className="muted small">{String(out.reminder)}</p> : null}
      </div>
    );
  }
  return <pre className="raw">{JSON.stringify(out, null, 2)}</pre>;
}

function DocCard({ out }: { out: Record<string, unknown> }) {
  const content = String(out.content ?? "");
  const fileName = String(out.fileName ?? "文档.md");
  const missing = (out.missing as string[]) ?? [];

  const download = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <div className="card-head">
        <strong>{fileName}</strong>
        <button className="sm" onClick={download}>
          下载 .md
        </button>
      </div>
      {missing.length > 0 && (
        <p className="warn-line">
          ⚠ 还有 {missing.length} 个占位符未填：{missing.slice(0, 6).join("、")}
          {missing.length > 6 ? "…" : ""}
        </p>
      )}
      <details>
        <summary className="muted small">预览（{content.length} 字）</summary>
        <pre className="doc">{content.slice(0, 3000)}</pre>
      </details>
    </div>
  );
}

function ToolResult({ name, output }: { name: string; output: unknown }) {
  const out = (output ?? {}) as Record<string, unknown>;
  if (name === "scan_client_risk") return <RiskCard out={out} />;
  if (name === "calc_deal") return <DealCard out={out} />;
  if (name === "render_doc") return <DocCard out={out} />;
  if (name === "save_project" && out.saved)
    return (
      <div className="card slim">
        ✅ 已建档：{String(out.projectId)}（阶段 {String(out.stage)}）
      </div>
    );
  return <pre className="raw">{JSON.stringify(out, null, 2).slice(0, 1500)}</pre>;
}

/* ───────────────────────── 项目工作台 ───────────────────────── */

function Workspace({
  agent,
  refreshKey,
  onPick,
}: {
  agent: AgentCaller;
  /** 变化时刷新项目列表（服务端可能自动建档） */
  refreshKey: number;
  onPick: (text: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clientName: "", title: "", total: "" });
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    agent
      .call("listProjects")
      .then((r) => setProjects(r as Project[]))
      .catch(() => setProjects([]));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const add = async () => {
    const total = Number(form.total);
    if (!form.clientName.trim() || !form.title.trim() || !Number.isFinite(total))
      return;
    setBusy(true);
    try {
      await agent.call("upsertProject", [
        {
          clientName: form.clientName.trim(),
          title: form.title.trim(),
          total,
        },
      ]);
      setForm({ clientName: "", title: "", total: "" });
      setOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const pick = async (p: Project) => {
    await agent.call("setActiveProject", [p.id]);
    onPick(`我在处理「${p.clientName} / ${p.title}」这个项目（合同额 ¥${p.total}，当前阶段 ${p.stage}）。`);
  };

  const move = async (p: Project, stage: string) => {
    await agent.call("upsertProject", [{ ...p, stage }]);
    await refresh();
  };

  const remove = async (p: Project) => {
    await agent.call("deleteProject", [p.id]);
    await refresh();
  };

  return (
    <div className="ws">
      <div className="ws-head">
        <strong>项目工作台</strong>
        <span className="muted small">{projects.length} 个项目</span>
        <button className="sm" onClick={() => setOpen(!open)}>
          {open ? "收起" : "+ 新建项目"}
        </button>
      </div>

      {open && (
        <div className="ws-form">
          <input
            placeholder="客户名"
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          />
          <input
            placeholder="项目名"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            placeholder="合同额（元）"
            inputMode="numeric"
            value={form.total}
            onChange={(e) => setForm({ ...form, total: e.target.value })}
          />
          <button onClick={add} disabled={busy}>
            建档
          </button>
        </div>
      )}

      <div className="ws-list">
        {projects.length === 0 && (
          <p className="muted small">
            还没有项目。点「+ 新建项目」建档，或在聊天里说「客户A，官网改版，1万6」让我自动建档。
          </p>
        )}
        {projects.map((p) => {
          const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
          return (
            <div className="ws-item" key={p.id}>
              <div className="ws-item-main" onClick={() => pick(p)}>
                <strong>{p.clientName}</strong>
                <span className="muted"> · {p.title}</span>
                <div className="ws-meta">
                  ¥{p.total.toLocaleString("en-US")} · {p.plan} · 已收 {pct}%
                </div>
              </div>
              <select
                value={p.stage}
                onChange={(e) => move(p, e.target.value)}
                className="ws-stage"
              >
                {STAGE_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {id} {label}
                  </option>
                ))}
              </select>
              <button className="sm danger" onClick={() => remove(p)}>
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── 聊天 ───────────────────────── */

const QUICK = [
  { label: "客户靠谱吗", text: "客户说：你先做着，做完了我们再谈钱。这单要不要接？" },
  { label: "算分期", text: "1 万 6 的项目，定金该收多少、怎么分期？" },
  { label: "出合同", text: "帮我把合同大纲填一下，客户是张三，做电商小程序。" },
  { label: "验收清单", text: "要交付了，给我生成验收清单。" },
  { label: "被叫停结算", text: "项目在第 60% 被客户叫停，合同 16000，前期成本 2000，已收 4800，能收多少？" },
  { label: "售后边界", text: "交付后客户还一直找我改东西，维护报价怎么定？" },
];

function Chat() {
  const agent = useAgent({ agent: "OpcAgent" });
  const agentCaller = agent as unknown as AgentCaller;
  const toolRoundsRef = useRef(0);
  const [text, setText] = useState("");

  const { messages, sendMessage, clearHistory, status } = useAgentChat({
    agent,
  });

  const send = (content: string) => {
    if (!content.trim()) return;
    toolRoundsRef.current = 0;
    sendMessage({ text: content });
    setText("");
  };

  return (
    <div className="app">
      <header>
        <h1>OPC 经营 Agent</h1>
        <p className="subtitle">
          接单防坑 · 报价结算 · 合同交付 · 售后边界 —— 金额与风险判断由确定性工具完成，模型只做判断与话术
        </p>
      </header>

      <Workspace
        agent={agentCaller}
        refreshKey={messages.length + (status === "ready" ? 1 : 0)}
        onPick={(t) => setText(t)}
      />

      <div className="quick">
        {QUICK.map((q) => (
          <button key={q.label} className="chip" onClick={() => send(q.text)}>
            {q.label}
          </button>
        ))}
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p>像平时一样说话就行，比如：</p>
            <ul>
              <li>「有个客户说先做着，做完了再谈钱，这单要不要接？」</li>
              <li>「1 万 6 的项目，定金该收多少、怎么分期？」</li>
              <li>「客户说整体还行，但那个啥你再改改。」</li>
            </ul>
            <p className="muted small">
              工具卡片里能直接看到命中的红线、每一期金额、生成的文档（可下载 .md）。
            </p>
          </div>
        )}

        {messages.map((msg: UIMessage) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <strong>{msg.role === "user" ? "我" : "顾问"}:</strong>
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
                const name = toolName(part);
                return (
                  <div key={part.toolCallId} className="tool-wrap">
                    <div className="tool-title">{name} result</div>
                    <ToolResult name={name} output={part.output} />
                  </div>
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
          send(text);
        }}
      >
        <input
          name="message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="描述你现在的处境：客户说了什么、卡在哪一步…"
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
