/**
 * 量化面板宿主测试桩：代替 out/webview/quantPanel 依赖的 ../shared/dataApiClient。
 * 记录 getCollision(days) 调用；state.collision 支持两种形态：
 * - 结构化结果 {ok:true,data:{rows,...}} / {ok:false,reason:'no_data',...}
 * - 传统快照载荷 {rows,...}（自动包成 ok:true，兼容旧的宿主用例）
 * null 表示网络不可达（ok:false, reason:'unreachable'）。
 */
const calls = [];
const state = { collision: null, enabled: true };

function reset() {
  calls.length = 0;
  state.collision = null;
  state.enabled = true;
}

module.exports = {
  calls,
  state,
  reset,
  isEnabled() {
    return state.enabled;
  },
  getCollision(days) {
    calls.push({ name: 'getCollision', days });
    const value = state.collision;
    if (!value) return Promise.resolve({ ok: false, reason: 'unreachable' });
    if (value.ok === true || value.ok === false) return Promise.resolve(value);
    return Promise.resolve({ ok: true, data: value });
  },
};
