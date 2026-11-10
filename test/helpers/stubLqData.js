/**
 * 量化面板宿主测试桩：代替 out/webview/quantPanel 依赖的 ../shared/lqData。
 * 元数据与碰撞纯函数取真实数据层（单一数据源），只桩掉网络拉取并记录调用参数。
 * state.byTag 可按策略返回不同榜单/失败，用于验证「数据碰撞」批量取数与降级。
 */
const real = require('../../out/shared/lqData');

const calls = [];
const state = { lq: null, byTag: null };

function reset() {
  calls.length = 0;
  state.lq = null;
  state.byTag = null;
}

module.exports = {
  calls,
  state,
  reset,
  LQ_TAGS: real.LQ_TAGS,
  LQ_DAYS: real.LQ_DAYS,
  LQ_COLLISION_DAYS: real.LQ_COLLISION_DAYS,
  DEFAULT_COLLISION_DAYS: real.DEFAULT_COLLISION_DAYS,
  collideLqResults: real.collideLqResults,
  fetchLqList(tag, days) {
    calls.push({ name: 'fetchLqList', tag, days });
    const value =
      state.byTag && Object.prototype.hasOwnProperty.call(state.byTag, tag)
        ? state.byTag[tag]
        : state.lq;
    return Promise.resolve(value);
  },
};
