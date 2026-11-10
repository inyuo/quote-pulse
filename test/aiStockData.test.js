/**
 * AI 分析股票的取数链路测试：
 * 1) 搜狐 JSONP 原文 → 干净 CSV（A 股分支此前直接把 JSONP + GBK 乱码塞给模型）
 * 2) 韭研请求超时后应重试（接口实测 0.7s~25.7s 剧烈波动，15s 超时经常触发）
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const vscodeMockPath = path.join(__dirname, 'helpers', 'vscode-mock.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return vscodeMockPath;
  return origResolve.call(this, request, ...args);
};

const { parseSohuQfqToCsv, fetchRecentQfqTradeDataForAi } = require('../out/shared/aiStockHistoryData');

/** 搜狐 hisHq 真实 JSONP 片段（字段：日期,开盘,收盘,涨跌额,涨跌幅,最低,最高,成交量,成交额,换手率,振幅） */
const SOHU_JSONP =
  'historySearchHandler([{"status":0,"hq":[["2026-10-16","1311.57","1329.00","16.03","1.22%","1301.68","1329.88","38502","507552.00","0.31%","20.00"],["2026-10-15","1286.00","1312.97","26.97","2.10%","1282.00","1317.76","57677","753770.00","0.46%","21.00"]],"code":"cn_600519","stat":["�ۼ�:","2026-07-20��2026-10-16","76.00","6.07%"]}])';

describe('搜狐 JSONP → CSV 清洗', () => {
  it('输出 CSV 表头与数据行，不再包含 JSONP 包装', () => {
    const csv = parseSohuQfqToCsv(SOHU_JSONP);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '日期,开盘,收盘,涨跌幅,最低,最高,成交量(手),成交额(万)');
    assert.strictEqual(lines[1], '2026-10-16,1311.57,1329.00,1.22%,1301.68,1329.88,38502,507552.00');
    assert.strictEqual(lines[2], '2026-10-15,1286.00,1312.97,2.10%,1282.00,1317.76,57677,753770.00');
  });

  it('丢弃 stat 字段（该处为 GBK 乱码，会污染模型输入）', () => {
    const csv = parseSohuQfqToCsv(SOHU_JSONP);
    assert.ok(!csv.includes('historySearchHandler'), '不应含 JSONP 包装');
    assert.ok(!csv.includes('stat'), '不应含 stat 字段');
    assert.ok(!csv.includes('�'), '不应含解码失败的乱码');
  });

  it('非法输入返回空串而不是抛异常', () => {
    assert.strictEqual(parseSohuQfqToCsv(''), '');
    assert.strictEqual(parseSohuQfqToCsv('not jsonp'), '');
    assert.strictEqual(parseSohuQfqToCsv('historySearchHandler([{"status":1,"hq":[]}])'), '');
  });

  it('A 股分支最终产出 CSV（fetchRecentQfqTradeDataForAi）', async () => {
    const { text } = await fetchRecentQfqTradeDataForAi('sh600519', '1w');
    if (!text) return; // 网络不可用时跳过，不在单测里依赖外网
    assert.ok(text.startsWith('日期,开盘,收盘'), `应为 CSV，实际开头：${text.slice(0, 40)}`);
    assert.ok(!text.includes('historySearchHandler'), '不应把 JSONP 原文交给模型');
  });
});

describe('韭研请求超时重试', () => {
  const axios = require('axios');
  const originalPost = axios.post;
  afterEach(() => {
    axios.post = originalPost;
  });

  const okResult = {
    status: 200,
    data: { errCode: '0', data: { result: [{ article_id: 'a1', is_top: 0, title: '标题', content: '', create_time: '2026-10-19 09:00:00', stock_list: [] }] } },
  };

  it('首次超时后应自动重试并拿到数据', async () => {
    const { fetchJYGCommunityNews } = require('../out/webview/jiuyangongshe-news');
    let calls = 0;
    axios.post = async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('timeout of 15000ms exceeded');
        err.code = 'ECONNABORTED';
        throw err;
      }
      return okResult;
    };

    const list = await fetchJYGCommunityNews(5);
    assert.strictEqual(calls, 2, `超时后应重试一次，实际请求 ${calls} 次`);
    assert.strictEqual(list.length, 1, '重试成功后应返回数据');
  });

  it('持续失败时返回空数组而不是抛异常', async () => {
    const { fetchJYGCommunityNews } = require('../out/webview/jiuyangongshe-news');
    axios.post = async () => {
      const err = new Error('timeout of 15000ms exceeded');
      err.code = 'ECONNABORTED';
      throw err;
    };
    const list = await fetchJYGCommunityNews(5);
    assert.deepStrictEqual(list, []);
  });
});

describe('韭研新闻附录 buildJygNewsAppendix', () => {
  it('有条目 → 关键词标注 + 逐条 [时间] 标题 + warn_words/正文摘要', () => {
    const { buildJygNewsAppendix } = require('../out/webview/jiuyangongshe-news');
    const text = buildJygNewsAppendix('贵州茅台', [
      { create_time: '2026-11-04 09:30:00', title: '公告A', content: 'x'.repeat(400), warn_words: '减持' },
      { title: '公告B', content: '短内容' },
    ]);
    assert.ok(text.includes('韭研公社该股新闻（关键词：贵州茅台）'), text);
    assert.ok(text.includes('[2026-11-04 09:30:00] 公告A'), text);
    assert.ok(text.includes('warn_words: 减持'), text);
    assert.ok(text.includes('…'), '超长正文应截断');
    assert.ok(text.includes('公告B'), text);
  });

  it('空/非数组返回空串', () => {
    const { buildJygNewsAppendix } = require('../out/webview/jiuyangongshe-news');
    assert.strictEqual(buildJygNewsAppendix('x', []), '');
    assert.strictEqual(buildJygNewsAppendix('x', null), '');
  });
});

describe('个股 AI 分析提示词与上下文 aiStockPrompt', () => {
  const prompt = require('../out/shared/aiStockPrompt');

  const CSV = [
    '日期,开盘,收盘,涨跌幅,最低,最高,成交量(手),成交额(万)',
    '2026-11-07,101,105,1.20%,100,106,1000,5000',
    '2026-11-06,100,102,0.50%,99,103,800,4000',
    '2026-11-05,99,100,0.10%,98,101,600,3000',
    '2026-11-04,98,99,-0.20%,97,100,500,2500',
    '2026-11-03,97,100,0.30%,96,101,400,2000',
  ].join('\n');

  it('区间统计摘要：涨跌幅、收盘高低、量能变化，空输入返回空串', () => {
    const s = prompt.summarizeQfqCsv(CSV);
    assert.ok(s.includes('区间涨跌幅') && s.includes('5.00%'), `应给出区间涨跌幅，实际：${s}`);
    assert.ok(s.includes('最高收盘') && s.includes('最低收盘'), s);
    assert.ok(s.includes('量能'), s);
    assert.strictEqual(prompt.summarizeQfqCsv(''), '');
    assert.strictEqual(prompt.summarizeQfqCsv('日期,开盘,收盘'), '');
  });

  it('超长日线按等间隔采样并标记，未超限原样返回', () => {
    const rows = [];
    for (let i = 0; i < 200; i++) {
      rows.push(`2026-01-${String(i + 1).padStart(2, '0')},1,${i + 1},0%,1,1,${100 + i},100`);
    }
    const long = '日期,开盘,收盘,涨跌幅,最低,最高,成交量(手),成交额(万)\n' + rows.join('\n');
    const r = prompt.compactQfqCsv(long, 50);
    assert.strictEqual(r.sampled, true);
    assert.ok(r.text.split('\n').length <= 51, `采样后行数应受控：${r.text.split('\n').length}`);
    assert.ok(r.text.startsWith('日期,开盘,收盘'), '应保留表头');

    const short = prompt.compactQfqCsv(CSV, 50);
    assert.strictEqual(short.sampled, false);
    assert.strictEqual(short.text, CSV);
  });

  it('量价分层附录：标注累计成交额口径、时点数、增量峰值与尾段占比', () => {
    const price = [];
    let acc = 100;
    for (let i = 0; i < 30; i++) {
      acc += i === 10 ? 50 : 5;
      price.push(acc);
    }
    const s = prompt.buildCjlAppendixForAi({ tm: '2026-11-07', price });
    assert.ok(s.includes('分时累计成交额') && s.includes('非股价'), s);
    assert.ok(s.includes('时点数：30'), s);
    assert.ok(s.includes('单时点最大增量'), s);
    assert.ok(s.includes('尾段'), s);
    assert.strictEqual(prompt.buildCjlAppendixForAi(null), '');
    assert.strictEqual(prompt.buildCjlAppendixForAi({ tm: '', price: [] }), '');
  });

  it('资金动态附录：实时行情/分时主力/板块/三表/行业 Top10，脏数据不产生 undefined', () => {
    const detail = {
      code: 'sh600519',
      name: '贵州茅台',
      price: 1333.1,
      percent: -0.14,
      mainFlow: { tm: '09:30-15:00', main: [1000, 2000, 3000], price: [] },
      analysis: [{ name: 'PEG估值', msgs: ['peg:-4.9'] }],
      sectors: [{ name: '白酒', percent: 1.2 }],
      fundTables: [
        { title: '主力分析', columns: ['日期', '得分'], rows: [{ cells: ['11-07', '77'] }] },
      ],
    };
    const industries = Array.from({ length: 15 }, (_, i) => ({
      code: 'BK' + i,
      name: '行业' + i,
      amount: 100 - i,
      ratio: 1,
    }));
    const s = prompt.buildFundFlowAppendixForAi(detail, industries);
    assert.ok(s.includes('实时行情') && s.includes('1333.10') && s.includes('-0.14'), s);
    assert.ok(s.includes('分时主力') && s.includes('累计'), s);
    assert.ok(s.includes('白酒'), s);
    assert.ok(s.includes('主力分析') && s.includes('77'), s);
    assert.ok(s.includes('行业资金流') && s.includes('行业9'), s);
    assert.ok(!s.includes('行业14'), '行业排名应限制 Top10');
    assert.ok(!s.includes('undefined'), `脏数据不应出现 undefined：${s}`);
    assert.strictEqual(prompt.buildFundFlowAppendixForAi(null, []), '');
  });

  it('system prompt：中文、只用给定数据、禁止编造、累计序列语义、免责声明', () => {
    const s = prompt.AI_STOCK_SYSTEM_PROMPT;
    assert.ok(s.includes('中文'));
    assert.ok(s.includes('不得') || s.includes('禁止'));
    assert.ok(s.includes('免责') || s.includes('不构成投资建议'));
    assert.ok(s.includes('累计') && s.includes('求和'), '应提示累计序列语义');
  });

  it('user prompt：结构化小节 + 数据边界 + 统计摘要 + 四类数据，缺失维度明确标注', () => {
    const { system, user } = prompt.buildAiStockAnalysisPrompt({
      name: '贵州茅台',
      code: 'sh600519',
      rangeLabel: '近3个月',
      asOf: '2026-11-07',
      qfqCsv: CSV,
      qfqSourceLabel: '搜狐财经',
      qfqSampled: false,
      newsAppendix: '',
      fundFlowAppendix: '资金段',
      cjlAppendix: '',
    });
    assert.ok(system.length > 50);
    assert.ok(user.includes('【任务】') && user.includes('贵州茅台') && user.includes('sh600519'), user);
    assert.ok(user.includes('近3个月') && user.includes('搜狐财经'), user);
    assert.ok(user.includes('## 1. 结论') && user.includes('## 6. 免责声明'), '应给出结构化输出小节');
    assert.ok(user.includes('累计成交额'), user);
    assert.ok(user.includes('区间统计摘要') && user.includes('5.00%'), user);
    assert.ok(user.includes('【数据 3｜资金动态】') && user.includes('资金段'), user);
    assert.ok(user.includes('该维度数据缺失'), '空附录应明确标注缺失');
    assert.ok(!user.includes('undefined'), user);
  });

  it('宿主改用新提示词与资金动态/量价分层取数', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'webview', 'stock-news-view.ts'),
      'utf8'
    );
    assert.ok(src.includes('AI_STOCK_SYSTEM_PROMPT'), 'system 应使用统一常量');
    assert.ok(src.includes('buildAiStockAnalysisPrompt'), 'user 应由纯函数构建');
    assert.ok(src.includes('loadStockDetail') && src.includes('loadIndustryRows'), '应取资金动态个股详情与行业排名');
    assert.ok(src.includes('fetchShareCjl'), '应取量价分层数据');
    assert.ok(src.includes('classifyAiResult'), '结果判定应走精确分类，避免误伤模型正文');
  });

  it('结果判定：只认宿主固定错误文案，模型正文含「不可用/失败」不误判', () => {
    assert.strictEqual(typeof prompt.classifyAiResult, 'function', '应导出结果判定函数');
    assert.strictEqual(prompt.classifyAiResult('AI配置不完整,请检查配置'), 'config');
    assert.strictEqual(prompt.classifyAiResult('抱歉，AI服务暂时不可用，请稍后再试'), 'service');
    assert.strictEqual(prompt.classifyAiResult('抱歉，我没有收到回复'), 'service');
    assert.strictEqual(
      prompt.classifyAiResult('## 4. 风险提示\n- 部分资金数据不可用，结论置信度低'),
      'ok'
    );
    assert.strictEqual(prompt.classifyAiResult(''), 'ok');
  });
});
