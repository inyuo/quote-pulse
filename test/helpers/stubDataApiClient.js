/**
 * 量化面板宿主测试桩：代替 out/webview/quantPanel 依赖的 ../shared/dataApiClient。
 * 记录 getCollision(days) 调用；state.collision 为 null 表示服务端不可用。
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
    return Promise.resolve(state.collision);
  },
};
