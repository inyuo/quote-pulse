/**
 * 资金动态窗口模板行为测试（伪 DOM 执行内联 script）：
 * 1) 右栏三块资金表格（主力分析 / 主力资金 / 明-暗盘）跟随选中个股渲染
 * 2) 未登录（fundTables 为空）时右栏整块不显示
 * 3) 顶栏股票下拉仍可切换个股
 * 4) 第三方量化分析按分组卡片渲染
 *
 * 模板是纯字符串拼接渲染，没有 DOM 依赖，用轻量桩即可断言 innerHTML。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadTemplate } = require('./helpers/webview-dom');

/** init 数据：股票下拉 + 行业列表 */
function initData(stocks) {
  return {
    type: 'init',
    data: {
      stocks,
      industry: [{ code: 'BK1', name: '通信', amount: 100, ratio: 1.5 }],
      total: stocks.length,
      initialCode: '',
      updatedAt: new Date().toISOString(),
    },
  };
}

function detailData(fundTables) {
  return {
    type: 'detail',
    data: {
      code: 'sz000977',
      name: '浪潮信息',
      price: 57.35,
      percent: 2.87,
      mainFlow: null,
      analysis: [],
      sectors: [],
      fundTables,
    },
  };
}

const TABLES = [
  {
    title: '主力分析',
    columns: ['分析日', '主力成本(占比)', '排名', '得分'],
    rows: [{ cells: ['2026-11-04', '53.56(38.74%)', '167(-809)', '77.24'], color: '#008000' }],
  },
  {
    title: '主力资金',
    columns: ['日期', '净流入', '累积', '资金评分'],
    rows: [{ cells: ['2026-11-04', '2.24亿', '2.24亿', '0.00'], color: '#ff0000' }],
  },
  {
    title: '明/暗盘',
    columns: ['日期', '暗盘', '明盘', '净流入'],
    rows: [{ cells: ['2026-11-04', '3.28亿', '2.23亿', '5.51亿'], color: '#ff0000' }],
  },
];

describe('资金动态模板 stock-fund-flow.html', () => {
  it('三块资金表格板块排在布局右侧，主内容列在左', () => {
    const htmlSrc = fs.readFileSync(
      path.join(__dirname, '..', 'template', 'stock-fund-flow.html'),
      'utf8'
    );
    // grid 列序：300px 列在右（fr 在前），fundPanel 靠 order 排到第二列
    assert.ok(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/.test(htmlSrc),
      'grid 应为「主内容列 + 右栏 300px」的列序'
    );
    assert.ok(/#fundPanel\s*\{[^}]*order:\s*2/.test(htmlSrc), 'fundPanel 应 order:2 排到右侧');
    assert.ok(/\.layout\s*>\s*div\s*\{[^}]*order:\s*1/.test(htmlSrc), '主内容列应 order:1 排在左侧');
    // 提示文案不能再指向左栏
    assert.ok(!htmlSrc.includes('点击左侧'), '提示文案不应再出现「点击左侧」');
  });

  it('右栏渲染三块资金表格：标题、表头、行值与颜色', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', { data: detailData(TABLES) });

    const html = page.el('fundTables').innerHTML;
    assert.ok(html.includes('主力分析'), `应渲染第一块标题，实际：${html.slice(0, 200)}`);
    assert.ok(html.includes('主力资金'), '应渲染第二块标题');
    assert.ok(html.includes('明/暗盘'), '应渲染第三块标题');
    assert.ok(html.includes('主力成本(占比)'), '应渲染 4 列表头');
    assert.ok(html.includes('53.56(38.74%)'), '应渲染行值');
    assert.ok(html.includes('5.51亿'), '应渲染明暗盘净流入');
    assert.ok(html.includes('#ff0000'), '行颜色应透传');
    assert.strictEqual(page.el('fundPanel').style.display, '', '有数据时右栏可见');
  });

  it('未登录（fundTables 为空）时右栏整块不显示', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', { data: detailData([]) });

    assert.strictEqual(page.el('fundPanel').style.display, 'none');
    assert.strictEqual(page.el('fundTables').innerHTML, '', '不显示登录引导或空态占位');
  });

  it('表格字段转义，不出现 undefined/[object Object]', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: detailData([
        {
          title: '<img src=x>',
          columns: ['日期', '净流入'],
          rows: [{ cells: ['11-04', null], color: '' }],
        },
      ]),
    });

    const html = page.el('fundTables').innerHTML;
    assert.ok(!html.includes('<img src=x>'), '标题必须转义');
    assert.ok(html.includes('&lt;img'), '应输出转义后的标题');
    assert.ok(!html.includes('undefined'), '不应渲染 undefined');
    assert.ok(!html.includes('[object Object]'), '不应渲染 [object Object]');
  });

  it('顶栏股票下拉显示名称与代码，切换时发 select 消息', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: initData([
        { code: 'sh600519', name: '贵州茅台', mainNet: 123450000, tm: '20261026', source: 'xxjwxc' },
      ]),
    });

    const html = page.el('stockSelect').innerHTML;
    assert.ok(html.includes('贵州茅台'), `下拉应显示名称，实际：${html.slice(0, 200)}`);
    assert.ok(html.includes('sh600519'), '下拉应保留代码');

    page.posted.length = 0;
    const sel = page.el('stockSelect');
    sel.value = 'sh600519';
    (sel.listeners.change || []).forEach((fn) => fn());
    assert.ok(
      page.posted.some((m) => m.command === 'select' && m.code === 'sh600519'),
      '切换股票应通知宿主重拉详情'
    );
  });

  it('量化分析按分组卡片渲染：组名标题 + 逐条消息', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: {
        type: 'detail',
        data: {
          code: 'sh600519',
          name: '贵州茅台',
          price: 1333.1,
          percent: -0.14,
          mainFlow: null,
          analysis: [
            { name: 'PEG估值', msgs: ['peg指标:-4.945', '行业对比:平均 2.074'] },
            { name: '综合评分(多维度)', msgs: ['综合:97.07'] },
          ],
          sectors: [],
        },
      },
    });

    const html = page.el('analysisBox').innerHTML;
    assert.ok(html.includes('PEG估值'), `应渲染组名，实际：${html.slice(0, 300)}`);
    assert.ok(html.includes('综合评分(多维度)'), '应渲染第二个组名');
    assert.ok(html.includes('peg指标'), '应渲染组内消息');
    assert.ok(html.includes('97.07'), '应渲染组内指标值');
    assert.ok(!html.includes('[object Object]'), '结构化数据不能整块 toString');
  });

  it('分析为空数组时显示空态提示', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: {
        type: 'detail',
        data: {
          code: 'sh600519',
          name: '贵州茅台',
          price: 0,
          percent: 0,
          mainFlow: null,
          analysis: [],
          sectors: [],
        },
      },
    });

    const html = page.el('analysisBox').innerHTML;
    assert.ok(html.includes('暂无分析结论'), `空分析应显示空态，实际：${html.slice(0, 200)}`);
  });

  it('顶栏「实时走势」按钮 → 带当前股票代码与名称发 openTrend', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: initData([
        { code: 'sh600519', name: '贵州茅台' },
        { code: 'sz000977', name: '浪潮信息' },
      ]),
    });

    const btn = page.el('trendBtn');
    assert.ok(btn.listeners.click, '顶栏应绑定实时走势按钮');
    assert.strictEqual(btn.disabled, false, 'A 股个股应可点击');

    const sel = page.el('stockSelect');
    sel.value = 'sz000977';
    (sel.listeners.change || []).forEach((fn) => fn());
    page.posted.length = 0;

    (btn.listeners.click || []).forEach((fn) => fn());
    const msg = page.posted.find((m) => m.command === 'openTrend');
    assert.ok(msg, '应发送 openTrend');
    assert.strictEqual(msg.code, 'sz000977', '应带当前选中股代码');
    assert.strictEqual(msg.name, '浪潮信息', '应带当前选中股名称');
  });

  it('指数 / 港股不提供实时走势入口 → 按钮禁用且不发消息', () => {
    const page = loadTemplate('stock-fund-flow.html');
    page.fire('message', {
      data: initData([{ code: 'sh000001', name: '上证指数' }]),
    });

    const btn = page.el('trendBtn');
    assert.strictEqual(btn.disabled, true, '指数应禁用');
    page.posted.length = 0;
    (btn.listeners.click || []).forEach((fn) => fn());
    assert.ok(!page.posted.some((m) => m.command === 'openTrend'), '禁用时不应发消息');

    page.fire('message', {
      data: initData([{ code: 'hk00700', name: '腾讯控股' }]),
    });
    assert.strictEqual(page.el('trendBtn').disabled, true, '港股应禁用');
  });

  describe('从策略选股 / 数据碰撞跳入（initialCode 不在自选股里）', () => {
    function externalInit(stocks, code) {
      const init = initData(stocks);
      init.data.initialCode = code;
      return { data: init };
    }

    it('外部指定股优先于自选股列表 → 选中目标股并拉详情', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire(
        'message',
        externalInit(
          [
            { code: 'sh600519', name: '贵州茅台' },
            { code: 'sz000977', name: '浪潮信息' },
          ],
          'sh601127'
        )
      );

      const selects = page.posted.filter((m) => m.command === 'select');
      assert.strictEqual(selects.length, 1, '应只为目标股拉一次详情');
      assert.strictEqual(selects[0].code, 'sh601127', '不能被第一只自选股覆盖');
      assert.ok(page.el('stockSelect').innerHTML.includes('sh601127'), '下拉应包含外部指定股');
      assert.strictEqual(page.el('stockSelect').value, 'sh601127', '下拉应选中目标股');
      assert.strictEqual(page.el('trendBtn').disabled, false, '目标股应可跳实时走势');
    });

    it('自选股为空时，外部指定股仍能触发详情请求', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', externalInit([], 'sz300750'));

      assert.ok(
        page.posted.some((m) => m.command === 'select' && m.code === 'sz300750'),
        '不能停在「加载中…」，应为目标股发起详情请求'
      );
      assert.strictEqual(page.el('stockSelect').value, 'sz300750');
    });

    it('目标股详情回来后，下拉显示其名称而不是裸代码', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', externalInit([{ code: 'sh600519', name: '贵州茅台' }], 'sh601127'));
      page.fire('message', {
        data: {
          type: 'detail',
          data: {
            code: 'sh601127',
            name: '赛力斯',
            price: 0,
            percent: 0,
            mainFlow: null,
            analysis: [],
            sectors: [],
            fundTables: [],
          },
        },
      });

      const html = page.el('stockSelect').innerHTML;
      assert.ok(
        html.includes('赛力斯') && html.includes('sh601127'),
        `下拉应显示目标股名称与代码，实际：${html.slice(0, 200)}`
      );
      assert.strictEqual(page.el('stockSelect').value, 'sh601127', '重渲染后仍应选中目标股');
    });

    it('刷新（init 无 initialCode）后，外部指定股仍保持选中', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', externalInit([{ code: 'sh600519', name: '贵州茅台' }], 'sh601127'));
      page.posted.length = 0;
      page.fire('message', externalInit([{ code: 'sh600519', name: '贵州茅台' }], ''));

      const selects = page.posted.filter((m) => m.command === 'select');
      assert.strictEqual(selects.length, 1, '刷新后仍应只拉一次详情');
      assert.strictEqual(selects[0].code, 'sh601127', '刷新不能跳回第一只自选股');
      assert.ok(page.el('stockSelect').innerHTML.includes('sh601127'), '刷新后下拉仍应保留目标股');
    });
  });

  describe('顶栏「加入自选」', () => {
    function addInit(stocks, watchlist, initialCode) {
      const init = initData(stocks);
      init.data.watchlist = watchlist;
      init.data.initialCode = initialCode || '';
      return { data: init };
    }

    it('当前股不在自选列表 → 按钮可用，点击发 addStock 并防重复', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', addInit([], ['sh600519'], 'sh601127'));
      page.posted.length = 0;

      const btn = page.el('addStockBtn');
      assert.strictEqual(btn.disabled, false, '未加入的股票应可添加');
      assert.strictEqual(btn.textContent, '加入自选');

      (btn.listeners.click || []).forEach((fn) => fn());
      const msg = page.posted.find((m) => m.command === 'addStock');
      assert.ok(msg, '应发送 addStock');
      assert.strictEqual(msg.code, 'sh601127', '应带当前选中股代码');
      assert.strictEqual(btn.disabled, true, '等待宿主回执期间应禁用');
      assert.strictEqual(btn.textContent, '加入中…');

      page.posted.length = 0;
      (btn.listeners.click || []).forEach((fn) => fn());
      assert.ok(!page.posted.some((m) => m.command === 'addStock'), '不应重复添加');
    });

    it('已在自选 → 按钮禁用并显示「已在自选」，点击不发消息', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', addInit([{ code: 'sh600519', name: '贵州茅台' }], ['sh600519'], ''));

      const btn = page.el('addStockBtn');
      assert.strictEqual(btn.disabled, true);
      assert.strictEqual(btn.textContent, '已在自选');

      page.posted.length = 0;
      (btn.listeners.click || []).forEach((fn) => fn());
      assert.ok(!page.posted.some((m) => m.command === 'addStock'));
    });

    it('宿主回执后 watchlist 含当前股 → 按钮变「已在自选」', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire('message', addInit([], ['sh600519'], 'sh601127'));
      (page.el('addStockBtn').listeners.click || []).forEach((fn) => fn());

      page.fire('message', addInit([], ['sh600519', 'sh601127'], ''));
      assert.strictEqual(page.el('addStockBtn').textContent, '已在自选');
      assert.strictEqual(page.el('addStockBtn').disabled, true);
    });

    it('切换股票后按钮状态跟随当前选中股', () => {
      const page = loadTemplate('stock-fund-flow.html');
      page.fire(
        'message',
        addInit(
          [
            { code: 'sh600519', name: '贵州茅台' },
            { code: 'sz000977', name: '浪潮信息' },
          ],
          ['sh600519'],
          ''
        )
      );
      assert.strictEqual(page.el('addStockBtn').textContent, '已在自选');

      const sel = page.el('stockSelect');
      sel.value = 'sz000977';
      (sel.listeners.change || []).forEach((fn) => fn());
      assert.strictEqual(page.el('addStockBtn').textContent, '加入自选');
      assert.strictEqual(page.el('addStockBtn').disabled, false);
    });
  });
});
