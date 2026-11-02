/**
 * 接单金额计算（移植自 opc-ops/scripts/deal_calc.py）
 *
 * 与 Python 版的差异：内部一律用**整数「分」**运算，避免浮点误差。
 * 输出格式与 Python 版保持一致（表格 + 风险提示 + 话术）。
 */

/** 元 → 分（四舍五入，避免 0.1+0.2 类误差） */
function toCents(yuan: number): number {
  return Math.round(yuan * 100);
}

function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const withComma = yuan.toLocaleString("en-US");
  return `${sign}¥${withComma}${fen ? "." + String(fen).padStart(2, "0") : ""}`;
}

/** 按比例拆分（比例合计必须 100；尾差并入第一笔，保证合计严格等于总额） */
export function splitDeal(totalYuan: number, planText: string) {
  const total = toCents(totalYuan);
  if (total <= 0) throw new Error("合同金额必须大于 0");

  const raw = planText.replace(/，/g, ",").replace(/\//g, ",").replace(/%/g, "");
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const plan = parts.map((p) => Number(p));
  if (plan.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error("分期比例格式不对，示例：50/30/20");
  }
  if (plan.length !== 2 && plan.length !== 3) {
    throw new Error("分期只能写 2 段或 3 段，示例：50/30/20 或 50/50");
  }
  const sum = plan.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`分期比例合计必须是 100，当前合计 ${sum}`);
  }

  const amounts = plan.map((p) => Math.round((total * p) / 100));
  const diff = total - amounts.reduce((a, b) => a + b, 0);
  if (diff !== 0) amounts[0] += diff;

  const labels =
    plan.length === 3 ? ["定金", "中期款", "尾款"] : ["定金", "尾款"];

  const rows = labels.map((label, i) => ({
    label,
    percent: `${plan[i]}%`,
    amount: amounts[i],
    amountText: fmt(amounts[i]),
  }));

  const depositRatio = amounts[0] / total;
  const warnings: string[] = [];
  if (depositRatio < 0.3) {
    warnings.push("定金比例低于 30%，不建议接受。先做后付的白嫖概率极高。");
  }

  return {
    total,
    totalText: fmt(total),
    planText: plan.map((p) => `${p}%`).join(" / "),
    rows,
    warnings,
    reminder: `${fmt(amounts[0])} 到账当天才开工。没到账不排期、不建仓库、不写需求。`,
    midtermNote:
      plan.length === 3
        ? "中期款绑定事件：进度 60%~70% 的中期交付验收通过后 3 个工作日内。"
        : null,
  };
}

/** 中途叫停结算 */
export function settleDeal(opts: {
  total: number;
  progress: number;
  cost?: number;
  received?: number;
}) {
  const total = toCents(opts.total);
  const progress = opts.progress;
  if (!(progress >= 0 && progress <= 100)) throw new Error("进度请填 0~100");
  const cost = toCents(opts.cost ?? 0);
  const received = toCents(opts.received ?? 0);

  const done = Math.round((total * progress) / 100);
  const payable = done + cost;
  const balance = payable - received;

  const pct = progress === Math.round(progress) ? Math.round(progress) : progress;
  const overContract = payable > total;

  const speech =
    balance > 0
      ? `截至 ${pct}% 已完成部分折价 ${fmt(done)}，加上前期已发生的环境搭建与方案成本 ${fmt(cost)}，` +
        `合计 ${fmt(payable)}，已收 ${fmt(received)}，请结清 ${fmt(balance)} 后我移交已完成部分的可运行成果。`
      : null;

  return {
    totalText: fmt(total),
    progress: pct,
    rows: [
      { label: "已完成部分折价", text: fmt(done) },
      { label: "未摊销前期成本", text: fmt(cost) },
      { label: "应结总额", text: fmt(payable) },
      { label: "已收款项", text: fmt(received) },
    ],
    balance,
    balanceText: fmt(Math.abs(balance)),
    balanceSide: balance >= 0 ? "甲方还应支付" : "我方应退还",
    receivedRatio: total ? Math.round((received / total) * 100) : 0,
    warnings: overContract
      ? [
          "应结总额已超过合同额，检查前期成本是否重复计入。",
          "若前期成本已在阶段报价中摊销，此处应填 0。",
        ]
      : [],
    speech,
  };
}

/** 维护报价区间（项目总价 5%~10%/月） */
export function maintainDeal(totalYuan: number) {
  const total = toCents(totalYuan);
  const low = Math.round(total * 0.05);
  const high = Math.round(total * 0.1);

  return {
    totalText: fmt(total),
    rows: [
      { cycle: "月度", low: fmt(low), high: fmt(high) },
      { cycle: "季度", low: fmt(low * 3), high: fmt(high * 3) },
      { cycle: "半年", low: fmt(low * 6), high: fmt(high * 6) },
    ],
    perCase: "¥500 ~ ¥2,000 / 次（按复杂度）",
    advice: "按季度签，不做月付。月付的对账与催款管理成本高于收益。",
    speech:
      "维护是项目总价的 5%~10% 每月，包含 bug 修复、小调整和数据备份，按季度签。",
  };
}
