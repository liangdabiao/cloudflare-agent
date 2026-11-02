/**
 * 移植正确性验证：把 TS 版计算结果与 Python 原版黄金输出对比。
 * 纯本地运行，不消耗 Workers AI 额度。
 *
 *   npm run test:logic
 */
import { splitDeal, settleDeal, maintainDeal } from "../src/lib/deal-calc.ts";
import { scanText, buildRiskReport } from "../src/lib/risk-scan.ts";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n    期望: ${e}\n    实际: ${a}`);
  }
}

console.log("\n[1] deal_calc.split --total 16000");
{
  const r = splitDeal(16000, "50/30/20");
  // Python 黄金输出：定金 ¥8,000 / 中期款 ¥4,800 / 尾款 ¥3,200
  check("分期金额", r.rows.map((x) => x.amountText), ["¥8,000", "¥4,800", "¥3,200"]);
  check("合计", r.totalText, "¥16,000");
  check("定金不低于30%无告警", r.warnings.length, 0);
}

console.log("[2] deal_calc.split 30/40/30");
{
  const r = splitDeal(16000, "30/40/30");
  check("分期金额", r.rows.map((x) => x.amountText), ["¥4,800", "¥6,400", "¥4,800"]);
}

console.log("[3] deal_calc.split 定金过低告警");
{
  const r = splitDeal(10000, "10/40/50");
  check("触发30%告警", r.warnings.length, 1);
}

console.log("[4] deal_calc.split 尾差并入定金");
{
  const r = splitDeal(1000, "33/33/34");
  check(
    "合计严格等于合同额",
    r.rows.reduce((s, x) => s + x.amount, 0),
    100000,
  );
}

console.log("[5] deal_calc.settle --total 16000 --progress 60 --cost 2000 --received 4800");
{
  const r = settleDeal({ total: 16000, progress: 60, cost: 2000, received: 4800 });
  // Python 黄金：已完成折价 9600 / 成本 2000 / 应结 11600 / 已收 4800 / 待收 6800
  check("表格数值", r.rows.map((x) => x.text), ["¥9,600", "¥2,000", "¥11,600", "¥4,800"]);
  check("待收余额", r.balance, 680000);
  check("已收占比", r.receivedRatio, 30);
  check("话术非空", typeof r.speech, "string");
}

console.log("[6] deal_calc.maintain --total 16000");
{
  const r = maintainDeal(16000);
  // Python 黄金：月 800~1600 / 季 2400~4800 / 半年 4800~9600
  check("月度", [r.rows[0].low, r.rows[0].high], ["¥800", "¥1,600"]);
  check("季度", [r.rows[1].low, r.rows[1].high], ["¥2,400", "¥4,800"]);
  check("半年", [r.rows[2].low, r.rows[2].high], ["¥4,800", "¥9,600"]);
}

console.log("[7] risk_scan 烂客户（4 条红线）");
{
  const text = [
    "你先做着，做完了我们再谈钱",
    "这个功能很简单吧",
    "别人报价是你的三分之一",
    "就在微信语音里说一下就行，不用写邮件",
  ].join("\n");
  const rep = buildRiskReport(scanText(text));
  check("结论", rep.verdict, "婉拒");
  check("红线数", rep.counts.red, 4);
  check(
    "命中红线名称",
    rep.redNames.sort(),
    ["先做后付", "低估工作量", "纯比价", "拒绝书面"].sort(),
  );
}

console.log("[8] risk_scan 好客户（三问齐）");
{
  const text = [
    "我们预算 3 万左右",
    "这个月底必须上线，赶双十一",
    "目标是把转化率从 2% 提到 4%",
    "需求我会发邮件确认",
  ].join("\n");
  const rep = buildRiskReport(scanText(text));
  check("结论", rep.verdict, "可接");
  check("红线数", rep.counts.red, 0);
  check("正向数", rep.counts.good, 4);
}

console.log("[9] risk_scan 同行命中风险时不重复计入正向");
{
  const rep = buildRiskReport(scanText("月底走完流程就打款"));
  check("不产生正向信号", rep.counts.good, 0);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
// Node 内置全局；声明避免为一个小脚本引入 @types/node
declare const process: { exit(code: number): never };
process.exit(fail === 0 ? 0 : 1);
