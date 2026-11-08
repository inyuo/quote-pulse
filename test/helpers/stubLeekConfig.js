/**
 * 资金动态宿主测试桩：代替 out/webview/stockFundFlow 依赖的 ../shared/leekConfig。
 * updateStockCfg 真实实现是异步写配置后回调，这里同步触发回调便于断言。
 */
const calls = [];

module.exports = {
  calls,
  LeekFundConfig: {
    updateStockCfg(code, cb) {
      calls.push({ code });
      if (typeof cb === 'function') cb([code], [code]);
    },
  },
  reset() {
    calls.length = 0;
  },
};
