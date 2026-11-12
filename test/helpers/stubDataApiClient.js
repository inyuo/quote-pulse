/**
 * 量化面板宿主测试桩：代替 out/webview/quantPanel 依赖的 ../shared/dataApiClient。
 * 记录 getCollision(days) 调用；state.collision 支持两种形态：
 * - 结构化结果 {ok:true,data:{rows,...}} / {ok:false,reason:'no_data',...}
 * - 传统快照载荷 {rows,...}（自动包成 ok:true，兼容旧的宿主用例）
 * null 表示网络不可达（ok:false, reason:'unreachable'）。
 *
 * 另记录 setApiKey 的写入，并让 getApiKeyState 随写入变化，供密钥入口用例断言。
 */
const calls = [];
const configWrites = [];
const state = { collision: null, enabled: true, apiKey: '' };

function reset() {
  calls.length = 0;
  configWrites.length = 0;
  state.collision = null;
  state.enabled = true;
  state.apiKey = '';
}

module.exports = {
  calls,
  configWrites,
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
  getApiKeyState() {
    const key = state.apiKey;
    return {
      configured: !!key,
      masked: key ? key.slice(0, 2) + '***' + key.slice(-2) : '',
      baseUrl: 'http://127.0.0.1:8800',
      weak: key.length > 0 && key.length < 16,
    };
  },
  setApiKey(key) {
    configWrites.push(key);
    state.apiKey = typeof key === 'string' ? key.trim() : '';
    return Promise.resolve({ ok: true });
  },
};
