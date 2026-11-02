/**
 * Markdown 渲染（仅客户端使用）
 *
 * 模型的回答大量使用标题、加粗、表格、列表、引用——必须渲染成 HTML，
 * 否则用户看到的就是一堆 `##` 和 `**`。
 *
 * 安全：LLM 输出按不可信内容处理，渲染后统一过 DOMPurify 白名单。
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true, // 表格、删除线、任务列表
  breaks: true, // 单换行即换行：模型的输出常是紧凑列表
});

/** 把 Markdown 转成可安全注入的 HTML */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // 模型偶尔输出 <br> 之类；保留基本排版标签，禁掉脚本/事件属性
    FORBID_TAGS: ["style", "script", "iframe", "form", "input"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}
