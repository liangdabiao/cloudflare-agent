/**
 * 客户沟通记录风险扫描（移植自 opc-ops/scripts/risk_scan.py）
 *
 * 25 条规则原样保留：红线 6 条 / 需留意 8 条 / 正向 5 条（含派生判断）。
 * 纯正则、无网络、零 LLM 成本——这类判断绝不能交给模型。
 */

export type RiskGroup = "红线" | "需留意" | "正向";

interface Rule {
  group: RiskGroup;
  name: string;
  rx: RegExp;
  note: string;
}

type RawRule = [RiskGroup, string, RegExp, string];

const RAW_RULES: RawRule[] = [
  // ---------- 红线：命中即建议婉拒 ----------
  ["红线", "先做后付", /(先做|先干|先开发|先帮我做|先出个|做好了|做完(了)?(再|之后)).{0,14}(谈|说|聊|算)?\s*(钱|费用|价格|报价|预算)/, "白嫖概率接近 100%，没有预算就没有优先级"],
  ["红线", "拒绝书面", /(语音|打电话|电话里|电话沟通).{0,8}(聊|说|沟通|就行|比较好)|不用(写|发|整理)(邮件|文档|需求)|口头(说|讲|答应)就行/, "需求变更时你会听到\"我没说过\""],
  ["红线", "纯比价", /(别人|有人|其他|另一家|之前那家|朋友|同行).{0,10}(报价|价格|才报|只要|给).{0,6}\d|报价(是|才).{0,4}(你的)?(一半|三分之|几分之)/, "决策逻辑是谁便宜找谁，永远不会有满意价格"],
  ["红线", "换过多家外包", /(换过|换了|找过).{0,5}(三|3|四|4|几|好几).{0,4}(家|个|波)/, "要么甲方挑剔，要么需求本身不成立"],
  ["红线", "说不清目的", /(先做出来|试试看|做着玩|看看效果|先上线再说|别人都有|大家都做)/, "项目优先级低，随时搁置，你的排期白排"],
  ["红线", "低估工作量", /(这个|这|那个).{0,6}(很|挺|超)?简单(吧|嘛|的嘛|啊)|简单(搞|弄|做)一下|顺手(做|弄|加)/, "不认可工作量的人，也不会认可你花的时间"],

  // ---------- 需留意：提高定金、收窄范围 ----------
  ["需留意", "预算缺失或含糊", /(不清楚|不知道|你(说|定|报)|看着给|市场价).{0,10}(预算|价格|报价|多少钱)|(预算|价格|报价).{0,6}(不清楚|不知道|没定|待定|再说|你(说|定|报))/, "连预算都没有的项目，优先级通常也最低"],
  ["需留意", "无明确期限", /(不着急|慢慢来|有时间就|不急|什么时候都行)/, "没有 deadline = 没有验收压力 = 尾款无限拖"],
  ["需留意", "免费试探", /(免费|白帮忙|帮我看(一下|看)|先试用|试做|练手)/, "免费开口子 = 免费 on-call"],
  ["需留意", "范围蔓延预兆", /(顺便|再加|能不能再|另外再|既然做了|一起做(了)?吧|改一下又不难)/, "范围蔓延的起点，必须走变更流程"],
  ["需留意", "压价", /(便宜(点|些)|能不能少|打个折|优惠|太高了|超预算)/, "先降范围，不降价格"],
  ["需留意", "拖延付款", /(下周|月底|走完流程|财务|老板批).{0,8}(付|打款|结|给钱)|钱(马上|很快)(到|就)/, "付款条件要绑定可验证事件，不绑日期"],
  ["需留意", "多人决策", /(问一下|问下|跟|和).{0,6}(老板|领导|合伙人|技术|他们).{0,6}(确认|商量|汇报|决定)/, "确认可能被推翻，合同需指定唯一授权代表"],
  ["需留意", '只说"好用"这类模糊词', /(不好用|不满意|感觉(不对|不行)|体验不好|差(点|点意思))/, "模糊词可被定义成任何东西，验收标准必须可判定"],

  // ---------- 正向信号 ----------
  ["正向", "有具体预算", /预算.{0,8}\d|\d+(\.\d+)?\s*(万|千|k|K|元|块)/, "有预期就有谈判空间"],
  ["正向", "有明确期限", /(\d+月\d+[日号]|\d+\/\d+|下(周|个?月)|月底|季度末|上线前|deadline|必须.{0,6}(上线|交付))/, "有截止日期和决策压力，交付意愿强"],
  ["正向", "有可量化目标", /(转化率|提升|降低|节省|减少|提高到|做到|涨到).{0,8}\d|(\d+%|\d+倍)/, "有可量化指标 = 靠谱客户，也给了你验收抓手"],
  ["正向", "认作品而来", /(看到你(的|写的)|用过你|你那个|你写的|你的(项目|工具|文章)|朋友推荐|别人推荐)/, "信任成本接近零，价格敏感度显著更低"],
  ["正向", "愿意书面确认", /(邮件|文档|合同|确认书|签字|盖章|书面)/, "愿意留痕的客户，后续扯皮概率低"],
];

const RULES: Rule[] = RAW_RULES.map(([group, name, rx, note]) => ({
  group,
  name,
  rx,
  note,
}));

export interface Hit {
  line: number;
  group: RiskGroup;
  name: string;
  match: string;
  note: string;
  text: string;
}

/** 逐行扫描（同 Python：同一行命中风险信号时，不计入该行正向信号） */
export function scanText(text: string): Hit[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const hits: Hit[] = [];
  lines.forEach((line, idx) => {
    if (!line) return;
    let lineHits: Hit[] = [];
    for (const r of RULES) {
      const m = line.match(r.rx);
      if (m) {
        lineHits.push({
          line: idx + 1,
          group: r.group,
          name: r.name,
          match: m[0],
          note: r.note,
          text: line.slice(0, 80),
        });
      }
    }
    if (lineHits.some((h) => h.group === "红线" || h.group === "需留意")) {
      lineHits = lineHits.filter((h) => h.group !== "正向");
    }
    hits.push(...lineHits);
  });
  return hits;
}

/** 生成结论（与 Python 版判定逻辑一致） */
export function buildRiskReport(hits: Hit[]) {
  const order: Record<RiskGroup, number> = { 红线: 0, 需留意: 1, 正向: 2 };
  const sorted = [...hits].sort(
    (a, b) => order[a.group] - order[b.group] || a.line - b.line,
  );
  const red = sorted.filter((h) => h.group === "红线");
  const warn = sorted.filter((h) => h.group === "需留意");
  const good = sorted.filter((h) => h.group === "正向");

  let verdict: string;
  let advice: string;
  if (red.length) {
    verdict = "婉拒";
    advice =
      `命中 ${red.length} 条红线信号 → 建议婉拒，或至少要求提高定金至 50% 并大幅收窄范围。` +
      (red.length >= 2 ? " 红线命中 2 条及以上，不要接。省下的时间比这单的钱值。" : "");
  } else if (warn.length >= 2) {
    verdict = "条件接";
    advice =
      `命中 ${warn.length} 条需留意信号 → 条件接。` +
      "条件：定金不低于 50%、需求文档必须书面确认、验收期限写进合同。";
  } else if (warn.length) {
    verdict = "可接（补条款）";
    advice = "1 条需留意信号 → 可接，但把这一条在合同里补掉。";
  } else {
    const core = new Set(["有具体预算", "有明确期限", "有可量化目标"]);
    const got = [...new Set(good.map((h) => h.name))].filter((n) => core.has(n));
    if (got.length === 3) {
      verdict = "可接";
      advice =
        "三问齐了（预算 / 时间点 / 可量化目标都有明确回答）→ 可进入报价阶段。" +
        "下一步：出报价单 + 合同，定金不低于 30%，到账再开工。";
    } else {
      verdict = "可继续推进（信息不全）";
      const missing = ["有具体预算", "有明确期限", "有可量化目标"].filter(
        (n) => !got.includes(n),
      );
      advice = `未命中红线 → 可继续推进，但三问还缺：${missing.join("、")}。`;
    }
  }

  return {
    verdict,
    advice,
    counts: { red: red.length, warn: warn.length, good: good.length },
    redNames: [...new Set(red.map((h) => h.name))],
    warnNames: [...new Set(warn.map((h) => h.name))],
    goodNames: [...new Set(good.map((h) => h.name))],
    hits: sorted.map((h) => ({
      line: h.line,
      group: h.group,
      name: h.name,
      match: h.match,
      note: h.note,
    })),
    manualChecks: [
      "他有没有在周末或深夜给你发需求？（没有边界感的客户，交付后也没有）",
      "对接人是不是付款人？若不是，要确认谁是授权代表。",
    ],
  };
}
