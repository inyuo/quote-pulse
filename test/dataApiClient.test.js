const assert = require('assert');
const Module = require('module');
const axios = require('axios');
const {
  normalizeBaseUrl,
  isEnabled,
  postLjgx,
  getPublic,
  getCollision,
  maskApiKey,
  getApiKeyState,
  setApiKey,
} = require('../out/shared/dataApiClient');

describe('dataApiClient 地址归一化', () => {
  it('合法 http(s) 地址去掉末尾斜杠', () => {
    assert.strictEqual(normalizeBaseUrl('http://124.71.128.214:8800'), 'http://124.71.128.214:8800');
    assert.strictEqual(normalizeBaseUrl(' https://a.example.com/// '), 'https://a.example.com');
  });

  it('非法值一律视为未启用（防止测试桩/脏配置误触发）', () => {
    for (const raw of ['', 'ftp://a.com', 'javascript:alert(1)', null, undefined,
      123, {}, () => 'x', 'a.example.com']) {
      assert.strictEqual(normalizeBaseUrl(raw), '', String(raw));
    }
  });
});

describe('dataApiClient 未启用时零网络', () => {
  it('未配置地址时 isEnabled 为 false、请求直接返回 null', async () => {
    assert.strictEqual(isEnabled(), false);
    assert.strictEqual(await postLjgx('shares.get_lq', { tag: 'ztb', days: 5 }), null);
    assert.strictEqual(await getPublic('https://push2.eastmoney.com/api/qt/clist/get'), null);
  });
});

describe('dataApiClient.getCollision 失败原因分类', () => {
  const config = { baseUrl: 'http://127.0.0.1:8800', apiKey: 'test-key' };
  let originalLoad;
  let originalGet;
  let lastRequest;

  before(() => {
    originalLoad = Module._load;
    originalGet = axios.get;
    // settings() 延迟 require('vscode')：这里注入可控配置，不依赖真实 VS Code
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') {
        return {
          workspace: {
            getConfiguration: () => ({
              get: (key) => (key === 'dataApiBaseUrl' ? config.baseUrl : config.apiKey),
            }),
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  });

  after(() => {
    Module._load = originalLoad;
    axios.get = originalGet;
  });

  beforeEach(() => {
    config.baseUrl = 'http://127.0.0.1:8800';
    config.apiKey = 'test-key';
    lastRequest = null;
    axios.get = async (url, opts) => {
      lastRequest = { url, opts };
      return { status: 200, data: { success: true, data: { rows: [], available: 9, total: 9 } } };
    };
  });

  it('未配置地址 → unconfigured，不发任何请求', async () => {
    config.baseUrl = '';
    let called = false;
    axios.get = async () => {
      called = true;
      return {};
    };
    assert.deepStrictEqual(await getCollision(5), { ok: false, reason: 'unconfigured' });
    assert.strictEqual(called, false);
  });

  it('成功快照 → ok + 数据日期/缓存标记，且请求带 days/date 与 X-API-Key', async () => {
    axios.get = async (url, opts) => {
      lastRequest = { url, opts };
      return {
        status: 200,
        data: {
          success: true,
          data: { rows: [{ code: 'sh601127', hits: 2, tags: [] }], available: 9, total: 9 },
          dataDate: '2026-11-11',
          stale: true,
          updatedAt: '2026-11-12T08:00:00+00:00',
          refreshHours: 4,
        },
      };
    };
    const out = await getCollision(10, '2026-11-10');
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.data.rows.length, 1);
    assert.strictEqual(out.data.dataDate, '2026-11-11');
    assert.strictEqual(out.data.stale, true);
    assert.strictEqual(out.data.updatedAt, '2026-11-12T08:00:00+00:00');
    assert.strictEqual(out.data.refreshHours, 4);
    assert.ok(lastRequest.url.endsWith('/api/v1/quant/collision'));
    assert.deepStrictEqual(lastRequest.opts.params, { days: 10, date: '2026-11-10' });
    assert.strictEqual(lastRequest.opts.headers['X-API-Key'], 'test-key');
  });

  it('401/403 → unauthorized（应提示核对密钥而非地址）', async () => {
    for (const status of [401, 403]) {
      axios.get = async () => ({ status, data: { success: false, error: 'invalid api key' } });
      assert.deepStrictEqual(await getCollision(5), { ok: false, reason: 'unauthorized', status });
    }
  });

  it('5xx / 无响应体 → unreachable', async () => {
    axios.get = async () => ({ status: 502, data: { success: false } });
    assert.strictEqual((await getCollision(5)).reason, 'unreachable');
    axios.get = async () => ({ status: 200, data: null });
    assert.strictEqual((await getCollision(5)).reason, 'unreachable');
  });

  it('服务端无当天快照 → no_data', async () => {
    axios.get = async () => ({
      status: 200,
      data: { success: false, data: null, error: 'no_data', dataDate: '2026-11-11' },
    });
    assert.deepStrictEqual(await getCollision(5), { ok: false, reason: 'no_data', status: 200 });
  });

  it('响应结构异常 → invalid_response', async () => {
    axios.get = async () => ({ status: 200, data: { success: true, data: null } });
    assert.strictEqual((await getCollision(5)).reason, 'invalid_response');
    axios.get = async () => ({ status: 200, data: { success: false, error: 'boom' } });
    assert.strictEqual((await getCollision(5)).reason, 'invalid_response');
  });

  it('网络异常 / 超时 → unreachable 不抛错', async () => {
    axios.get = async () => { throw new Error('ECONNABORTED'); };
    assert.deepStrictEqual(await getCollision(5), { ok: false, reason: 'unreachable' });
  });
});

describe('dataApiClient API Key 入口', () => {
  const config = { baseUrl: 'http://127.0.0.1:8800', apiKey: 'slt0413' };
  const updates = [];
  let originalLoad;

  before(() => {
    originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') {
        return {
          ConfigurationTarget: { Global: 1 },
          workspace: {
            getConfiguration: () => ({
              get: (key) => (key === 'dataApiBaseUrl' ? config.baseUrl : config.apiKey),
              update: (key, value, target) => {
                updates.push({ key, value, target });
                config.apiKey = value;
                return Promise.resolve();
              },
            }),
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  });

  after(() => {
    Module._load = originalLoad;
  });

  beforeEach(() => {
    config.apiKey = 'slt0413';
    updates.length = 0;
  });

  it('maskApiKey 只暴露首尾各 2 位', () => {
    assert.strictEqual(maskApiKey('slt0413'), 'sl***13');
    assert.strictEqual(maskApiKey('abcd'), '****');
    assert.strictEqual(maskApiKey(''), '');
    assert.strictEqual(maskApiKey(null), '');
    assert.strictEqual(maskApiKey(123), '');
  });

  it('getApiKeyState 只回掩码与地址，不含明文', () => {
    const state = getApiKeyState();
    assert.strictEqual(state.configured, true);
    assert.strictEqual(state.masked, 'sl***13');
    assert.strictEqual(state.baseUrl, 'http://127.0.0.1:8800');
    assert.strictEqual(state.weak, true);
    assert.ok(!JSON.stringify(state).includes('slt0413'));
  });

  it('setApiKey 写入用户级全局配置', async () => {
    const result = await setApiKey('  another-key-123456  ');
    assert.deepStrictEqual(result, { ok: true });
    assert.deepStrictEqual(updates, [{
      key: 'dataApiKey', value: 'another-key-123456', target: 1,
    }]);
    assert.strictEqual(getApiKeyState().weak, false);
  });

  it('setApiKey 拒绝非法值且不写配置', async () => {
    for (const bad of ['', '123', 'a b', null, undefined, 'x'.repeat(129)]) {
      const result = await setApiKey(bad);
      assert.strictEqual(result.ok, false, String(bad));
    }
    assert.strictEqual(updates.length, 0);
    assert.strictEqual(config.apiKey, 'slt0413');
  });
});
