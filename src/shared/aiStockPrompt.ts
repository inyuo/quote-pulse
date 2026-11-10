/**
 * 个股 AI 分析的提示词与上下文构建（纯函数，不依赖 vscode / 网络）。
 *
 * 宿主只负责并发取数；裁剪、统计、附录排版与提示词集中在此，便于单测钉住契约。
 * 设计要点：
 * - 资金流/成交额都是「分时累计序列」，摘要里明确禁止逐点求和、禁止当股价；
 * - 长日线等间隔采样，避免近 1 年 CSV 直接撑爆上下文；
 * - 缺失维度统一标注，配合 system 的防幻觉约束。
 */

export const AI_STOCK_SYSTEM_PROMPT = [
  '你是一名严谨的 A 股/港股量化研究助理，擅长把历史行情、量价、资金流与资讯交叉验证后给出可复核的分析。请始终使用中文回答。',
  '',
  '工作准则：',
  '1. 只依据用户消息中提供的数据作答；不得虚构或补全任何价格、成交额、资金数值、新闻标题与日期。数据缺失时明确写「该维度数据缺失」并跳过相关推断。',
  '2. 区分数据事实与推断：结论必须能追溯到具体数值，并在「数据依据」里注明来源段落。',
  '3. 注意数据语义：「分时累计成交额」「分时累计主力净流入」都是累计序列，不能把各时点数值求和；不得把累计成交额当作股价；金额与百分比单位按原文使用。',
  '4. 不提供买卖点、目标价或收益承诺；涉及操作层面只给「需要验证的信号」。',
  '5. 所有数据均为历史或盘中快照，必须说明时效性；结尾附免责声明。',
].join('\n');

/** 带正负号的金额缩写，与资金动态页面口径一致 */
function fmtAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}元`;
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/**
 * 前复权日线 CSV（倒序，首行最新）→ 区间统计摘要。
 * 交给模型的是算好的数值，而不是让它自己从几百行里推算。
 */
export function summarizeQfqCsv(csv: string): string {
  const lines = (typeof csv === 'string' ? csv : '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 3) return '';

  const rows = lines
    .slice(1)
    .map((line) => line.split(','))
    .filter((cells) => cells.length >= 7);
  if (rows.length < 2) return '';

  const closes = rows
    .map((cells) => Number(cells[2]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (closes.length < 2) return '';

  const latest = closes[0];
  const earliest = closes[closes.length - 1];
  const change = (latest / earliest - 1) * 100;
  const high = Math.max.apply(null, closes);
  const low = Math.min.apply(null, closes);

  const volumes = rows
    .map((cells) => Number(cells[6]))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avgVol = volumes.length
    ? volumes.reduce((a, b) => a + b, 0) / volumes.length
    : 0;
  const recent = volumes.slice(0, Math.min(5, volumes.length));
  const recentAvg = recent.length
    ? recent.reduce((a, b) => a + b, 0) / recent.length
    : 0;
  const volDelta = avgVol > 0 ? (recentAvg / avgVol - 1) * 100 : 0;

  return [
    `- 数据范围：${rows[rows.length - 1][0]} ~ ${rows[0][0]}，共 ${rows.length} 个交易日（CSV 倒序，首行最新）`,
    `- 区间涨跌幅：${signed(change)}%（按首末收盘价计算）`,
    `- 最高收盘 ${high.toFixed(2)}，最低收盘 ${low.toFixed(2)}，最新收盘 ${latest.toFixed(2)}`,
    `- 量能：全区间日均成交量 ${avgVol.toFixed(0)} 手，最近 ${recent.length} 日 ${recentAvg.toFixed(0)} 手（较区间均值 ${signed(volDelta)}%）`,
  ].join('\n');
}

/** 超长日线等间隔采样，保留表头与首末行，避免上下文膨胀 */
export function compactQfqCsv(csv: string, maxRows = 120): { text: string; sampled: boolean } {
  const text = typeof csv === 'string' ? csv : '';
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const limit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 120;
  if (lines.length <= limit + 1) return { text, sampled: false };

  const header = lines[0];
  const data = lines.slice(1);
  const picked: string[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (data.length - 1)) / Math.max(1, limit - 1));
    picked.push(data[idx]);
  }
  const unique = picked.filter((line, i) => i === 0 || line !== picked[i - 1]);
  return { text: [header].concat(unique).join('\n'), sampled: true };
}

/**
 * 量价分层（analy.get_share_cjl）→ 附录。
 * price 是分时累计成交额序列，不是股价，也不是价格分层档位。
 */
export function buildCjlAppendixForAi(cjl: any): string {
  if (!cjl || !Array.isArray(cjl.price)) return '';
  const price = cjl.price.filter(
    (v: any) => typeof v === 'number' && Number.isFinite(v)
  ) as number[];
  if (price.length < 2) return '';

  const n = price.length;
  const first = price[0];
  const last = price[n - 1];
  const delta = last - first;
  const deltas = price.slice(1).map((v, i) => v - price[i]);

  let maxIdx = 0;
  let maxDelta = -Infinity;
  deltas.forEach((d, i) => {
    if (d > maxDelta) {
      maxDelta = d;
      maxIdx = i + 1;
    }
  });

  const tailN = Math.min(20, deltas.length);
  const tailDelta = deltas.slice(-tailN).reduce((a, b) => a + b, 0);
  const pct = delta !== 0 ? (tailDelta / delta) * 100 : 0;
  const tailPoints = price.slice(-10).map((v) => v.toFixed(2)).join(' → ');

  return [
    `数据日期：${String(cjl.tm || '未知')}；时点数：${n}；口径：分时累计成交额（非股价、非价格分层），单位为接口原值。`,
    `- 累计成交额：起始 ${first.toFixed(2)}，最新 ${last.toFixed(2)}，区间净增 ${signed(delta)}`,
    `- 单时点最大增量：第 ${maxIdx} 个时点 ${signed(maxDelta)}`,
    `- 尾段 ${tailN} 个时点增量合计 ${signed(tailDelta)}（占全段 ${pct.toFixed(2)}%）`,
    `- 最近 10 个时点累计值：${tailPoints}`,
  ].join('\n');
}

/**
 * 资金动态页的个股详情 + 行业资金流 → 附录。
 * 覆盖实时行情、分时主力资金、量化结论、所属板块、资金三表与行业 Top10。
 */
export function buildFundFlowAppendixForAi(detail: any, industries: any[]): string {
  if (!detail || typeof detail !== 'object') return '';
  const parts: string[] = [];

  const quote: string[] = [];
  if (typeof detail.price === 'number' && Number.isFinite(detail.price) && detail.price > 0) {
    quote.push(`现价 ${detail.price.toFixed(2)} 元`);
    if (typeof detail.percent === 'number' && Number.isFinite(detail.percent)) {
      quote.push(`涨跌幅 ${signed(detail.percent)}%`);
    }
  }
  if (quote.length) parts.push(`【实时行情】${quote.join('，')}`);

  const flow = detail.mainFlow;
  if (flow && Array.isArray(flow.main) && flow.main.length) {
    const main = flow.main.filter(
      (v: any) => typeof v === 'number' && Number.isFinite(v)
    ) as number[];
    if (main.length) {
      const current = main[main.length - 1];
      const peak = Math.max.apply(null, main);
      const tail = main.slice(-20).map(fmtAmount).join(' → ');
      parts.push(
        [
          `【分时主力资金】口径：分时累计主力净流入（累计序列，不可逐点求和）；数据时间 ${String(flow.tm || '未知')}，时点数 ${main.length}`,
          `- 当前累计净流入：${fmtAmount(current)}；区间峰值：${fmtAmount(peak)}`,
          `- 末 ${Math.min(20, main.length)} 个时点：${tail}`,
        ].join('\n')
      );
    }
  }

  if (Array.isArray(detail.analysis) && detail.analysis.length) {
    const lines = detail.analysis
      .filter(
        (g: any) => g && typeof g.name === 'string' && Array.isArray(g.msgs) && g.msgs.length
      )
      .map(
        (g: any) =>
          `【${g.name}】${g.msgs.filter((m: any) => typeof m === 'string').join('；')}`
      );
    if (lines.length) parts.push(`【第三方量化结论】\n${lines.join('\n')}`);
  }

  if (Array.isArray(detail.sectors) && detail.sectors.length) {
    const lines = detail.sectors
      .filter((s: any) => s && typeof s.name === 'string' && s.name)
      .map((s: any) => {
        const p = Number(s.percent) || 0;
        return `- ${s.name} ${signed(p)}%`;
      });
    if (lines.length) parts.push(`【所属板块】\n${lines.join('\n')}`);
  }

  if (Array.isArray(detail.fundTables) && detail.fundTables.length) {
    const lines: string[] = [];
    for (const t of detail.fundTables) {
      if (!t || typeof t.title !== 'string' || !t.title) continue;
      const header = Array.isArray(t.columns)
        ? t.columns.filter((c: any) => c !== null && c !== undefined && c !== '').join(' | ')
        : '';
      const rows: string[] = Array.isArray(t.rows)
        ? t.rows
            .map((r: any) =>
              r && Array.isArray(r.cells)
                ? r.cells
                    .filter((c: any) => c !== null && c !== undefined && c !== '')
                    .join(' | ')
                : ''
            )
            .filter(Boolean)
        : [];
      if (!rows.length) continue;
      lines.push(`【${t.title}】${header ? `\n${header}` : ''}\n${rows.join('\n')}`);
    }
    if (lines.length) {
      parts.push(`【资金动态三表（主力分析/主力资金/明-暗盘，需登录）】\n${lines.join('\n\n')}`);
    }
  }

  if (Array.isArray(industries) && industries.length) {
    const rows = industries
      .filter(
        (r: any) =>
          r && typeof r.name === 'string' && r.name && Number.isFinite(Number(r.amount))
      )
      .sort((a: any, b: any) => Number(b.amount) - Number(a.amount))
      .slice(0, 10)
      .map((r: any, i: number) => `${i + 1}. ${r.name} ${fmtAmount(Number(r.amount))}`);
    if (rows.length) {
      parts.push(`【行业资金流排名 Top${rows.length}（当日主力净流入）】\n${rows.join('\n')}`);
    }
  }

  return parts.length ? parts.join('\n\n') : '';
}

export interface AiStockPromptInput {
  name: string;
  code: string;
  rangeLabel: string;
  asOf: string;
  qfqCsv: string;
  qfqSourceLabel: string;
  /** 兼容旧调用方；是否采样由 compactQfqCsv 自行判断 */
  qfqSampled?: boolean;
  newsAppendix: string;
  fundFlowAppendix: string;
  cjlAppendix: string;
}

/** 组装最终的两条消息：固定 system + 结构化 user */
export function buildAiStockAnalysisPrompt(
  input: AiStockPromptInput
): { system: string; user: string } {
  const i = (input || {}) as AiStockPromptInput;
  const name = String(i.name || '该股票');
  const code = String(i.code || '未知');
  const rangeLabel = String(i.rangeLabel || '近期');
  const asOf = String(i.asOf || '抓取时点');
  const source = String(i.qfqSourceLabel || '未提供');
  const csv = typeof i.qfqCsv === 'string' ? i.qfqCsv : '';

  const summary = summarizeQfqCsv(csv);
  const compacted = compactQfqCsv(csv);
  const totalRows = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;
  const keptRows = compacted.text.trim()
    ? compacted.text.trim().split(/\r?\n/).length - 1
    : 0;
  const qfqText = compacted.text
    ? `${
        compacted.sampled
          ? `（共 ${totalRows} 行，已按等间隔采样保留 ${keptRows} 行）`
          : '（全量）'
      }\n${compacted.text}`
    : '该维度数据缺失';

  const user = [
    `【任务】基于下列多源数据快照，对 ${name}（股票代码 ${code}）做一次结构化个股分析。`,
    `【区间与时效】历史行情：${rangeLabel}（前复权日线，来源 ${source}）；量价、资金与资讯为 ${asOf} 抓取的快照，非实时行情。`,
    '【数据边界】仅使用下方数据；标注「该维度数据缺失」的部分不得补充外部数据或编造数值；「分时累计成交额」与「分时累计主力净流入」都是累计序列，不能逐点求和，也不得把成交额当作股价；金额与百分比单位按原文（万元/元/手/%）。',
    '【输出格式】中文 Markdown，严格按以下小节输出，每节 2-5 条要点并引用具体数值与来源段落：',
    '## 1. 结论',
    '一句话结论 + 倾向（偏多/中性/偏空）+ 置信度（高/中/低，并说明缺失数据的影响）',
    '## 2. 数据依据',
    '### 历史行情',
    '### 量价分层',
    '### 资金动态',
    '### 个股资讯',
    '## 3. 量价与资金解读',
    '趋势、量能变化、量价与资金是否背离',
    '## 4. 风险提示',
    '至少 2 条，须包含数据时效与缺失项',
    '## 5. 后续关注要点',
    '列出需要验证的信号，不给买卖指令、目标价或收益承诺',
    '## 6. 免责声明',
    '本内容由 AI 基于公开数据生成，仅供研究参考，不构成投资建议。',
    '',
    '【区间统计摘要（由前复权日线计算，非模型推算）】',
    summary || '该维度数据缺失',
    '',
    `【数据 1｜前复权日线】（来源：${source}；单位：价格元、成交量手、成交额万元）`,
    qfqText,
    '',
    '【数据 2｜量价分层（分时累计成交额）】',
    String(i.cjlAppendix || '') || '该维度数据缺失',
    '',
    '【数据 3｜资金动态】',
    String(i.fundFlowAppendix || '') || '该维度数据缺失',
    '',
    '【数据 4｜个股资讯】',
    String(i.newsAppendix || '') || '该维度数据缺失',
  ].join('\n');

  return { system: AI_STOCK_SYSTEM_PROMPT, user };
}

/**
 * 宿主侧固定错误文案。
 * 优化后的提示词要求模型在「风险提示」里写数据缺失/不可用，
 * 因此不能用 /不可用|失败|抱歉/ 之类模糊关键词去判定模型正文，必须精确比对。
 */
export const AI_CONFIG_MISSING = 'AI配置不完整,请检查配置';
export const AI_SERVICE_DOWN = '抱歉，AI服务暂时不可用，请稍后再试';
export const AI_EMPTY_REPLY = '抱歉，我没有收到回复';

export function classifyAiResult(result: any): 'config' | 'service' | 'ok' {
  const text = typeof result === 'string' ? result.trim() : '';
  if (text === AI_CONFIG_MISSING) return 'config';
  if (text === AI_SERVICE_DOWN || text === AI_EMPTY_REPLY) return 'service';
  return 'ok';
}

export default {
  AI_STOCK_SYSTEM_PROMPT,
  AI_CONFIG_MISSING,
  AI_SERVICE_DOWN,
  AI_EMPTY_REPLY,
  summarizeQfqCsv,
  compactQfqCsv,
  buildCjlAppendixForAi,
  buildFundFlowAppendixForAi,
  buildAiStockAnalysisPrompt,
  classifyAiResult,
};
