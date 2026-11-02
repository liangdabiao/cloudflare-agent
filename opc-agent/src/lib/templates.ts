/**
 * 模板引擎（对应 skill 的 assets/ 使用规则）
 *
 * 规则（照抄 SKILL.md）：
 * 1. 把 {{占位符}} 全部替换为真实信息；有占位没填就问用户，不要留空
 * 2. 文件名带项目名与日期
 * 3. 模板是结构与清单，不是法务意见
 */
import { DATA as TEMPLATES } from "../knowledge/templates-data";

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/** 模板的中文标题（生成文件名用） */
export const TEMPLATE_LABELS: Record<string, string> = {
  "contract-outline": "合同大纲",
  "quote-sheet": "报价单",
  "requirements-doc": "需求文档",
  "weekly-progress-email": "周进度邮件",
  "midterm-confirmation": "中期验收确认单",
  "acceptance-checklist": "验收清单",
  "project-closing-report": "结项报告",
  "maintenance-contract-outline": "维护合同大纲",
};

export function getTemplate(key: string): string {
  const t = TEMPLATES[key];
  if (!t) {
    throw new Error(
      `没有名为 ${key} 的模板。可用：${TEMPLATE_KEYS.join(", ")}`,
    );
  }
  return t;
}

/** 提取模板里所有 {{占位符}} */
export function listPlaceholders(key: string): string[] {
  const t = getTemplate(key);
  const found = new Set<string>();
  for (const m of t.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = m[1].trim();
    if (name) found.add(name);
  }
  return [...found];
}

/**
 * 渲染：替换所有占位符。
 * 返回未填充的占位符清单，提醒模型"有占位没填就问用户，不要留空"。
 */
export function renderTemplate(
  key: string,
  vars: Record<string, string>,
): { content: string; missing: string[] } {
  const template = getTemplate(key);
  const missing: string[] = [];
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) normalized[k.trim()] = v;

  const content = template.replace(/\{\{([^}]*)\}\}/g, (whole, raw: string) => {
    const name = raw.trim();
    if (!name) return "";
    const val = normalized[name];
    if (val !== undefined && val !== "") return val;
    missing.push(name);
    return whole; // 保留占位符，方便用户继续补
  });

  return { content, missing: [...new Set(missing)] };
}

/** 建议文件名：{中文标题}-{客户名}-{日期}.md */
export function suggestFileName(
  key: string,
  clientName: string,
  date = new Date(),
): string {
  const label = TEMPLATE_LABELS[key] ?? key;
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  const safeClient = clientName.replace(/[\\/:*?"<>|]/g, "").slice(0, 20) || "客户";
  return `${label}-${safeClient}-${d}.md`;
}
