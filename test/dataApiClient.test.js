const assert = require('assert');
const { normalizeBaseUrl, isEnabled, postLjgx, getPublic } = require('../out/shared/dataApiClient');

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
