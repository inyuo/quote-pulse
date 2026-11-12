/**
 * 量化面板（4 个 tab：量价分层 / 北向资金 / 大盘指数 / 数据碰撞）测试。
 *
 * 模板部分 —— 伪 DOM 执行 quant.html 内联 script（webview-dom）：
 * 1) canvas 三个 tab 的绘制、空态与布局重画；
 * 2) 数据碰撞的 6 档窗口、9 类标签 chips、标签叠加筛选（AND）、关键字搜索、
 *    命中列排序、清空/Esc、无匹配占位、服务端不可用空态与重试。
 *
 * 宿主部分 —— require out/webview/quantPanel，经 Module._resolveFilename
 * 重定向 'vscode' 与依赖：懒加载、服务端碰撞快照、60s 缓存、刷新与空态。
 *
 * 另含「扫码登录 / 掘金分栏 / 策略选股已彻底下线」的源码与清单护栏。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { loadTemplate, setRect } = require('./helpers/webview-dom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const vscodeMockPath = path.join(__dirname, 'helpers', 'vscode-mock.js');
const stubPanelPath = path.join(__dirname, 'helpers', 'stubReusedWebviewPanel.js');
const stubLjgxPath = path.join(__dirname, 'helpers', 'stubLjgxViewData.js');
const stubApiPath = path.join(__dirname, 'helpers', 'stubDataApiClient.js');
const stubUtilsPath = path.join(__dirname, 'helpers', 'stubUtils.js');

const prevResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const parent = rest[0];
  if (request === 'vscode') return vscodeMockPath;
  if (parent && parent.filename && parent.filename.endsWith('quantPanel.js')) {
    if (request === './ReusedWebviewPanel') return stubPanelPath;
    if (request === '../shared/utils') return stubUtilsPath;
    if (request === '../shared/ljgxData') return stubLjgxPath;
    if (request === '../shared/dataApiClient') return stubApiPath;
  }
  return prevResolveFilename.call(this, request, ...rest);
};

const ljgxStub = require('./helpers/stubLjgxViewData');
const apiStub = require('./helpers/stubDataApiClient');
const vscodeMock = require('./helpers/vscode-mock');
const panelStub = require('./helpers/stubReusedWebviewPanel');
const { LQ_TAGS, LQ_COLLISION_DAYS } = require('../out/shared/lqData');

/** 构造 init 推送载荷（其他 tab 字段恒 null —— 懒加载语义） */
function initPayload(tab, fields) {
  return Object.assign(
    {
      tab,
      cjl: null,
      north: null,
      index: null,
      collisionDays: 5,
      collisionDayMeta: LQ_COLLISION_DAYS,
      collisionTags: LQ_TAGS.map((t) => t.label),
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

/** 数据碰撞 tab 的 init 载荷 */
function collisionPayload(fields) {
  return initPayload('collision', fields);
}

/** 宿主 → 模板的独立碰撞消息载荷（服务端预计算快照） */
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
      unavailable: false,
      dataDate: '2026-11-11',
      updatedAt: new Date().toISOString(),
    },
    fields || {}
  );
}

function northData() {
  return {
    times: ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '15:00'],
    hgtNet: [1.2, 2.5, 3.1, 2.8, 3.3, 3.6, 4.2, 5.1],
    szgtNet: [0.8, 1.4, 1.0, 1.9, 2.2, 1.6, 2.4, 3.0],
  };
}

function count(ctx, name) {
  return ctx.calls.filter((c) => c.name === name).length;
}

/** 构造点击委托事件：只有指定属性有值，其余为 null */
function attr(key, value) {
  return { target: { getAttribute: (k) => (k === key ? value : null) } };
}

function showCollision(page, data) {
  page.fire('message', { data: { type: 'init', data: collisionPayload() } });
  page.fire('message', { data: { type: 'collision', data: collisionData(data) } });
}

describe('扫码登录 / 掘金分栏 / 策略选股已彻底下线', () => {
  it('模板与宿主不含扫码登录、策略选股与本地会话', () => {
    const tpl = read('template/quant.html');
    for (const word of ['扫码', 'openLogin', 'tabLq', 'selectLqTag', 'renderLq', 'lqUnlogged']) {
      assert.ok(!tpl.includes(word), `模板不应再包含 ${word}`);
    }
    const host = read('src/webview/quantPanel.ts');
    for (const word of ['quantLogin', 'LjgxStorage', 'loadSession', 'initQuantPanel', 'openLogin']) {
      assert.ok(!host.includes(word), `宿主不应再包含 ${word}`);
    }
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'src/webview/quantLogin.ts')), false);
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'src/explorer/quantProvider.ts')), false);
  });

  it('package.json 删除掘金分栏/登录命令，Settings 在个性定制后有量化面板', () => {
    const pkg = JSON.parse(read('package.json'));
    const views = pkg.contributes.views.leekFundMenu.map((v) => v.id);
    assert.ok(!views.includes('leekFundView.quant'), '不应再有掘金分栏');
    assert.ok(!pkg.activationEvents.includes('onView:leekFundView.quant'));

    const cmds = pkg.contributes.commands.map((c) => c.command);
    assert.ok(!cmds.includes('quote-pulse.quantLogin'), '不应再声明扫码登录命令');
    assert.ok(!cmds.includes('quote-pulse.refreshQuant'), '不应再声明掘金刷新命令');
    assert.ok(cmds.includes('quote-pulse.quantOpen'));
    assert.ok(
      !JSON.stringify(pkg.contributes.menus).includes('quote-pulse.refreshQuant'),
      '菜单不应再引用已删除命令'
    );

    const welcome = pkg.contributes.viewsWelcome.find((v) => v.view === 'leekFundView.settings').contents;
    assert.ok(welcome.includes('[📊 量化面板](command:quote-pulse.quantOpen)'), 'Settings 应有量化面板入口');
    assert.ok(welcome.indexOf('个性定制') < welcome.indexOf('量化面板'), '量化面板应排在个性定制之后');
  });

  it('量化面板命令默认打开 north tab', () => {
    assert.ok(read('src/registerCommand.ts').includes("? target.tab : 'north'"));
  });

  it('dataApiBaseUrl 默认指向数据服务，API Key 仍需用户填写', () => {
    const props = JSON.parse(read('package.json')).contributes.configuration.properties;
    assert.ok(/^https?:\/\/\S+:\d+$/.test(props['quote-pulse.dataApiBaseUrl'].default), '应默认配置服务地址');
    assert.strictEqual(props['quote-pulse.dataApiKey'].default, '', '密钥不能写进仓库');
  });
});

describe('量化面板模板 quant.html', () => {
  it('画布零尺寸（布局未完成）时静默跳过，并在布局就绪后延迟重画', async () => {
    setRect(0, 0);
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: {
        type: 'init',
        data: initPayload('cjl', { cjl: { tm: '2026-11-04', price: [10, 20.5, null, 30] } }),
      },
    });

    const ctx = page.el('chart').getContext('2d');
    assert.strictEqual(ctx.calls.length, 0, '零尺寸时不应有绘制指令');

    setRect(800, 300);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(ctx.calls.length > 0, `延迟重画后应有绘制指令，实际 ${ctx.calls.length}`);
  });

  it('resize 触发当前 Tab 重画', () => {
    setRect(800, 300);
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
    page.fire('resize', {});
    assert.ok(ctx.calls.length > before, `resize 后应重画，实际 ${before} → ${ctx.calls.length}`);
  });

  it('默认 tab north：高亮北向资金，4 个 tab 且不含策略选股', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: { type: 'init', data: initPayload('north', { north: northData() }) },
    });
    assert.ok(page.el('tabNorth').className.includes('active'), 'north 应默认高亮');
    assert.ok(!page.el('tabCjl').className.includes('active'));
    assert.ok(!page.el('tabIndex').className.includes('active'));
    assert.ok(!page.el('tabCollision').className.includes('active'));
    assert.ok(!read('template/quant.html').includes('id="tabLq"'), '不应再有策略选股 tab');
  });

  it('north 数据 → canvas 折线与刻度绘制指令被调用', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: { type: 'init', data: initPayload('north', { north: northData() }) },
    });
    const ctx = page.el('chart').getContext('2d');
    assert.ok(count(ctx, 'lineTo') >= 8, '北向双折线应产生足够 lineTo');
    assert.ok(count(ctx, 'fillText') >= 4, '图例与刻度应产生 fillText');
    assert.strictEqual(page.el('chartWrap').style.display, 'block');
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
    assert.ok(page.el('tabIndex').className.includes('active'));
    const texts = page
      .el('chart')
      .getContext('2d')
      .calls.filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]))
      .join('|');
    assert.ok(texts.includes('上证指数') && texts.includes('深证成指'));
  });

  it('cjl 数据为 null（服务端不可用）→ 空态可重试，且无登录引导', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: initPayload('cjl') } });

    const html = page.el('chartEmpty').innerHTML;
    assert.ok(html.includes('数据加载失败，点击重试'), `应显示可重试空态，实际：${html}`);
    assert.ok(!html.includes('登录'), '不应再出现登录引导');
    page.el('chartEmpty').listeners.click[0]();
    assert.ok(page.posted.some((m) => m.command === 'refresh'));
  });

  it('cjl 真实 121 点累计成交额 → 画分时曲线，不逐点标注 12 位数字', () => {
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    const price = Array.from({ length: 121 }, (_, i) => 6e9 + ((426e9 - 6e9) * i) / 120);
    page.fire('message', {
      data: { type: 'init', data: initPayload('cjl', { cjl: { tm: '2026-11-06', price } }) },
    });
    const ctx = page.el('chart').getContext('2d');
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    assert.ok(count(ctx, 'lineTo') >= 100, '累计成交额应按时间序列连成曲线');
    assert.ok(texts.length <= 20, '121 点不得逐点标注文字');
    assert.ok(!texts.some((t) => /\d{9,}/.test(t)), '金额应换算成亿/万');
  });

  it('cjl 坐标轴带单位、日期与分时刻度', () => {
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    const price = Array.from({ length: 121 }, (_, i) => 6e9 + ((426e9 - 6e9) * i) / 120);
    page.fire('message', {
      data: { type: 'init', data: initPayload('cjl', { cjl: { tm: '2026-11-06', price } }) },
    });
    const texts = page
      .el('chart')
      .getContext('2d')
      .calls.filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]))
      .join('|');
    assert.ok(/亿|万/.test(texts));
    assert.ok(texts.includes('2026-11-06'));
    assert.ok(/09:30|11:30|13:00/.test(texts));
  });

  it('cjl 累计数组含 null → 跳过 null 后仍按序列绘制', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: { type: 'init', data: initPayload('cjl', { cjl: { tm: '2026-11-04', price: [10, 20.5, null, 30] } }) },
    });
    assert.ok(count(page.el('chart').getContext('2d'), 'lineTo') >= 2);
    const texts = page.el('chart').getContext('2d').calls
      .filter((c) => c.name === 'fillText').map((c) => String(c.args[0])).join('|');
    assert.ok(texts.includes('2026-11-04'));
  });

  it('cjl 只有 1 个点 → 分时刻度不重复堆叠在同一位置', () => {
    setRect(800, 300);
    const page = loadTemplate('quant.html');
    page.fire('message', {
      data: { type: 'init', data: initPayload('cjl', { cjl: { tm: '2026-11-06', price: [6e9] } }) },
    });
    const ticks = page.el('chart').getContext('2d').calls
      .filter((c) => c.name === 'fillText' && /^\d{2}:\d{2}$/.test(String(c.args[0])));
    assert.ok(ticks.length <= 1, `单点数据不应重复标注刻度，实际 ${ticks.length} 条`);
  });

  it('数据碰撞 tab：6 档窗口 + 9 类标签 chips + 主动索取数据', () => {
    const page = loadTemplate('quant.html');
    page.fire('message', { data: { type: 'init', data: collisionPayload() } });

    assert.ok(page.el('tabCollision').className.includes('active'));
    assert.strictEqual(page.el('collisionWrap').style.display, 'block');
    assert.strictEqual(page.el('chartWrap').style.display, 'none');

    const days = page.el('collisionDays').innerHTML;
    assert.strictEqual((days.match(/data-days=/g) || []).length, 6);
    assert.ok(days.includes('近3天') && days.includes('近100天'));
    assert.ok(!days.includes('近1天') && !days.includes('近30天'));
    assert.ok(days.includes('class="lq-chip active" data-days="5"'), '默认近5天');

    const tags = page.el('collisionTagBar').innerHTML;
    assert.strictEqual((tags.match(/data-filter-tag=/g) || []).length, 9, '应渲染 9 类标签');
    assert.ok(tags.includes('data-filter-all="1">全部 0'), '未收到数据前全部为 0');
    assert.ok(page.el('collisionBody').innerHTML.includes('碰撞计算中'));
    assert.ok(page.posted.some((m) => m.command === 'requestCollision'));
  });

  it('collision 消息 → 结果表 + 标签列 + 条数/完整度/数据日期摘要', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);

    const html = page.el('collisionBody').innerHTML;
    assert.strictEqual((html.match(/data-code=/g) || []).length, 3, '应渲染 3 行结果');
    assert.ok(html.includes('<th>标签</th>'));
    assert.ok(html.includes('lq-hit-tag') && html.includes('风口'));
    assert.ok(html.includes('data-sort="hits"'), '命中列应可排序');
    const summary = page.el('collisionSummary').textContent;
    assert.ok(summary.includes('命中≥2 共 3 只'), `摘要缺少命中数：${summary}`);
    assert.ok(summary.includes('已取 9/9'), `摘要缺少完整度：${summary}`);
    assert.ok(summary.includes('2026-11-11'), `摘要缺少快照日期：${summary}`);
    assert.ok(page.el('collisionTagBar').innerHTML.includes('data-filter-tag="超跌">超跌 2'));
  });

  it('点击标签 chip → 只保留含该标签的行，摘要显示筛选后条数', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);

    page.el('collisionTagBar').listeners.click[0](attr('data-filter-tag', '超跌'));
    const html = page.el('collisionBody').innerHTML;
    assert.strictEqual((html.match(/data-code=/g) || []).length, 2, '「超跌」应命中 2 只');
    assert.ok(!html.includes('比亚迪'), '不含该标签的行应被过滤');
    assert.ok(page.el('collisionSummary').textContent.includes('筛选后 2 只'));
    assert.ok(page.el('collisionFilterHint').textContent.includes('同时命中'));
    assert.ok(page.el('collisionTagBar').innerHTML.includes('class="lq-chip active" data-filter-tag="超跌"'));
  });

  it('点击表格内的标签 → 同样切换筛选；「全部」一键清空', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);

    page.el('collisionBody').listeners.click[0](attr('data-filter-tag', '低位'));
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 1);
    assert.ok(page.el('collisionBody').innerHTML.includes('比亚迪'));

    page.el('collisionTagBar').listeners.click[0](attr('data-filter-all', '1'));
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 3);
  });

  it('多选标签按「同时命中」收窄，无匹配时给出清空入口', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);

    page.el('collisionTagBar').listeners.click[0](attr('data-filter-tag', '超跌'));
    page.el('collisionTagBar').listeners.click[0](attr('data-filter-tag', '低位'));
    const html = page.el('collisionBody').innerHTML;
    assert.ok(html.includes('没有符合筛选条件的股票'), `应显示无匹配占位，实际：${html}`);
    assert.ok(html.includes('data-action="clear"'), '占位应可一键清空');

    page.el('collisionBody').listeners.click[0](attr('data-action', 'clear'));
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 3);
    assert.strictEqual(page.el('collisionSearch').value, '');
  });

  it('搜索代码 / 名称即时过滤，清空按钮与 Esc 都能复位', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);
    const input = page.el('collisionSearch');

    input.value = '宁德';
    input.listeners.input[0]({ target: input });
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 1);

    page.el('collisionClear').listeners.click[0]();
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 3);

    input.value = 'sz002594';
    input.listeners.input[0]({ target: input });
    assert.ok(page.el('collisionBody').innerHTML.includes('比亚迪'));

    page.fire('keydown', { key: 'Escape' });
    assert.strictEqual((page.el('collisionBody').innerHTML.match(/data-code=/g) || []).length, 3);
    assert.strictEqual(input.value, '');
  });

  it('点击「命中」表头切换升降序', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);
    assert.ok(page.el('collisionBody').innerHTML.indexOf('赛力斯') < page.el('collisionBody').innerHTML.indexOf('比亚迪'));

    page.el('collisionBody').listeners.click[0](attr('data-sort', 'hits'));
    const html = page.el('collisionBody').innerHTML;
    assert.ok(html.indexOf('比亚迪') < html.indexOf('赛力斯'), '升序时命中 3 的应排在最前');
    assert.ok(html.includes('命中 ▲'), '表头应反映当前排序方向');
  });

  it('无命中 / 部分策略可用 → 空态与完整度分别标注', () => {
    const page = loadTemplate('quant.html');
    showCollision(page, { available: 7 });
    assert.ok(page.el('collisionSummary').textContent.includes('已取 7/9'));

    page.fire('message', { data: { type: 'collision', data: collisionData({ rows: [] }) } });
    assert.ok(page.el('collisionBody').innerHTML.includes('没有命中'));
  });

  it('服务端失败 → 按原因显示差异化空态与重试入口，且无登录引导', () => {
    const cases = [
      { reason: 'unconfigured', text: '数据服务未配置', tip: 'quote-pulse.dataApiBaseUrl' },
      { reason: 'unauthorized', text: 'API Key 无效', tip: 'QP_API_KEY', httpStatus: 401 },
      { reason: 'no_data', text: '暂无近5天碰撞快照', tip: '下一轮抓取' },
      { reason: 'unreachable', text: '数据服务连接失败', tip: '8800 端口' },
      { reason: 'invalid_response', text: '数据服务返回异常', tip: '服务端版本' },
    ];
    for (const c of cases) {
      const page = loadTemplate('quant.html');
      page.fire('message', { data: { type: 'init', data: collisionPayload() } });
      page.fire('message', {
        data: {
          type: 'collision',
          data: collisionData({ unavailable: true, reason: c.reason, httpStatus: c.httpStatus || 0 }),
        },
      });

      const html = page.el('collisionBody').innerHTML;
      assert.ok(html.includes(c.text), `${c.reason} 应显示「${c.text}」，实际：${html}`);
      assert.ok(html.includes(c.tip), `${c.reason} 应给出对应引导：${html}`);
      assert.ok(!html.includes('登录') && !html.includes('扫码'), '不应再有登录引导');
      assert.ok(html.includes('data-action="retry"'), `${c.reason} 应可重试`);

      page.el('collisionBody').listeners.click[0](attr('data-action', 'retry'));
      assert.ok(page.posted.some((m) => m.command === 'refreshCollision'));
    }
  });

  it('数据碰撞切档 / 点击个股 → 发 selectCollisionDays / openStock', () => {
    const page = loadTemplate('quant.html');
    showCollision(page);

    page.el('collisionDays').listeners.click[0](attr('data-days', '10'));
    const dayMsg = page.posted.find((m) => m.command === 'selectCollisionDays');
    assert.ok(dayMsg && dayMsg.days === 10);
    assert.ok(page.el('collisionDays').innerHTML.includes('class="lq-chip active" data-days="10"'));

    page.el('collisionBody').listeners.click[0](attr('data-code', 'sh601127'));
    assert.ok(page.posted.some((m) => m.command === 'openStock' && m.code === 'sh601127'));
  });
});

describe('量化面板宿主 quantPanel.ts', () => {
  let panel;

  function allPushed() {
    return panelStub.created.reduce((acc, p) => acc.concat(p.webview.pushed), []);
  }

  /** 轮询等待满足条件的最后一条 init 推送 */
  function waitInit(predicate, label) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const found = allPushed().filter((m) => m.type === 'init' && predicate(m.data)).pop();
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
        const matches = allPushed().filter((m) => m.type === 'collision' && predicate(m.data));
        if (matches.length > min) return resolve(matches[matches.length - 1]);
        if (Date.now() - start > 2000) return reject(new Error(`等待 ${label} 推送超时`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  before(() => {
    panelStub.reset();
    ljgxStub.reset();
    apiStub.reset();
    ljgxStub.state.north = northData();
    ljgxStub.state.index = [
      { code: 'sh000001', name: '上证指数', price: [3600, 3610, 3595], percent: 0.35 },
      { code: 'sz399001', name: '深证成指', price: [11200, 11250, 11310], percent: 0.98 },
    ];
    ljgxStub.state.cjl = { tm: '2026-11-04', price: [5, 9, 14] };
    apiStub.state.collision = {
      rows: [
        { code: 'sh601127', name: '赛力斯', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
        { code: 'sz300750', name: '宁德时代', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
      ],
      available: 9,
      total: 9,
      dataDate: '2026-11-11',
    };

    const host = require('../out/webview/quantPanel');
    host.quantPanel('north');
    panel = panelStub.created[0];
    assert.ok(panel, '宿主应创建面板');
    panel.fire({ command: 'ready' });
  });

  it('init 懒加载：tab=north → 只发北向请求，cjl/index 字段为 null', function () {
    this.timeout(2000);
    return waitInit((d) => d.tab === 'north', 'north').then((init) => {
      assert.ok(init.data.north && init.data.north.times.length);
      assert.strictEqual(init.data.cjl, null);
      assert.strictEqual(init.data.index, null);
      assert.strictEqual(init.data.collisionTags.length, 9);
      const names = ljgxStub.calls.map((c) => c.name);
      assert.strictEqual(names[0], 'fetchNorthFundTrends');
      assert.strictEqual(names.indexOf('fetchShareCjl'), -1);
      assert.strictEqual(names.indexOf('fetchIndexSpark'), -1);
    });
  });

  it('selectTab cjl → 拉 fetchShareCjl 且不再注入本地会话', function () {
    this.timeout(2000);
    const before = ljgxStub.calls.length;
    panel.fire({ command: 'selectTab', tab: 'cjl' });
    return waitInit((d) => d.tab === 'cjl' && d.cjl, 'cjl').then(() => {
      const call = ljgxStub.calls.slice(before).find((c) => c.name === 'fetchShareCjl');
      assert.ok(call, '应调用 fetchShareCjl');
      assert.ok(!call.deps || !call.deps.store, '不应再传 store');
    });
  });

  it('selectTab index + refresh → 重拉当前 tab（fetchIndexSpark 共 2 次）', function () {
    this.timeout(2000);
    const before = ljgxStub.calls.length;
    panel.fire({ command: 'selectTab', tab: 'index' });
    return waitInit((d) => d.tab === 'index' && d.index, 'index').then(() => {
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
        assert.strictEqual(sparks.length, 2);
      });
    });
  });

  it('selectTab collision → 下发 6 档窗口 / 9 类标签 / 默认近5天', function () {
    this.timeout(2000);
    panel.fire({ command: 'selectTab', tab: 'collision' });
    return waitInit((d) => d.tab === 'collision', 'collision').then((init) => {
      assert.deepStrictEqual(init.data.collisionDayMeta.map((d) => d.num), [3, 5, 10, 20, 60, 100]);
      assert.deepStrictEqual(init.data.collisionTags, LQ_TAGS.map((t) => t.label));
      assert.strictEqual(init.data.collisionDays, 5);
      assert.strictEqual(init.data.north, null);
      assert.strictEqual(init.data.cjl, null);
    });
  });

  it('requestCollision → 走服务端预计算快照并下发 rows/完整度/日期', function () {
    this.timeout(2000);
    const before = apiStub.calls.length;
    panel.fire({ command: 'requestCollision' });
    return waitCollision((d) => d.days === 5 && d.rows.length === 2, 'collision').then((msg) => {
      assert.deepStrictEqual(apiStub.calls.slice(before).map((c) => c.days), [5]);
      assert.strictEqual(msg.data.unavailable, false);
      assert.strictEqual(msg.data.available, 9);
      assert.strictEqual(msg.data.total, 9);
      assert.strictEqual(msg.data.dataDate, '2026-11-11');
    });
  });

  it('重复 requestCollision → 命中 60s 快照缓存，不重复请求服务端', function () {
    this.timeout(2000);
    const count = allPushed().filter((m) => m.type === 'collision' && m.data.days === 5).length;
    const before = apiStub.calls.length;
    panel.fire({ command: 'requestCollision' });
    return waitCollision((d) => d.days === 5, 'collision 二次', count)
      .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
      .then(() => assert.strictEqual(apiStub.calls.length, before));
  });

  it('selectCollisionDays days=3 → 按新窗口取服务端快照', function () {
    this.timeout(2000);
    panel.fire({ command: 'selectCollisionDays', days: 3 });
    return waitCollision((d) => d.days === 3, 'days=3').then((msg) => {
      assert.ok(apiStub.calls.some((c) => c.days === 3));
      assert.strictEqual(msg.data.unavailable, false);
    });
  });

  it('refreshCollision → 清当前档缓存后重拉一次', function () {
    this.timeout(2000);
    const count = allPushed().filter((m) => m.type === 'collision' && m.data.days === 3).length;
    const before = apiStub.calls.length;
    panel.fire({ command: 'refreshCollision' });
    return waitCollision((d) => d.days === 3, 'days=3 刷新', count).then(() => {
      assert.strictEqual(apiStub.calls.length, before + 1);
    });
  });

  it('取数失败 → 下发 unavailable + 具体 reason/httpStatus', function () {
    this.timeout(2000);
    apiStub.state.collision = { ok: false, reason: 'unauthorized', status: 401 };
    panel.fire({ command: 'selectCollisionDays', days: 10 });
    return waitCollision((d) => d.days === 10 && d.unavailable === true, 'unauthorized').then((msg) => {
      assert.deepStrictEqual(msg.data.rows, []);
      assert.strictEqual(msg.data.available, 0);
      assert.strictEqual(msg.data.reason, 'unauthorized');
      assert.strictEqual(msg.data.httpStatus, 401);
      assert.ok(apiStub.calls.some((c) => c.days === 10));
      assert.ok(!('unlogged' in msg.data) && !('failed' in msg.data));
    });
  });

  it('失败结果不进缓存：连续两次 requestCollision 都重新请求服务端', function () {
    this.timeout(2000);
    apiStub.state.collision = { ok: false, reason: 'no_data', status: 200 };
    const before = apiStub.calls.length;
    const sameResult = (m) =>
      m.type === 'collision' && m.data.days === 10 && m.data.reason === 'no_data';
    let count = allPushed().filter(sameResult).length;

    panel.fire({ command: 'requestCollision' });
    return waitCollision((d) => d.days === 10 && d.reason === 'no_data', 'no_data', count)
      .then(() => {
        count = allPushed().filter(sameResult).length;
        panel.fire({ command: 'requestCollision' });
        return waitCollision((d) => d.days === 10 && d.reason === 'no_data', 'no_data 二次', count);
      })
      .then(() => {
        assert.strictEqual(apiStub.calls.length, before + 2, '失败不应命中 60s 快照缓存');
      });
  });

  it('openStock → 转发 quote-pulse.stockFundFlowForStock（参数 {id: code}）', () => {
    vscodeMock.commandCalls.length = 0;
    panel.fire({ command: 'openStock', code: '000001' });
    assert.strictEqual(vscodeMock.commandCalls.length, 1);
    assert.strictEqual(vscodeMock.commandCalls[0].name, 'quote-pulse.stockFundFlowForStock');
    assert.deepStrictEqual(vscodeMock.commandCalls[0].args[0], { id: '000001' });
  });
});
