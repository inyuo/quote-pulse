/**
 * 资金动态宿主测试桩：代替 out/webview/stockFundFlow 依赖的 ../shared/fundFlowData。
 * 重点记录 loadStockDetail(code, deps)，用于断言登录态 store 是否透传；
 * loadStockQuick 默认返回 null（不推 detailQuick），需要断言分阶段推送时再覆盖。
 */
const calls = [];
let quickResult = null;

module.exports = {
  calls,
  loadStockFundRows: async () => [],
  loadIndustryRows: async () => [],
  loadStockQuick: async (code) => {
    if (quickResult === null) return null;
    return { code, name: '浪潮信息', price: 57.35, percent: 2.87, ...quickResult };
  },
  loadStockDetail: async (code, deps) => {
    calls.push({ code, deps });
    return {
      code,
      name: '浪潮信息',
      price: 57.35,
      percent: 2.87,
      mainFlow: null,
      analysis: [],
      sectors: [],
      fundTables: [],
    };
  },
  /** 设置 quick 返回值（null = 不推 detailQuick；{} = 推默认值） */
  setQuickResult(value) {
    quickResult = value;
  },
  reset() {
    calls.length = 0;
    quickResult = null;
  },
};
