/**
 * 阶段路由（移植自 SKILL.md 的快速路由表）
 *
 * 纯关键词规则、零 LLM 成本。命中多个取"最靠前"的匹配，
 * 因为用户往往从早期阶段问起，且早期问题的处理优先级更高。
 */

export type Stage =
  | "B1" | "B2" | "B3" | "B4" | "B5" | "B5-change"
  | "B6" | "B7" | "B8" | "B9" | "B10" | "B11"
  | "A0" | "A2" | "general";

export interface StageMeta {
  id: Stage;
  label: string;
  /** 对应 references/ 下的知识文件；general 不注入 */
  reference: "client-screening" | "contract-and-payment" | "delivery-and-acceptance" | "opc-playbook" | null;
  /** 该阶段的必做动作（注入提示，约束模型输出） */
  actions: string[];
  resource?: string;
}

export const STAGES: Record<Stage, StageMeta> = {
  B1: {
    id: "B1", label: "线索筛选", reference: "client-screening",
    actions: [
      "用三问补齐信息：预算具体数字、为什么是这个时间点、想达到什么可量化效果",
      "跑 scan_client_risk 扫描客户原话，命中红线就给明确结论",
      "给结论：接 / 不接 / 条件接，并附一句可直接发的话术",
    ],
    resource: "references/client-screening.md、scripts/risk_scan.py",
  },
  B2: {
    id: "B2", label: "报价分期", reference: "contract-and-payment",
    actions: [
      "确认范围与工作量",
      "用 calc_deal 算清每一期绝对金额（绝不让用户心算）",
      "给出让步底线：先降范围，不降价格",
    ],
    resource: "references/contract-and-payment.md、assets/quote-sheet.md",
  },
  B3: {
    id: "B3", label: "合同", reference: "contract-and-payment",
    actions: [
      "逐条过 8 项必备条款",
      "特别检查两处最容易漏的：逾期不确认视为验收通过、中途叫停的结算方式",
      "用 render_doc 生成合同大纲；明确提示找律师复核",
    ],
    resource: "assets/contract-outline.md",
  },
  B4: {
    id: "B4", label: "收定金", reference: "contract-and-payment",
    actions: [
      "确认定金下限 30%，不接受先做后付",
      "给「先做着，钱马上到」的应对话术",
      "强调：没到账不排期、不建仓库、不做需求",
    ],
    resource: "references/contract-and-payment.md",
  },
  B5: {
    id: "B5", label: "需求确认", reference: "delivery-and-acceptance",
    actions: [
      "输出三件套：功能列表（页面/接口、输入输出）、数据流（编号列表）、边界条件",
      "用 render_doc 生成需求文档",
      "要求客户邮件回复确认——这是拒绝范围蔓延的唯一硬武器",
    ],
    resource: "assets/requirements-doc.md",
  },
  "B5-change": {
    id: "B5-change", label: "需求变更", reference: "contract-and-payment",
    actions: [
      "回到需求文档定位边界，指出哪条已约定、哪条超出",
      "走变更流程：书面申请 + 工时报价",
      "明确：不签变更单就不开工",
    ],
    resource: "references/contract-and-payment.md",
  },
  B6: {
    id: "B6", label: "周进度同步", reference: "delivery-and-acceptance",
    actions: [
      "用 render_doc 生成四段式周报：本周完成 / 下周计划 / 阻塞项 / 整体进度百分比",
      "强调周五固定发，目的是造可追溯的沟通链",
    ],
    resource: "assets/weekly-progress-email.md",
  },
  B7: {
    id: "B7", label: "中期交付 + 中期款", reference: "delivery-and-acceptance",
    actions: [
      "交付可运行演示（测试环境，不给源码）+ 已完成模块 vs 计划对比 + 中期确认单",
      "客户确认后再收第二笔",
    ],
    resource: "assets/midterm-confirmation.md",
  },
  B8: {
    id: "B8", label: "交付包四件套", reference: "delivery-and-acceptance",
    actions: [
      "四件套：验收清单 / 部署文档 / 操作手册 / 结项报告",
      "用 render_doc 逐份生成",
      "部署文档标准：没参与项目的初级开发照着能部署成功",
    ],
    resource: "assets/acceptance-checklist.md、assets/project-closing-report.md",
  },
  B9: {
    id: "B9", label: "验收", reference: "delivery-and-acceptance",
    actions: [
      "书面约定验收期限（7 个工作日），逾期未反馈视为通过",
      "流程：提交交付包 → 逐项打勾 → 签验收确认书 → 付尾款 → 移交源码",
    ],
    resource: "references/delivery-and-acceptance.md",
  },
  B10: {
    id: "B10", label: "尾款", reference: "delivery-and-acceptance",
    actions: [
      "源码在尾款之后；部署版可先给，源码不给",
      "用 calc_deal 算止损线",
      "客户压价时拿验收清单对账，新需求另签维护合同",
    ],
    resource: "references/delivery-and-acceptance.md",
  },
  B11: {
    id: "B11", label: "售后边界", reference: "delivery-and-acceptance",
    actions: [
      "7 个自然日免费修 bug，仅限需求文档范围内的功能缺陷",
      "之后转独立维护合同，按季度签、不做月付",
      "用 calc_deal 算维护报价（maintain）",
    ],
    resource: "assets/maintenance-contract-outline.md",
  },
  A0: {
    id: "A0", label: "一人公司方向", reference: "opc-playbook",
    actions: [
      "三个切入口：AI SaaS 小工具 / AI 内容工厂 / AI 咨询诊断",
      "三个判据：有垂直经验、3 天能出可演示版本、有信任资产",
      "三条都满足才动手，别同时开三个",
    ],
    resource: "references/opc-playbook.md",
  },
  A2: {
    id: "A2", label: "经营复盘", reference: "opc-playbook",
    actions: [
      "按阶段定位亏损点：筛选 / 报价 / 范围 / 验收 / 尾款",
      "指出具体是哪一环漏了，而不是笼统说下次注意",
    ],
    resource: "references/opc-playbook.md 复盘表",
  },
  general: {
    id: "general", label: "通用咨询", reference: null, actions: [],
  },
};

/** 路由规则（顺序即优先级） */
const ROUTES: Array<{ stage: Stage; rx: RegExp }> = [
  { stage: "B1", rx: /(要不要接|能接吗|该不该接|靠谱吗|这单(能|要不要)|他这么说|客户(怎么样|如何)|筛(选)?客户|线索)/ },
  { stage: "B5-change", rx: /(加需求|范围(又)?变|又要改|需求变更|改需求|顺便再加|能不能再加)/ },
  { stage: "B2", rx: /(报(价|多少)|该收多少|多少钱|怎么分期|分期|他嫌贵|压价|报价单)/ },
  { stage: "B3", rx: /(合同|条款|签约|协议|要不要签)/ },
  { stage: "B4", rx: /(定金|订金|首付|先付|不肯付|钱没到)/ },
  { stage: "B5", rx: /(需求(文档|怎么(写|确认))|开工前|功能列表|需求确认)/ },
  { stage: "B6", rx: /(周报|进度(怎么)?(汇报|同步|邮件)|怎么汇报|汇报进度)/ },
  { stage: "B7", rx: /(中期|进度到 ?6|进度 ?60|第二步款|中期款|先给源码)/ },
  { stage: "B8", rx: /(交付(要|时)?(交|什么)|交付包|验收清单|部署文档|操作手册|结项报告|四件套)/ },
  { stage: "B9", rx: /(验收|拖着不验|验收标准|不验收)/ },
  { stage: "B10", rx: /(尾款|最后一笔|尾数|收不回来|赖账)/ },
  { stage: "B11", rx: /(售后|交付后.*(找我|改)|维护(合同|费|报价)|免费(改|修)|保修)/ },
  { stage: "A0", rx: /(一人公司|OPC|做什么方向|怎么起步|选方向|副业方向)/ },
  { stage: "A2", rx: /(复盘|亏了|这单赔|为什么亏|总结一下这单)/ },
];

/** 判定当前阶段；无匹配返回 general（保留给需要单一结果的地方） */
export function routeStage(text: string): StageMeta {
  return routeCandidates(text)[0]?.meta ?? STAGES.general;
}

export interface StageCandidate {
  meta: StageMeta;
  /** 关键词命中次数（不是置信度，只是热度） */
  score: number;
}

/**
 * 给出**候选**阶段，而不是唯一答案。
 *
 * 为什么是候选：客户原话大多是模糊的——「整体还行，但那个啥你再改改」既像验收、
 * 又像变更、还像压价。硬判成一个编号然后按那个 SOP 说话，是最坏的做法。
 * 这里只提供"可能相关的几个方向"给模型参考，最终判断权归模型。
 */
export function routeCandidates(text: string, limit = 3): StageCandidate[] {
  const scores = new Map<Stage, number>();
  for (const r of ROUTES) {
    const global = new RegExp(r.rx.source, "g");
    const m = text.match(global);
    if (m?.length) scores.set(r.stage, (scores.get(r.stage) ?? 0) + m.length);
  }
  const list = [...scores.entries()]
    .map(([stage, score]) => ({ meta: STAGES[stage], score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return list.length ? list : [{ meta: STAGES.general, score: 0 }];
}
