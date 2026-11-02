/**
 * 把 opc-ops skill 的模板与知识文档同步成可导入的 TS 数据模块。
 *
 * 为什么用脚本而不是手抄：模板总计 700+ 行 Markdown，手抄会丢内容、丢格式。
 * 脚本用 JSON.stringify 输出字符串字面量，反引号/${} 等无需担心转义。
 *
 * 用法（skill 更新后重新生成）：
 *   node tools/sync-assets.mjs "D:/opc-skill/.workbuddy/skills/opc-ops"
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const srcRoot = process.argv[2];
if (!srcRoot) {
  console.error('用法: node tools/sync-assets.mjs "<opc-ops skill 目录>"');
  process.exit(1);
}

const outDir = new URL("../src/knowledge/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function readAll(dir) {
  const files = readdirSync(join(srcRoot, dir)).filter((f) => f.endsWith(".md"));
  const out = {};
  for (const f of files) {
    out[basename(f, ".md")] = readFileSync(join(srcRoot, dir, f), "utf8");
  }
  return out;
}

const templates = readAll("assets");
const references = readAll("references");
const skillCore = readFileSync(join(srcRoot, "SKILL.md"), "utf8");

function emit(name, obj) {
  const body = Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  writeFileSync(
    join(outDir, name),
    `// 自动生成，请勿手改。来源：opc-ops skill（node tools/sync-assets.mjs）\n` +
      `/* eslint-disable */\nexport const DATA: Record<string, string> = {\n${body}\n};\n`,
    "utf8",
  );
  console.log(`✓ ${name}  ${Object.keys(obj).length} 项`);
}

emit("templates-data.ts", templates);
emit("references-data.ts", references);
writeFileSync(
  join(outDir, "skill-data.ts"),
  `// 自动生成，请勿手改。来源：opc-ops SKILL.md\n/* eslint-disable */\nexport const SKILL_MD = ${JSON.stringify(skillCore)};\n`,
  "utf8",
);
console.log("✓ skill-data.ts");
console.log("模板:", Object.keys(templates).join(", "));
console.log("参考:", Object.keys(references).join(", "));
