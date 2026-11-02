# Cloudflare OPC Agent 入门实战

把 [opc-ops](https://github.com/liangdabiao/opc-ops-skill) 这个「一人接私活防坑 SOP」skill
完整移植成一个有状态 Agent：**金额与风险判断由确定性工具完成，模型只负责判断与话术**。

- ✅ **25 条风险规则**（红线 / 需留意 / 正向）扫描客户沟通记录 → 直接给「接 / 不接 / 条件接」
- ✅ **金额计算**：分期拆分 / 中途叫停结算 / 维护报价（整数分运算，误差为零）
- ✅ **8 份模板**：合同大纲 / 报价单 / 需求文档 / 周报 / 中期确认单 / 验收清单 / 结项报告 / 维护合同
- ✅ **B1~B11 全流程 + A0/A2 经营层**：按阶段渐进式注入知识
- ✅ **项目工作台**（skill 原本没有的能力）：多项目建档、阶段推进、定金进度
- ✅ **自动建档**：说「客户李四，电商小程序，合同3万」自动落库

## 为什么这个案例特别

前六个案例展示的是「怎么把 Agent 搭起来」，这个案例展示的是 **怎么把一套人类 SOP 变成 Agent**，核心是三条设计判断：

| 判断 | 做法 | 理由 |
|---|---|---|
| 确定性逻辑绝不交给模型 | 风险扫描、金额计算、模板填充全部是 Worker 内的纯函数工具 | LLM 会把 5000×3 算错、会漏规则；这类判断必须可复现 |
| 知识按阶段注入 | Stage Router 判定 B1~B11 → 只注入该阶段的 reference | 对应 skill 的「只加载当前阶段需要的资源」，省 token、降低干扰 |
| 状态要让 Agent 记住 | 项目档案存 DO 的 SQLite，跨会话保留 | skill 是无状态的，每次对话完就没影了 |

## 架构

```
用户输入
   ↓
[Stage Router]（19 条关键词规则，0 成本）→ B1~B11 / A0 / A2
   ↓
[自动建档]（确定性抽取：客户名 + 金额）
   ↓
注入：核心理念 + 本阶段动作 + 本阶段 reference（≤7000 字）
   ↓
LLM (glm-4.7-flash) 决策
   ↓
┌────────── 确定性工具（0 Neurons）──────────┐
│ scan_client_risk  25 条正则 → 结论 + 话术   │
│ calc_deal         split / settle / maintain │
│ render_doc        模板占位符填充 + 缺项清单  │
│ save_project      项目落库                  │
└─────────────────────────────────────────────┘
   ↓
固定四段输出：阶段判断 → 必做动作 → 产出物 → 本条红线
```

## 项目结构

```
opc-agent/
├── src/
│   ├── server.ts                 ★ OpcAgent：阶段注入 + 工具 + 工作台 callable
│   ├── client.tsx                聊天 + 项目工作台 + 工具结果卡片（含文档下载）
│   ├── lib/
│   │   ├── risk-scan.ts          ★ 25 条规则（移植自 risk_scan.py）
│   │   ├── deal-calc.ts          ★ 整数分运算（移植自 deal_calc.py）
│   │   ├── stage-router.ts       ★ 19 条阶段路由规则
│   │   ├── templates.ts          模板引擎（占位符填充 + 缺失检测）
│   │   ├── extract-project.ts    确定性项目抽取（客户名/金额/项目名）
│   │   └── types.ts
│   └── knowledge/                自动生成，勿手改
│       ├── templates-data.ts     8 份模板原文（31KB）
│       ├── references-data.ts    4 份参考手册原文（27KB）
│       └── skill-data.ts         SKILL.md 全文（11KB）
├── tools/
│   ├── sync-assets.mjs           从 skill 目录同步模板/知识（skill 更新后重跑）
│   └── verify-logic.ts           移植正确性验证（对比 Python 原版）
└── wrangler.jsonc                AI 绑定 / OpcAgent DO
```

## skill → Agent 映射表

| opc-ops 组件 | Agent 实现 | LLM 成本 |
|---|---|---|
| SKILL.md 五原则 + 路由表 | 精简系统提示 + Stage Router | 低 |
| `references/` ×4（38KB） | 按阶段注入，单次 ≤7KB | 低 |
| `assets/` ×8（26KB） | `render_doc` 模板引擎 + 前端下载 | **0** |
| `scripts/risk_scan.py` | `src/lib/risk-scan.ts`（25 条规则原样保留） | **0** |
| `scripts/deal_calc.py` | `src/lib/deal-calc.ts`（Decimal → 整数分） | **0** |
| 无（skill 是无状态的） | 项目工作台（DO SQLite） | 0 |

## 运行

```bash
npm install
npx wrangler login
npx wrangler types
npm run dev               # http://localhost:5173
```

### 验证移植正确性（不消耗 Workers AI 额度）

```bash
npm run test:logic
# 结果：20 通过 / 0 失败
```

对比的是 Python 原版黄金输出（`python scripts/deal_calc.py split --total 16000` 等）。

### 同步 skill 更新

skill 的模板或文档改动后：

```bash
node tools/sync-assets.mjs "D:/opc-skill/.workbuddy/skills/opc-ops"
```

## 实测记录（Free 计划）

| 场景 | 输入 | 结果 |
|---|---|---|
| 客户风险 | 「你先做着，做完了我们再谈钱」 | ✅ B1 → 命中 1 条红线 → 判定「婉拒」+ 话术 |
| 分期计算 | 「1万6，定金多少、怎么分期」 | ✅ B2 → ¥8,000 / ¥4,800 / ¥3,200（与 Python 一致） |
| 混合信号 | 「李四，电商小程序，3万，月底上线」 | ✅ 自动建档 + 0 红线 3 正向 → 「可继续推进，缺可量化目标」 |
| 模板生成 | 「要交付了，生成验收清单」 | ✅ 生成 .md + 列出 18 个待填占位符 + 一键下载 |

## 核心概念速查

| 概念 | 说明 |
|---|---|
| 渐进式知识注入 | 只把当前阶段的 reference 塞进提示，其余留在包里——对应 skill 的核心设计 |
| 确定性工具 | 纯函数在 Worker 内执行，不进模型上下文，结果 100% 可复现且零 token |
| `@callable` | 前端直接调服务端方法（工作台读写项目），不必经过对话 |
| 自动建档 | 服务端正则抽取「客户名 + 金额」，不依赖模型是否记得调工具 |
| 整数分运算 | 金额一律用「分」的整数表示，避免浮点误差 |
| 工具返回值即事实 | 提示词明确要求「工具返回什么就基于什么说」，禁止模型自己估 |

## 已知限制

- **模板是通用行业示例**：`acceptance-checklist` 等模板内含设备管理系统的示例行，
  模型会提示与你的项目不匹配——这是刻意保留的（模板是结构参考，不是成品）
- **阶段判定是关键词规则**：复杂表述可能判错；可在对话里直接说「我在第 X 步」纠正
- **合同/条款不构成法律意见**：正式签约前请律师复阅（skill 原文的免责声明同样适用）
- **Workers AI 每日 10,000 Neurons**：本案例确定性工具不耗额度，但对话本身仍计费

## 部署

```bash
npm run deploy
# 建议绑定自定义域名（workers.dev 部分地区不可达），方法见仓库总 README
```

## 下一步

- 把 `references/` 灌进 Vectorize（复用 rag-agent），做跨阶段语义检索
- 项目档案从 state 迁到 `this.sql`，支持按阶段/客户聚合统计
- 加 `schedule()` 定时任务：每周五自动提醒发周报
