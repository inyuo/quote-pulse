/**
 * 资金动态宿主回归：三块表格走需登录态的 analy.get_sp，
 * 必须确认 initStockFundFlow 注入的 store 真的传到了 loadStockDetail，
 * 否则线上永远拿不到数据、右栏被当成「未登录」整块隐藏。
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const vscodeMockPath = path.join(__dirname, 'helpers', 'vscode-mock.js');
const stubPanelPath = path.join(__dirname, 'helpers', 'stubReusedWebviewPanel.js');
const stubUtilsPath = path.join(__dirname, 'helpers', 'stubUtils.js');
const stubFundPath = path.join(__dirname, 'helpers', 'stubFundFlowData.js');
const stubConfigPath = path.join(__dirname, 'helpers', 'stubLeekConfig.js');

const prevResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const parent = rest[0];
  if (request === 'vscode') return vscodeMockPath;
  if (parent && parent.filename && parent.filename.endsWith('stockFundFlow.js')) {
    if (request === './ReusedWebviewPanel') return stubPanelPath;
    if (request === '../shared/utils') return stubUtilsPath;
    if (request === '../shared/fundFlowData') return stubFundPath;
    if (request === '../shared/leekConfig') return stubConfigPath;
  }
  return prevResolveFilename.call(this, request, ...rest);
};

const vscodeMock = require('./helpers/vscode-mock');
vscodeMock.workspace = {
  getConfiguration: () => ({ get: () => ['sh600519', 'sz000977'] }),
};
const panelStub = require('./helpers/stubReusedWebviewPanel');
const fundStub = require('./helpers/stubFundFlowData');
const configStub = require('./helpers/stubLeekConfig');
const host = require('../out/webview/stockFundFlow');

/** 等 pushDetail 的 Promise 链落地 */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('资金动态宿主 stockFundFlow', () => {
  let panel;

  before(() => {
    panelStub.reset();
    host.stockFundFlow('sh600519');
    panel = panelStub.created[0];
  });

  beforeEach(() => {
    fundStub.reset();
    configStub.reset();
  });

  it('未注入 store 时详情取数的 deps.store 为 undefined', async () => {
    panel.fire({ command: 'select', code: 'sh600519' });
    await tick();

    const call = fundStub.calls.find((c) => c.code === 'sh600519');
    assert.ok(call, '应触发详情取数');
    assert.ok(call.deps, '应传 deps');
    assert.strictEqual(call.deps.store, undefined);
  });

  it('initStockFundFlow 注入的 store 透传到详情取数，detail 消息带 fundTables', async () => {
    const store = { get: () => undefined, update: () => Promise.resolve() };
    host.initStockFundFlow(store);

    const before = panel.webview.pushed.length;
    panel.fire({ command: 'select', code: 'sz000977' });
    await tick();

    const call = fundStub.calls.find((c) => c.code === 'sz000977');
    assert.ok(call, '应触发详情取数');
    assert.strictEqual(call.deps.store, store, '登录态必须透传给 analy.get_sp');

    const detail = panel.webview.pushed.slice(before).find((m) => m.type === 'detail');
    assert.ok(detail, '应推送 detail 消息');
    assert.ok(Array.isArray(detail.data.fundTables), 'detail 应携带三块表格字段');
  });

  it('openTrend → 转发 leek-fund.stockItemClick（沪市，参数带 0 前缀与 sh/sz 代码）', () => {
    vscodeMock.commandCalls.length = 0;
    panel.fire({ command: 'openTrend', code: 'sh600519', name: '贵州茅台' });

    const call = vscodeMock.commandCalls.find((c) => c.name === 'leek-fund.stockItemClick');
    assert.ok(call, '应打开股票实时走势');
    assert.deepStrictEqual(call.args, ['0600519', '贵州茅台', '', 'sh600519']);
  });

  it('openTrend → 深市个股同样按前缀换算', () => {
    vscodeMock.commandCalls.length = 0;
    panel.fire({ command: 'openTrend', code: 'sz000977', name: '浪潮信息' });

    const call = vscodeMock.commandCalls.find((c) => c.name === 'leek-fund.stockItemClick');
    assert.ok(call, '应打开股票实时走势');
    assert.deepStrictEqual(call.args, ['0000977', '浪潮信息', '', 'sz000977']);
  });

  it('openTrend 非 A 股个股 / 脏参数 → 不打开走势页', () => {
    vscodeMock.commandCalls.length = 0;
    for (const bad of ['hk00700', 'sh000001', 'sz399001', '', null, 123]) {
      panel.fire({ command: 'openTrend', code: bad, name: 'x' });
    }
    assert.strictEqual(
      vscodeMock.commandCalls.length,
      0,
      '指数/港股/空值/非字符串都不应执行命令'
    );
  });

  it('addStock → 写入 leek-fund.stocks、刷新 Stock 树并重推 init', async () => {
    vscodeMock.commandCalls.length = 0;
    const before = panel.webview.pushed.length;

    panel.fire({ command: 'addStock', code: 'sh601127' });
    await tick();

    assert.strictEqual(configStub.calls.length, 1, '应调用 updateStockCfg');
    assert.strictEqual(configStub.calls[0].code, 'sh601127');
    assert.ok(
      vscodeMock.commandCalls.some((c) => c.name === 'leek-fund.refreshStock'),
      '应刷新侧边栏 Stock 树'
    );

    const init = panel.webview.pushed.slice(before).find((m) => m.type === 'init');
    assert.ok(init, '应重推 init 让按钮与下拉反映最新自选股');
    assert.ok(Array.isArray(init.data.watchlist), 'init 应下发 watchlist');
  });

  it('addStock 已在自选 / 非法代码 → 不写配置也不刷新', () => {
    vscodeMock.commandCalls.length = 0;
    for (const bad of ['sh600519', 'sz000977', 'hk00700', 'sh60112', '', null, 123]) {
      panel.fire({ command: 'addStock', code: bad });
    }
    assert.strictEqual(configStub.calls.length, 0, '重复/脏参数都不应写入配置');
    assert.strictEqual(vscodeMock.commandCalls.length, 0, '不应触发刷新');
  });
});
