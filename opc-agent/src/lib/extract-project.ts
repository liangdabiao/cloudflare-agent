/**
 * 从自然语言里确定性抽取项目信息（客户名 / 金额 / 项目名）。
 *
 * 为什么不用模型抽取：模型会漏、会编、金额会算错。这里只做保守的规则匹配，
 * 命中「客户名 + 金额」两者才建档，其余交给用户在工作台手动补。
 */

/** 常见动词/虚词，避免「客户说…」被当成客户名 */
const STOP_WORDS = new Set([
  "说", "表示", "要求", "问", "觉得", "那边", "这边", "很", "不", "嫌",
  "又", "还", "一直", "总", "想", "要", "让", "希望", "催", "答应", "反悔",
  "昨天", "今天", "刚才", "刚", "已", "已经", "没", "没有", "把", "给我",
]);

/** 解析金额：1万6 / 3万 / 1.6万 / 16000 / 1万6千 */
function parseAmount(text: string): number | null {
  // 1万6 / 1万6千
  const wanWithRest = text.match(/(\d+(?:\.\d+)?)\s*万\s*(\d)\s*千?/);
  if (wanWithRest) {
    return Math.round(Number(wanWithRest[1]) * 10000 + Number(wanWithRest[2]) * 1000);
  }
  // 3万 / 1.6万
  const wan = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (wan) return Math.round(Number(wan[1]) * 10000);

  // 16000 / 16000元：优先取带「合同/总价/报价/预算/费用」上下文的
  const ctx = text.match(/(?:合同|总价|报价|预算|费用|价格)[^\d]{0,6}(\d{3,8})/);
  if (ctx) return Number(ctx[1]);

  const plain = text.match(/(\d{4,8})\s*(?:元|块)?/);
  if (plain) return Number(plain[1]);

  return null;
}

/** 解析客户名：客户/甲方 + 名字（排除动词） */
function parseClientName(text: string): string | null {
  const m = text.match(/(?:客户|甲方)\s*(?:是|叫|：|:)?\s*([\u4e00-\u9fa5A-Za-z0-9]{1,8})/);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || STOP_WORDS.has(name)) return null;
  // 名字里出现「说」「表示」等，截断到第一个停用词前
  for (const w of STOP_WORDS) {
    const idx = name.indexOf(w);
    if (idx > 0) return name.slice(0, idx);
    if (idx === 0) return null;
  }
  return name;
}

/** 解析项目名：xxx小程序 / 网站 / 系统 / APP / 后台 */
function parseTitle(text: string): string | null {
  // 前置修饰：电商小程序、会员系统
  const pre = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,10})(小程序|网站|官网|系统|后台|APP|app|工具|平台)/);
  if (pre) return pre[1] + pre[2];
  // 名词在前的写法：官网改版、网站开发
  const post = text.match(/(官网|网站|小程序|系统|后台|工具|平台)(改版|开发|重构|升级)/);
  if (post) return post[1] + post[2];
  return null;
}

export interface ExtractedProject {
  clientName: string;
  total: number;
  title: string;
}

/** 仅在「客户名 + 金额」都抽到时返回（保守，避免误建档） */
export function extractProject(text: string): ExtractedProject | null {
  // 只分析单行内的第一段用户描述，避免把整段闲聊都吃掉
  const clientName = parseClientName(text);
  const total = parseAmount(text);
  if (!clientName || !total || total < 1000) return null;
  return {
    clientName,
    total,
    title: parseTitle(text) ?? "未命名项目",
  };
}
