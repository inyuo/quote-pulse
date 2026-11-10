/**
 * 量化图表面板（量价分层 / 北向资金 / 大盘指数）测试：
 *
 * 模板部分 —— 伪 DOM 执行 quant.html 内联 script（webview-dom）：
 * 1) 初始化 tab=cjl 且未登录 → Tab 高亮正确 + 未登录引导区渲染（按钮发 openLogin）
 * 2) north 数据 → canvas 绘制指令被调用（webview-dom 记录 ctx 调用）
 * 3) cjl 数据为 null（已登录）→ 「数据加载失败，点击重试」占位可重试
 *
 * 宿主部分 —— require out/webview/quantPanel，经 Module._resolveFilename
 * 重定向 'vscode' 与重依赖（同 quantTree.test.js 模式）：
 * 4) init 懒加载：tab=north 只拉 fetchNorthFundTrends，cjl/index 不发请求
 * 5) openLogin 消息 → 面板宿主调用 quantLogin（stub 断言）
 * 6) selectTab cjl 未登录 → 不发请求并下发 cjlUnlogged 引导标记
 * 7) selectTab index + refresh → 重拉当前 tab
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { loadTemplate } = require('./helpers/webview-dom');

const vscodeMockPath = path.join(__dirname, 'helpers', 'vscode-mock.js');
const stubPanelPath = path.join(__dirname, 'helpers', 'stubReusedWebviewPanel.js');
const stubLjgxPath = path.join(__dirname, 'helpers', 'stubLjgxViewData.js');
const stubLoginPath = path.join(__dirname, 'helpers', 'stubQuantLogin.js');
const stubUtilsPath = path.join(__dirname, 'helpers', 'stubUtils.js');
const stubLqPath = path.join(__dirname, 'helpers', 'stubLqData.js');

const prevResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const parent = rest[0];
  if (request === 'vscode') return vscodeMockPath;
  if (parent && parent.filename && parent.filename.endsWith('quantPanel.js')) {
    if (request === './ReusedWebviewPanel') return stubPanelPath;
    if (request === '../shared/utils') return stubUtilsPath;
    if (request === '../shared/ljgxData') return stubLjgxPath;
    if (request === '../shared/lqData') return stubLqPath;
    if (request === './quantLogin') return stubLoginPath;
  }
  return prevResolveFilename.call(this, request, ...rest);
};

const lqStub = require('./helpers/stubLqData');
const vscodeMock = require('./helpers/vscode-mock');
const ljgxStub = require('./helpers/stubLjgxViewData');
const loginStub = require('./helpers/stubQuantLogin');
const panelStub = require('./helpers/stubReusedWebviewPanel');

/** 构造 init / selectTab 推送载荷（其他 tab 字段恒 null —— 懒加载语义） */
function initPayload(tab, fields) {
  return Object.assign(
    {
      tab,
      cjl: null,
      north: null,
      index: null,
      cjlUnlogged: false,
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

/** 策略选股 tab 推送载荷：元数据由宿主用数据层 LQ_TAGS/LQ_DAYS 下发 */
function lqPayload(fields) {
  const { LQ_TAGS, LQ_DAYS, LQ_COLLISION_DAYS } = require('../out/shared/lqData');
  return Object.assign(
    {
      tab: 'lq',
      cjl: null,
      north: null,
      index: null,
      cjlUnlogged: false,
      lqUnlogged: false,
      lqTags: LQ_TAGS,
      lqDays: LQ_DAYS,
      lqCollisionDays: LQ_COLLISION_DAYS,
      collisionDays: 5,
      lq: {
        tag: 'ztb',
        days: 1,
        groups: [
          {
            title: '2026-11-04',
            rows: [{ code: '000001', name: '平安银行', percent: 2.35, note: '首板' }],
          },
        ],
        hyTags: ['银行'],
        tsTags: [{ doc: '龙虎榜', url: '' }],
      },
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

function count(ctx, name) {
  let c = 0;
  for (const call of ctx.calls) {
    if (call.name === name) c++;
  }
  return c;
}

/** 北向资金样例：times 与两条净值序列严格对齐 */
function northData() {
  return {
    times: ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '15:00'],
    hgtNet: [1.2, 2.5, 3.1, 2.8, 3.3, 3.6, 4.2, 5.1],
    szgtNet: [0.8, 1.4, 1.0, 1.9, 2.2, 1.6, 2.4, 3.0],
  };
}

/** 宿主 → 模板的独立碰撞消息载荷 */
function collisionData(fields) {
  return Object.assign(
    {
      days: 5,
      rows: [
        { code: 'sh601127', name: '赛力斯', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
        { code: 'sz300750', name: '宁德时代', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
        { code: 'sz002594', name: '比亚迪', hits: 3, tags: ['趋势', '低位', '板块'] },
      ],
      available: 9,
      total: 9,
      unlogged: false,
      failed: false,
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

/** 数据碰撞顶层 tab 的 init 载荷（懒加载：其它 tab 字段恒 null） */
function collisionPayload(fields) {
  const { LQ_COLLISION_DAYS } = require('../out/shared/lqData');
  return Object.assign(
    {
      tab: 'collision',
      cjl: null,
      north: null,
      index: null,
      lq: null,
      cjlUnlogged: false,
      lqUnlogged: false,
      lqCollisionDays: LQ_COLLISION_DAYS,
      collisionDays: 5,
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

describe('量化面板模板 quant.html', () => {
  it('画布零尺寸（布局未完成）时静默跳过，并在布局就绪后延迟重画', async () => {
    const { setRect } = require('./helpers/webview-dom');
    const page = loadTemplate('quant.html');
    setRect(0, 0); // 模拟 webview 首帧布局未完成

    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-04', price: [10, 20.5, null, 30] } }),
      },
    });

    // 零尺寸：不能画（withCanvas 静默跳过），但也不能停留在空白——需安排延迟重画
    const ctx = page.el('chart').getContext('2d');
    assert.strictEqual(ctx.calls.length, 0, '零尺寸时不应有绘制指令');

    setRect(800, 300); // 布局完成
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(ctx.calls.length > 0, `延迟重画后应有绘制指令，实际 ${ctx.calls.length}`);
  });

  it('resize 触发当前 Tab 重画', () => {
    const { setRect } = require('./helpers/webview-dom');
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-04', price: [10, 20.5, null, 30] } }),
      },
    });
    const ctx = page.el('chart').getContext('2d');
    const before = ctx.calls.length;
    assert.ok(before > 0, '正常尺寸下 init 应有绘制指令');

    setRect(640, 240);
    // resize 监听挂在 window 上，经 helper 的 fire 通道派发
    page.fire('resize', {});
    assert.ok(ctx.calls.length > before, `resize 后应重画，实际 ${before} → ${ctx.calls.length}`);
  });

  it('初始化 tab=cjl 未登录 → Tab 高亮 cjl + 未登录引导区（按钮发 openLogin）', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: null, cjlUnlogged: true }),
      },
    });

    assert.strictEqual(page.el('tabCjl').className.indexOf('active') >= 0, true, 'cjl Tab 应高亮');
    assert.strictEqual(
      page.el('tabNorth').className.indexOf('active') >= 0,
      false,
      'north Tab 不应高亮'
    );
    assert.strictEqual(page.el('tabIndex').className.indexOf('active') >= 0, false, 'index Tab 不应高亮');

    const html = page.el('chartEmpty').innerHTML;
    assert.ok(html.includes('登录'), `未登录应渲染登录引导文案，实际：${html}`);
    assert.strictEqual(page.el('chartWrap').style.display, 'none', '引导态不应显示画布');

    page.el('loginBtn').listeners.click[0]();
    assert.ok(
      page.posted.some((m) => m.command === 'openLogin'),
      '引导按钮点击应 postMessage openLogin'
    );
  });

  it('north 数据 → canvas 折线与刻度绘制指令被调用', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('north', { north: northData() }),
      },
    });

    const ctx = page.el('chart').getContext('2d');
    assert.ok(ctx.calls.length > 0, '应有 canvas 绘制指令');
    const lineTos = count(ctx, 'lineTo');
    assert.ok(lineTos >= 8, `北向双折线应产生足够 lineTo，实际 ${lineTos}`);
    const texts = count(ctx, 'fillText');
    assert.ok(texts >= 4, `图例与刻度应产生 fillText，实际 ${texts}`);
    assert.strictEqual(page.el('chartWrap').style.display, 'block', '有数据应显示画布');
  });

  it('index 数据 → 大盘多指数折线绘制，图例出现指数名称', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('index', {
          index: [
            { code: 'sh000001', name: '上证指数', price: [3600, 3610, 3595, 3620], percent: 0.35 },
            { code: 'sz399001', name: '深证成指', price: [11200, 11250, 11310, 11280], percent: 0.98 },
          ],
        }),
      },
    });

    assert.strictEqual(page.el('tabIndex').className.indexOf('active') >= 0, true, 'index Tab 应高亮');
    const ctx = page.el('chart').getContext('2d');
    const lineTos = count(ctx, 'lineTo');
    assert.ok(lineTos >= 4, `大盘双指数应产生足够 lineTo，实际 ${lineTos}`);
    const texts = ctx.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]))
      .join('|');
    assert.ok(texts.indexOf('上证指数') !== -1, `图例应含指数名称，实际：${texts}`);
    assert.ok(texts.indexOf('深证成指') !== -1, `图例应含第二个指数名称，实际：${texts}`);
    assert.strictEqual(page.el('chartWrap').style.display, 'block', '有数据应显示画布');
  });

  it('cjl 数据为 null（已登录）→ 数据加载失败占位，点击重试发 refresh', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl'),
      },
    });

    const html = page.el('chartEmpty').innerHTML;
    assert.ok(
      html.includes('数据加载失败，点击重试'),
      `接口失败应显示可重试占位，实际：${html}`
    );

    page.el('chartEmpty').listeners.click[0]();
    assert.ok(
      page.posted.some((m) => m.command === 'refresh'),
      '失败占位点击应 postMessage refresh'
    );
  });

  it('cjl 真实 121 点累计成交额 → 画分时曲线，不逐点标注 12 位数字', () => {
    const { setRect } = require('./helpers/webview-dom');
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    // 真机形态：get_share_cjl 返回分时累计成交额（元），约 60 亿 → 4264 亿
    const price = Array.from({ length: 121 }, (_, i) => 6e9 + ((426e9 - 6e9) * i) / 120);
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-06', price } }),
      },
    });

    const ctx = page.el('chart').getContext('2d');
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    const lineTos = count(ctx, 'lineTo');
    assert.ok(lineTos >= 100, `累计成交额应按时间序列连成曲线，实际 lineTo ${lineTos}`);
    assert.ok(
      texts.length <= 20,
      `121 点不得逐点标注文字（会糊成一堆数字），实际 ${texts.length} 条`
    );
    assert.ok(
      !texts.some((t) => /\d{9,}/.test(t)),
      `金额应换算成亿/万，实际出现：${texts.filter((t) => /\d{9,}/.test(t)).slice(0, 2)}`
    );
  });

  it('cjl 坐标轴带单位、日期与分时刻度', () => {
    const { setRect } = require('./helpers/webview-dom');
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    const price = Array.from({ length: 121 }, (_, i) => 6e9 + ((426e9 - 6e9) * i) / 120);
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-06', price } }),
      },
    });

    const texts = page
      .el('chart')
      .getContext('2d')
      .calls.filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]))
      .join('|');
    assert.ok(/亿|万/.test(texts), `纵轴应显示金额单位，实际：${texts}`);
    assert.ok(texts.indexOf('2026-11-06') !== -1, `应标注数据日期，实际：${texts}`);
    assert.ok(/09:30|11:30|13:00/.test(texts), `横轴应有分时时间刻度，实际：${texts}`);
  });

  it('cjl 累计数组含 null → 跳过 null 后仍按序列绘制', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-04', price: [10, 20.5, null, 30] } }),
      },
    });

    const ctx = page.el('chart').getContext('2d');
    assert.ok(count(ctx, 'lineTo') >= 2, `3 个有效点应连成折线，实际 ${count(ctx, 'lineTo')}`);
    const texts = ctx.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]))
      .join('|');
    assert.ok(texts.indexOf('2026-11-04') !== -1, `应标注数据日期，实际：${texts}`);
  });

  it('cjl 只有 1 个点 → 分时刻度不重复堆叠在同一位置', () => {
    const { setRect } = require('./helpers/webview-dom');
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-06', price: [6e9] } }),
      },
    });

    const ticks = page
      .el('chart')
      .getContext('2d')
      .calls.filter((c) => c.name === 'fillText' && /^\d{2}:\d{2}$/.test(String(c.args[0])));
    assert.ok(ticks.length <= 1, `单点数据不应重复标注刻度，实际 ${ticks.length} 条`);
  });

  it('init tab=lq → 策略选股 Tab 高亮 + 9 类策略/8 档天数 + 分组表格', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: lqPayload() } });

    assert.ok(page.el('tabLq').className.indexOf('active') >= 0, 'lq Tab 应高亮');
    assert.strictEqual(page.el('lqWrap').style.display, 'block', '应显示策略区');
    assert.strictEqual(page.el('chartWrap').style.display, 'none', '应隐藏画布');

    const tags = page.el('lqTags').innerHTML;
    assert.strictEqual((tags.match(/data-tag=/g) || []).length, 9, `应渲染 9 类策略：${tags}`);
    assert.ok(tags.includes('超跌') && tags.includes('风口'), 'chips 应含首尾策略');
    const days = page.el('lqDays').innerHTML;
    assert.strictEqual((days.match(/data-days=/g) || []).length, 8, `应渲染 8 档天数：${days}`);

    const groups = page.el('lqGroups').innerHTML;
    assert.ok(groups.includes('2026-11-04'), '应渲染分组标题');
    assert.ok(groups.includes('平安银行') && groups.includes('000001'), '应渲染个股行');
    assert.ok(groups.includes('data-code="000001"'), '个股行应带 data-code 供点击');
  });

  it('lq tab 切换策略/天数/点击个股 → 发 selectLqTag / selectLqDays / openStock', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: lqPayload() } });

    assert.ok(page.el('lqTags').listeners.click, '策略容器应绑定点击委托');
    assert.ok(page.el('lqDays').listeners.click, '天数容器应绑定点击委托');
    assert.ok(page.el('lqGroups').listeners.click, '分组容器应绑定点击委托');

    const attr = (key, value) => ({ target: { getAttribute: (k) => (k === key ? value : null) } });
    page.el('lqTags').listeners.click[0](attr('data-tag', 'qs'));
    page.el('lqDays').listeners.click[0](attr('data-days', '5'));
    page.el('lqGroups').listeners.click[0](attr('data-code', '000001'));

    // 消息对象来自 vm 沙箱（跨 realm），不能对整体做 deepStrictEqual
    const tagMsg = page.posted.find((m) => m.command === 'selectLqTag');
    assert.ok(tagMsg, '应发送 selectLqTag');
    assert.strictEqual(tagMsg.tag, 'qs');

    const dayMsg = page.posted.find((m) => m.command === 'selectLqDays');
    assert.ok(dayMsg, '应发送 selectLqDays');
    assert.strictEqual(dayMsg.days, 5);

    const stockMsg = page.posted.find((m) => m.command === 'openStock');
    assert.ok(stockMsg, '应发送 openStock');
    assert.strictEqual(stockMsg.code, '000001');
  });

  it('lq 未登录 → 登录引导，点击发 openLogin', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: { type: 'init', data: lqPayload({ lq: null, lqUnlogged: true }) },
    });

    assert.ok(page.el('lqGroups').innerHTML.includes('登录'), '应显示登录引导');
    assert.ok(page.el('lqLoginBtn').listeners.click, '引导按钮应可点击');
    page.el('lqLoginBtn').listeners.click[0]();
    assert.ok(page.posted.some((m) => m.command === 'openLogin'));
  });

  it('lq 数据为 null（已登录）→ 失败占位，点击发 refresh', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: lqPayload({ lq: null }) } });

    assert.ok(page.el('lqGroups').innerHTML.includes('数据加载失败'), '应显示可重试占位');
    assert.ok(page.el('lqRetry').listeners.click, '占位应可点击');
    page.el('lqRetry').listeners.click[0]();
    assert.ok(page.posted.some((m) => m.command === 'refresh'));
  });

  it('从 lq 切回 north → 恢复画布并隐藏策略区', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: lqPayload() } });
    page.fire('message', {
      data: { type: 'init', data: initPayload('north', { north: northData() }) },
    });

    assert.strictEqual(page.el('lqWrap').style.display, 'none', '应隐藏策略区');
    assert.strictEqual(page.el('chartWrap').style.display, 'block', '应恢复画布');
    assert.ok(page.el('chart').getContext('2d').calls.length > 0, 'north 应重新绘制');
  });

  it('第 5 个顶层 tab「数据碰撞」与原有 4 个 tab 同级', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });

    assert.ok(page.el('tabCollision').className.indexOf('active') >= 0, '数据碰撞 Tab 应高亮');
    assert.strictEqual(page.el('collisionWrap').style.display, 'block', '应显示碰撞区');
    assert.strictEqual(page.el('lqWrap').style.display, 'none', '应隐藏策略选股');
    assert.strictEqual(page.el('chartWrap').style.display, 'none', '应隐藏画布');

    const chips = page.el('collisionDays').innerHTML;
    assert.strictEqual((chips.match(/data-days=/g) || []).length, 6, `应只有 6 档：${chips}`);
    assert.ok(chips.includes('近3天') && chips.includes('近100天'), '应含首尾两档');
    assert.ok(!chips.includes('近1天') && !chips.includes('近30天'), '不应含近1/近30天');
    assert.ok(chips.includes('class="lq-chip active" data-days="5"'), '默认近5天应高亮');
    assert.ok(page.el('collisionBody').innerHTML.includes('碰撞计算中'), '未收到数据时显示加载占位');
    assert.ok(
      page.posted.some((m) => m.command === 'requestCollision'),
      'collision init 后应主动向宿主索取碰撞数据'
    );

    page.el('tabNorth').listeners.click[0]();
    const msg = page.posted.find((m) => m.command === 'selectTab');
    assert.ok(msg && msg.tab === 'north', '点击 tab 应发 selectTab');
  });

  it('init tab=lq → 策略选股单栏显示，数据碰撞区隐藏且不触发碰撞取数', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: lqPayload() } });

    assert.strictEqual(page.el('lqWrap').style.display, 'block', '应显示策略选股');
    assert.strictEqual(page.el('collisionWrap').style.display, 'none', '碰撞区应隐藏');
    assert.strictEqual((page.el('lqTags').innerHTML.match(/data-tag=/g) || []).length, 9);
    assert.ok(
      !page.posted.some((m) => m.command === 'requestCollision'),
      '策略选股 tab 不应再触发碰撞取数'
    );
  });

  it('collision 消息 → 结果表只列命中≥2，标签在名称之后并显示摘要', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });
    page.fire('message', { data: { type: 'collision', data: collisionData() } });

    const html = page.el('collisionBody').innerHTML;
    assert.strictEqual((html.match(/data-code=/g) || []).length, 3, '应渲染 3 行结果');
    assert.ok(html.includes('<th>标签</th>'), '应含标签列');
    assert.ok(html.includes('lq-hit-tag') && html.includes('风口'), '策略标签应渲染');
    assert.ok(html.includes('赛力斯') && html.includes('4'), '应显示名称与命中数');
    const summary = page.el('collisionSummary').textContent;
    assert.ok(summary.includes('命中≥2 共 3 只'), `摘要缺少命中数：${summary}`);
    assert.ok(summary.includes('已取 9/9'), `摘要缺少完整度：${summary}`);
  });

  it('collision 部分策略可用 / 无命中 → 完整度与空态分别标注', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });
    page.fire('message', {
      data: { type: 'collision', data: collisionData({ available: 7 }) },
    });
    assert.ok(page.el('collisionSummary').textContent.includes('已取 7/9'));

    page.fire('message', {
      data: { type: 'collision', data: collisionData({ rows: [] }) },
    });
    assert.ok(page.el('collisionBody').innerHTML.includes('没有命中'), '应显示无命中占位');
  });

  it('collision 未登录 / 全部失败 → 各自占位与对应消息', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });

    page.fire('message', {
      data: { type: 'collision', data: collisionData({ unlogged: true }) },
    });
    assert.ok(page.el('collisionBody').innerHTML.includes('登录'), '应显示登录引导');
    assert.ok(page.el('collisionLoginBtn').listeners.click, '登录按钮应可点击');
    page.el('collisionLoginBtn').listeners.click[0]();
    assert.ok(page.posted.some((m) => m.command === 'openLogin'));

    page.fire('message', {
      data: { type: 'collision', data: collisionData({ failed: true, available: 0 }) },
    });
    assert.ok(page.el('collisionBody').innerHTML.includes('失败'), '应显示失败占位');
    assert.ok(page.el('collisionRetry').listeners.click, '重试按钮应可点击');
    page.el('collisionRetry').listeners.click[0]();
    assert.ok(page.posted.some((m) => m.command === 'refreshCollision'));
  });

  it('数据碰撞切档 / 点击个股 → 发 selectCollisionDays / openStock', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });
    page.fire('message', { data: { type: 'collision', data: collisionData() } });

    const attr = (key, value) => ({ target: { getAttribute: (k) => (k === key ? value : null) } });
    assert.ok(page.el('collisionDays').listeners.click, '碰撞天数容器应绑定委托');
    assert.ok(page.el('collisionBody').listeners.click, '结果容器应绑定委托');

    page.el('collisionDays').listeners.click[0](attr('data-days', '10'));
    const dayMsg = page.posted.find((m) => m.command === 'selectCollisionDays');
    assert.ok(dayMsg, '应发送 selectCollisionDays');
    assert.strictEqual(dayMsg.days, 10);
    assert.ok(page.el('collisionDays').innerHTML.includes('class="lq-chip active" data-days="10"'));

    page.el('collisionBody').listeners.click[0](attr('data-code', 'sh601127'));
    assert.ok(page.posted.some((m) => m.command === 'openStock' && m.code === 'sh601127'));
  });
});

describe('量化面板宿主 quantPanel.ts', () => {
  let panel;

  /** 轮询等待满足条件的最后一条 init 推送（宿主异步拉取后才 postMessage） */
  function waitInit(predicate, label) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        // 复用分支会向新建的 panel 推送，故汇总所有已创建面板的消息
        const all = panelStub.created.reduce(
          (acc, p) => acc.concat(p.webview.pushed),
          []
        );
        const found = all.filter((m) => m.type === 'init' && predicate(m.data)).pop();
        if (found) return resolve(found);
        if (Date.now() - start > 1500) return reject(new Error(`等待 ${label} 推送超时`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  /** 汇总所有面板的 collision 推送；afterCount 用于等待「再新增一条」 */
  function waitCollision(predicate, label, afterCount) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const min = afterCount || 0;
      const tick = () => {
        const all = panelStub.created.reduce((acc, p) => acc.concat(p.webview.pushed), []);
        const matches = all.filter((m) => m.type === 'collision' && predicate(m.data));
        if (matches.length > min) return resolve(matches[matches.length - 1]);
        if (Date.now() - start > 2000) return reject(new Error(`等待 ${label} 推送超时`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  /** 单组策略榜单（code 同时作名称，只为构造碰撞命中） */
  function lqResult(codes) {
    return {
      groups: [
        {
          title: 'g',
          rows: codes.map((c) => ({ code: c, name: c, percent: null, note: '' })),
        },
      ],
      hyTags: [],
      tsTags: [],
    };
  }

  before(function () {
    ljgxStub.state.north = northData();
    ljgxStub.state.index = [
      { code: 'sh000001', name: '上证指数', price: [3600, 3610, 3595], percent: 0.35 },
      { code: 'sz399001', name: '深证成指', price: [11200, 11250, 11310], percent: 0.98 },
    ];
    ljgxStub.state.cjl = { tm: '2026-11-04', price: [5, 9, 14] };

    const host = require('../out/webview/quantPanel');
    host.initQuantPanel({
      get: () => undefined,
      update: () => Promise.resolve(),
    });
    host.quantPanel('north');
    panel = panelStub.created[0];
    assert.ok(panel, '宿主应创建面板');
    // 模板脚本就绪：宿主此刻才按当前 tab 懒加载推送 init
    panel.fire({ command: 'ready' });
  });

  it('init 懒加载：tab=north → 只发北向请求，cjl/index 字段为 null', function () {
    this.timeout(2000);
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const init = panel.webview.pushed.find((m) => m.type === 'init');
        if (Date.now() - start > 1500) return reject(new Error('等待 init 推送超时'));
        if (init) return resolve();
        setTimeout(tick, 10);
      };
      tick();
    }).then(() => {
      const init = panel.webview.pushed.find((m) => m.type === 'init');
      assert.strictEqual(init.data.tab, 'north');
      assert.ok(init.data.north && init.data.north.times.length, 'north 数据应有值');
      assert.strictEqual(init.data.cjl, null, 'cjl 字段应为 null');
      assert.strictEqual(init.data.index, null, 'index 字段应为 null');

      const names = ljgxStub.calls.map((c) => c.name);
      assert.strictEqual(names[0], 'fetchNorthFundTrends');
      assert.strictEqual(names.indexOf('fetchShareCjl'), -1, '不应拉取 cjl');
      assert.strictEqual(names.indexOf('fetchIndexSpark'), -1, '不应拉取 index');
    });
  });

  it('openLogin 消息 → 面板宿主调用 quantLogin', () => {
    panel.fire({ command: 'openLogin' });
    assert.ok(
      loginStub.calls.indexOf('quantLogin') !== -1,
      `openLogin 应触发 quantLogin()，实际：${loginStub.calls.join(',')}`
    );
  });

  it('selectTab cjl（未登录）→ 不发请求并下发 cjlUnlogged 引导标记', function () {
    this.timeout(2000);
    panel.fire({ command: 'selectTab', tab: 'cjl' });
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const inits = panel.webview.pushed.filter((m) => m.type === 'init' && m.data.tab === 'cjl');
        if (Date.now() - start > 1500) return reject(new Error('等待 cjl 推送超时'));
        if (inits.length) return resolve();
        setTimeout(tick, 10);
      };
      tick();
    }).then(() => {
      const init = panel.webview.pushed.filter(
        (m) => m.type === 'init' && m.data.tab === 'cjl'
      )[0];
      assert.strictEqual(init.data.cjl, null);
      assert.strictEqual(init.data.cjlUnlogged, true, '未登录时应下发引导标记');
      assert.strictEqual(
        ljgxStub.calls.some((c) => c.name === 'fetchShareCjl'),
        false,
        '未登录不应发 get_share_cjl 请求'
      );
    });
  });

  it('selectTab index + refresh → 重拉当前 tab（fetchIndexSpark 共 2 次）', function () {
    this.timeout(2000);
    const before = ljgxStub.calls.length;
    panel.fire({ command: 'selectTab', tab: 'index' });
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const init = panel.webview.pushed.filter(
          (m) => m.type === 'init' && m.data.tab === 'index'
        )[0];
        if (Date.now() - start > 1500) return reject(new Error('等待 index 推送超时'));
        if (init && init.data.index) return resolve();
        setTimeout(tick, 10);
      };
      tick();
    }).then(() => {
      const calls0 = ljgxStub.calls.filter((c) => c.name === 'fetchIndexSpark').length;
      panel.fire({ command: 'refresh' });
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const total = ljgxStub.calls.filter((c) => c.name === 'fetchIndexSpark').length;
          if (Date.now() - start > 1500) return reject(new Error('等待 refresh 拉取超时'));
          if (total >= calls0 + 1) return resolve();
          setTimeout(tick, 10);
        };
        tick();
      }).then(() => {
        const sparks = ljgxStub.calls.slice(before).filter((c) => c.name === 'fetchIndexSpark');
        assert.strictEqual(sparks.length, 2, 'selectTab + refresh 应共拉两次 index');
        assert.strictEqual(
          ljgxStub.calls.slice(before).some((c) => c.name === 'fetchNorthFundTrends'),
          false,
          'index tab 的推送不应再拉北向'
        );
        const init = panel.webview.pushed.filter(
          (m) => m.type === 'init' && m.data.tab === 'index'
        )[0];
        assert.ok(init.data.index.length >= 2, '大盘数据应带多指数条目');
      });
    });
  });

  it('selectTab lq（未登录）→ 下发 lqUnlogged 与元数据，不请求策略接口', function () {
    this.timeout(2500);
    lqStub.reset();
    ljgxStub.state.session = null;
    panel.fire({ command: 'selectTab', tab: 'lq' });
    return waitInit((d) => d.tab === 'lq' && d.lqUnlogged === true, 'lq 未登录').then((init) => {
      assert.strictEqual(init.data.lq, null);
      assert.strictEqual(lqStub.calls.length, 0, '未登录不应请求策略接口');
      assert.strictEqual(init.data.lqTags.length, 9, '应下发 9 类策略元数据');
      assert.strictEqual(init.data.lqDays.length, 8, '应下发 8 档天数元数据');
    });
  });

  it('已登录 lq → 拉 fetchLqList 并下发 tag/days 与归一化数据', function () {
    this.timeout(2500);
    lqStub.reset();
    ljgxStub.state.session = { sessionId: 'tok' };
    lqStub.state.lq = {
      groups: [
        {
          title: '2026-11-04',
          rows: [{ code: '000001', name: '平安银行', percent: 2.35, note: '首板' }],
        },
      ],
      hyTags: [],
      tsTags: [],
    };
    panel.fire({ command: 'selectTab', tab: 'lq' });
    return waitInit((d) => d.tab === 'lq' && d.lq && d.lq.groups, 'lq 数据').then((init) => {
      assert.deepStrictEqual(lqStub.calls[0], { name: 'fetchLqList', tag: 'ztb', days: 1 });
      assert.strictEqual(init.data.lq.tag, 'ztb');
      assert.strictEqual(init.data.lq.days, 1);
      assert.strictEqual(init.data.lq.groups[0].title, '2026-11-04');
      assert.strictEqual(init.data.lqUnlogged, false);
    });
  });

  it('selectLqTag/selectLqDays 用新参数重拉，重复 selectTab 命中缓存不再请求', function () {
    this.timeout(3000);
    panel.fire({ command: 'selectLqTag', tag: 'qs' });
    return waitInit((d) => d.lq && d.lq.tag === 'qs', 'qs').then(() => {
      assert.deepStrictEqual(lqStub.calls[lqStub.calls.length - 1], {
        name: 'fetchLqList',
        tag: 'qs',
        days: 1,
      });
      panel.fire({ command: 'selectLqDays', days: 5 });
      return waitInit((d) => d.lq && d.lq.days === 5, 'days=5');
    }).then(() => {
      assert.deepStrictEqual(lqStub.calls[lqStub.calls.length - 1], {
        name: 'fetchLqList',
        tag: 'qs',
        days: 5,
      });
      const count = lqStub.calls.length;
      panel.fire({ command: 'selectTab', tab: 'lq' });
      return new Promise((resolve) => setTimeout(resolve, 150)).then(() => {
        assert.strictEqual(lqStub.calls.length, count, '同 tag+days 应命中 30min 缓存');
      });
    });
  });

  it('openStock → 转发 leek-fund.stockFundFlowForStock（参数 {id: code}）', () => {
    vscodeMock.commandCalls.length = 0;
    panel.fire({ command: 'openStock', code: '000001' });
    assert.strictEqual(vscodeMock.commandCalls.length, 1, '应转发一次命令');
    assert.strictEqual(vscodeMock.commandCalls[0].name, 'leek-fund.stockFundFlowForStock');
    assert.deepStrictEqual(vscodeMock.commandCalls[0].args[0], { id: '000001' });
  });

  it('quantPanel(tab=lq, tag=cd) → 初始策略定位到 cd', function () {
    this.timeout(2500);
    const host = require('../out/webview/quantPanel');
    ljgxStub.state.session = { sessionId: 'tok' };
    lqStub.state.lq = { groups: [], hyTags: [], tsTags: [] };
    host.quantPanel('lq', undefined, 'cd');
    return waitInit((d) => d.tab === 'lq' && d.lq && d.lq.tag === 'cd', 'tag=cd').then((init) => {
      assert.strictEqual(init.data.lq.tag, 'cd');
      assert.strictEqual(lqStub.calls[lqStub.calls.length - 1].tag, 'cd');
    });
  });

  it('已登录 cjl → fetchShareCjl 收到 {store}（漏传会恒定显示加载失败）', function () {
    this.timeout(2500);
    const before = ljgxStub.calls.length;
    ljgxStub.state.session = { sessionId: 'tok' };
    ljgxStub.state.cjl = { tm: '2026-11-03', price: [1, 2, 3] };
    panel.fire({ command: 'selectTab', tab: 'cjl' });
    return waitInit((d) => d.tab === 'cjl' && d.cjl && d.cjl.price, 'cjl 数据').then(() => {
      const call = ljgxStub.calls.slice(before).find((c) => c.name === 'fetchShareCjl');
      assert.ok(call, '应调用 fetchShareCjl');
      assert.ok(call.deps && call.deps.store, '必须传 {store}，否则数据层直接返回 null');
    });
  });

  it('selectTab collision → 下发顶层 tab init 与 6 档元数据，不拉其它 tab 数据', function () {
    this.timeout(2500);
    panel.fire({ command: 'selectTab', tab: 'collision' });
    return waitInit((d) => d.tab === 'collision', 'collision').then((init) => {
      assert.deepStrictEqual(
        init.data.lqCollisionDays.map((d) => d.num),
        [3, 5, 10, 20, 60, 100],
        '碰撞天数应为 6 档'
      );
      assert.strictEqual(init.data.collisionDays, 5, '默认近5天');
      assert.strictEqual(init.data.lq, null, '不应顺带拉策略选股榜单');
      assert.strictEqual(init.data.north, null);
      assert.strictEqual(init.data.cjl, null);
    });
  });

  it('selectCollisionDays days=3 → 9 类策略并发取数，碰撞结果只留≥2', function () {
    this.timeout(3000);
    lqStub.reset();
    ljgxStub.state.session = { sessionId: 'tok' };
    lqStub.state.byTag = {
      cd: lqResult(['sz300750', 'sh601127', 'sz000001']),
      qs: lqResult(['sz300750', 'sh601127', 'sz002594']),
      dwfl: lqResult(['sz002594', 'sh600036']),
      szx: lqResult(['sz000001']),
      ztb: lqResult(['sh601127', 'sz300750']),
      cx: lqResult([]),
      hy: lqResult(['sz002594']),
      jzc: lqResult(['sh600036']),
      fk: lqResult(['sz300750', 'sh601127']),
    };

    panel.fire({ command: 'selectCollisionDays', days: 3 });
    return waitCollision((d) => d.days === 3, 'days=3').then((msg) => {
      const calls = lqStub.calls.filter((c) => c.days === 3);
      assert.strictEqual(calls.length, 9, `应并发拉 9 类策略，实际 ${calls.length}`);
      assert.deepStrictEqual(
        calls.map((c) => c.tag),
        ['cd', 'qs', 'dwfl', 'szx', 'ztb', 'cx', 'hy', 'jzc', 'fk']
      );
      assert.strictEqual(msg.data.available, 9);
      assert.strictEqual(msg.data.total, 9);
      assert.strictEqual(msg.data.failed, false);
      assert.strictEqual(msg.data.rows.length, 5, '只应保留命中≥2 的 5 只');
      assert.strictEqual(msg.data.rows[0].hits, 4);
      assert.deepStrictEqual(msg.data.rows[0].tags, ['超跌', '趋势', '涨停', '风口']);
    });
  });

  it('重复选择同一档 → 命中 30min 缓存不再请求', function () {
    this.timeout(3000);
    const all = panelStub.created.reduce((acc, p) => acc.concat(p.webview.pushed), []);
    const count = all.filter((m) => m.type === 'collision' && m.data.days === 3).length;
    const before = lqStub.calls.filter((c) => c.days === 3).length;

    panel.fire({ command: 'selectCollisionDays', days: 3 });
    return waitCollision((d) => d.days === 3, 'days=3 二次', count)
      .then(() => new Promise((resolve) => setTimeout(resolve, 120)))
      .then(() => {
        assert.strictEqual(
          lqStub.calls.filter((c) => c.days === 3).length,
          before,
          '同档重算不应重复请求'
        );
      });
  });

  it('部分策略失败 → available 只数成功项，failed=false 且按可用策略计算', function () {
    this.timeout(3000);
    const byTag = {};
    for (const t of ['cd', 'qs', 'dwfl', 'szx', 'ztb', 'cx', 'hy', 'jzc', 'fk']) byTag[t] = null;
    byTag.cd = lqResult(['000001', '000002']);
    byTag.qs = lqResult(['000001']);
    lqStub.state.byTag = byTag;
    ljgxStub.state.session = { sessionId: 'tok' };

    panel.fire({ command: 'selectCollisionDays', days: 10 });
    return waitCollision((d) => d.days === 10, 'days=10').then((msg) => {
      assert.strictEqual(msg.data.available, 2);
      assert.strictEqual(msg.data.total, 9);
      assert.strictEqual(msg.data.failed, false);
      assert.strictEqual(msg.data.rows.length, 1);
      assert.deepStrictEqual(msg.data.rows[0].tags, ['超跌', '趋势']);
    });
  });

  it('全部失败 / 未登录 → 分别下发 failed、unlogged 且不误发请求', function () {
    this.timeout(3000);
    lqStub.state.byTag = null;
    lqStub.state.lq = null;
    ljgxStub.state.session = { sessionId: 'tok' };
    panel.fire({ command: 'selectCollisionDays', days: 20 });
    return waitCollision((d) => d.days === 20 && d.failed === true, 'days=20 全失败')
      .then(() => {
        ljgxStub.state.session = null;
        lqStub.reset();
        panel.fire({ command: 'selectCollisionDays', days: 60 });
        return waitCollision((d) => d.days === 60 && d.unlogged === true, 'days=60 未登录');
      })
      .then(() => {
        assert.strictEqual(
          lqStub.calls.filter((c) => c.days === 60).length,
          0,
          '未登录不应请求策略接口'
        );
      });
  });

  it('refreshCollision → 清当前档 9 个缓存 key 后重拉', function () {
    this.timeout(3000);
    ljgxStub.state.session = { sessionId: 'tok' };
    lqStub.reset();
    lqStub.state.lq = lqResult(['000001']);

    panel.fire({ command: 'selectCollisionDays', days: 100 });
    return waitCollision((d) => d.days === 100, 'days=100')
      .then(() => {
        assert.strictEqual(lqStub.calls.filter((c) => c.days === 100).length, 9);
        panel.fire({ command: 'refreshCollision' });
        return waitCollision((d) => d.days === 100, 'days=100 刷新', 1);
      })
      .then(() => {
        assert.strictEqual(
          lqStub.calls.filter((c) => c.days === 100).length,
          18,
          '刷新应清缓存并重新拉 9 个'
        );
      });
  });

  it('requestCollision → 按当前窗口自动推碰撞（命中缓存不重复请求）', function () {
    this.timeout(3000);
    const all = panelStub.created.reduce((acc, p) => acc.concat(p.webview.pushed), []);
    const count = all.filter((m) => m.type === 'collision' && m.data.days === 100).length;
    const before = lqStub.calls.filter((c) => c.days === 100).length;

    panel.fire({ command: 'requestCollision' });
    return waitCollision((d) => d.days === 100, 'requestCollision', count)
      .then(() => new Promise((resolve) => setTimeout(resolve, 120)))
      .then(() => {
        assert.strictEqual(
          lqStub.calls.filter((c) => c.days === 100).length,
          before,
          '自动加载命中缓存时不应重复请求'
        );
      });
  });
});
