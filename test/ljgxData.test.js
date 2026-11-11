/**
 * ljgx 数据层测试（2026-11-11 起插件不再扫码登录）。
 *
 * 1) ljgxPostAuth：需登录的接口只走服务端代发；未配置 / 失败一律 null，
 *    历史 deps.axios 注入路径不携带任何本地凭据。
 * 2) fetchShareCjl：price 归一化与失败降级。
 * 3) 免登录接口（北向资金 / 大盘指数）的解析纯函数与 axios 注入。
 *
 * 全部用注入的假客户端，不依赖外网与本地会话存储。
 */
const assert = require('assert');
const ljgx = require('../out/shared/ljgxData');

describe('需登录接口统一走服务端 ljgxPostAuth', () => {
  it('deps.post 注入：path/body 原样透传并返回官网 data.data', async () => {
    let captured = null;
    const payload = { price: [1, 2] };
    const out = await ljgx.ljgxPostAuth('analy.get_sp', { code: 'sz000977' }, {
      post: async (path, body) => {
        captured = { path, body };
        return payload;
      },
    });
    assert.deepStrictEqual(captured, { path: 'analy.get_sp', body: { code: 'sz000977' } });
    assert.strictEqual(out, payload);
  });

  it('服务端代发抛错 → null 不抛异常', async () => {
    const out = await ljgx.ljgxPostAuth('shares.get_lq', { tag: 'ztb' }, {
      post: async () => { throw new Error('boom'); },
    });
    assert.strictEqual(out, null);
  });

  it('未配置服务端且无注入 → null，不发任何请求', async () => {
    assert.strictEqual(await ljgx.ljgxPostAuth('shares.get_lq', { tag: 'ztb', days: 5 }), null);
  });

  it('历史 deps.axios 注入路径不携带任何登录凭据', async () => {
    let captured = null;
    const axios = {
      post: async (url, body, config) => {
        captured = { url, body, config };
        return { status: 200, data: { state: true, error: 'normal', data: { ok: 1 } } };
      },
    };
    const out = await ljgx.ljgxPostAuth('shares.get_lq', { tag: 'ztb' }, { axios });
    assert.deepStrictEqual(out, { ok: 1 });
    assert.ok(captured.url.endsWith('/shares.get_lq'));
    assert.strictEqual(captured.config.headers, undefined, '不应再带 user-token / 会话头');
  });
});

describe('量价分层 fetchShareCjl', () => {
  it('price 过滤 null 与非数字，保留 0，tm 原样', async () => {
    const out = await ljgx.fetchShareCjl(['sh000001'], {
      post: async () => ({ tm: '2026-11-11', price: [0, 10, null, '12', NaN, 20.5] }),
    });
    assert.deepStrictEqual(out, { tm: '2026-11-11', price: [0, 10, 20.5] });
  });

  it('price 非数组 / 服务端不可用 → null', async () => {
    assert.strictEqual(
      await ljgx.fetchShareCjl(['sh000001'], { post: async () => ({ tm: '', price: 'bad' }) }),
      null
    );
    assert.strictEqual(
      await ljgx.fetchShareCjl(['sh000001'], { post: async () => null }),
      null
    );
  });

  it('codes 原样进 body，非数组收敛为空', async () => {
    let body = null;
    await ljgx.fetchShareCjl(null, {
      post: async (path, b) => { body = b; return { price: [] }; },
    });
    assert.deepStrictEqual(body, { codes: [] });
  });
});

describe('北向资金解析 parseNorthFundTrends', () => {
  it('三数组严格对齐，剔除未到样本的 - 占位', () => {
    const out = ljgx.parseNorthFundTrends({
      data: { s2n: ['9:30,5.10,6.20,11.30', '10:56,-,-,-', '11:00,1,2,3'] },
    });
    assert.deepStrictEqual(out.times, ['9:30', '11:00']);
    assert.deepStrictEqual(out.hgtNet, [5.1, 1]);
    assert.deepStrictEqual(out.szgtNet, [6.2, 2]);
  });

  it('s2n 缺失 / 非数组 / 全为占位 → null', () => {
    assert.strictEqual(ljgx.parseNorthFundTrends(null), null);
    assert.strictEqual(ljgx.parseNorthFundTrends({ data: { s2n: 'bad' } }), null);
    assert.strictEqual(ljgx.parseNorthFundTrends({ data: { s2n: ['-,-,-,-'] } }), null);
  });

  it('fetchNorthFundTrends 注入 axios 成功 / HTTP 失败', async () => {
    const ok = await ljgx.fetchNorthFundTrends({
      axios: { get: async () => ({ status: 200, data: { data: { s2n: ['9:30,1,2,3'] } } }) },
    });
    assert.deepStrictEqual(ok.times, ['9:30']);
    assert.strictEqual(
      await ljgx.fetchNorthFundTrends({ axios: { get: async () => ({ status: 503 }) } }),
      null
    );
  });
});

describe('大盘指数解析 parseIndexSpark', () => {
  it('腾讯 minute_set 对象形态：分时字符串取价格段，涨跌幅由昨收推导', () => {
    const out = ljgx.parseIndexSpark({
      data: {
        minute_set: {
          a: { code: 'sh000001', pre: 3600, data: ['0930 3605.39 100', '0931 3610.2 200'] },
        },
      },
    });
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].price, [3605.39, 3610.2]);
    assert.ok(Math.abs(out[0].percent - 0.283) < 0.01, `实际 ${out[0].percent}`);
  });

  it('esllt_list 数组形态：直接取 price 与 percent', () => {
    const out = ljgx.parseIndexSpark({
      data: { esllt_list: [{ name: '上证指数', price: [1, 2], percent: 1.5 }] },
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].name, '上证指数');
    assert.strictEqual(out[0].percent, 1.5);
  });

  it('无有效条目 / 脏载荷 → null', () => {
    assert.strictEqual(ljgx.parseIndexSpark(null), null);
    assert.strictEqual(ljgx.parseIndexSpark({ data: { esllt_list: [{ name: 'X', price: [] }] } }), null);
  });

  it('fetchIndexSpark 注入 axios 成功 / 抛错降级', async () => {
    const ok = await ljgx.fetchIndexSpark({
      axios: {
        get: async () => ({
          status: 200,
          data: { data: { esllt_list: [{ name: 'X', price: [1, 2], percent: 1 }] } },
        }),
      },
    });
    assert.strictEqual(ok.length, 1);
    assert.strictEqual(
      await ljgx.fetchIndexSpark({ axios: { get: async () => { throw new Error('boom'); } } }),
      null
    );
  });
});
