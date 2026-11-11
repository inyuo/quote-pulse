/**
 * 量价掘金「策略选股」数据层测试（lqData）。
 *
 * 9 类策略共用 POST /shares.get_lq {tag, days}，现由服务端 qp-data-service
 * 代发；这里用 deps.post 注入验证请求契约与降级，元数据/归一化/碰撞为纯函数。
 */
const assert = require('assert');
const {
  LQ_TAGS,
  LQ_DAYS,
  LQ_COLLISION_DAYS,
  DEFAULT_COLLISION_DAYS,
  toAShareCode,
  normalizeLqGroups,
  fetchLqList,
  collideLqResults,
} = require('../out/shared/lqData');

describe('策略元数据 LQ_TAGS / LQ_DAYS', () => {
  it('9 类策略 tag 与顺序与官网 lq 参数一致', () => {
    assert.deepStrictEqual(
      LQ_TAGS.map((t) => t.tag),
      ['cd', 'qs', 'dwfl', 'szx', 'ztb', 'cx', 'hy', 'jzc', 'fk']
    );
    assert.deepStrictEqual(
      LQ_TAGS.map((t) => t.label),
      ['超跌', '趋势', '低位', '十字星', '涨停', '次新股', '板块', '净增持', '风口']
    );
  });

  it('天数 8 档为官网 dayChoice 的取值', () => {
    assert.deepStrictEqual(
      LQ_DAYS.map((d) => d.num),
      [1, 3, 5, 10, 20, 30, 60, 100]
    );
  });
});

describe('策略载荷归一化 normalizeLqGroups', () => {
  it('两级分组归一为 groups/rows，保留行业与特色标签', () => {
    const result = normalizeLqGroups({
      list: [
        {
          title: '2026-11-04',
          list: [
            { code: '300750', name: '宁德时代', percent: 5.95, desc: '放量突破' },
            { code: '300274', name: '阳光电源', zdf: -1.2, msg: '回踩均线' },
          ],
        },
      ],
      hyTags: ['半导体', '新能源'],
      tsTags: [{ doc: '龙虎榜', url: '/pages/lhb/lhb' }],
    });

    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.groups[0].title, '2026-11-04');
    assert.deepStrictEqual(result.groups[0].rows, [
      { code: 'sz300750', name: '宁德时代', percent: 5.95, note: '放量突破' },
      { code: 'sz300274', name: '阳光电源', percent: -1.2, note: '回踩均线' },
    ]);
    assert.deepStrictEqual(result.hyTags, ['半导体', '新能源']);
    assert.deepStrictEqual(result.tsTags, [{ doc: '龙虎榜', url: '/pages/lhb/lhb' }]);
  });

  it('脏数据容错：分组无 list、行缺 code、非数组标签一律跳过', () => {
    const result = normalizeLqGroups({
      list: [
        { title: '空组' },
        { name: '无标题组', list: [{ name: '缺代码' }, { code: '000001' }] },
        null,
      ],
      hyTags: 'bad',
      tsTags: [null, { doc: '有效' }],
    });

    assert.strictEqual(result.groups.length, 1, '只保留含有效行的分组');
    assert.strictEqual(result.groups[0].title, '无标题组');
    assert.deepStrictEqual(result.groups[0].rows, [
      { code: 'sz000001', name: '', percent: null, note: '' },
    ]);
    assert.deepStrictEqual(result.hyTags, []);
    assert.deepStrictEqual(result.tsTags, [{ doc: '有效', url: '' }]);
  });

  it('空/异常输入返回空结构不抛错', () => {
    for (const bad of [null, undefined, {}, 'bad', { list: 'bad' }]) {
      assert.deepStrictEqual(normalizeLqGroups(bad), {
        groups: [],
        hyTags: [],
        tsTags: [],
      });
    }
  });

  // 缺陷回归：官网 get_lq 行 code 是裸 6 位，资金动态面板只认 sh/sz+6位，
  // 不补前缀则 initialCode 匹配不到下拉项、详情校验失败（表现为「没有选中的股票」）
  it('裸 6 位 code 归一为 sh/sz 前缀（3/0 起→sz，6/5 起→sh）', () => {
    assert.strictEqual(toAShareCode('300750'), 'sz300750');
    assert.strictEqual(toAShareCode('000001'), 'sz000001');
    assert.strictEqual(toAShareCode('600519'), 'sh600519');
    assert.strictEqual(toAShareCode('510300'), 'sh510300');
  });

  it('已带前缀/非 A 股代码原样透传；归一化后 data-code 即可被资金动态识别', () => {
    assert.strictEqual(toAShareCode('sh600519'), 'sh600519');
    assert.strictEqual(toAShareCode('hk00700'), 'hk00700');
    assert.strictEqual(toAShareCode('bad'), 'bad');
    assert.strictEqual(toAShareCode(''), '');
    assert.strictEqual(toAShareCode(undefined), '');

    const result = normalizeLqGroups({
      list: [{ title: 'g', list: [{ code: '600519', name: '贵州茅台' }] }],
    });
    assert.strictEqual(result.groups[0].rows[0].code, 'sh600519');
  });
});

describe('策略榜单拉取 fetchLqList（服务端代发）', () => {
  it('注入 post → 请求 shares.get_lq，body 为 {tag, days}，返回归一化结果', async () => {
    let captured = null;
    const result = await fetchLqList('ztb', 3, {
      post: async (path, body) => {
        captured = { path, body };
        return { list: [{ title: '涨停板', list: [{ code: '000001', name: '平安银行' }] }] };
      },
    });

    assert.deepStrictEqual(captured, { path: 'shares.get_lq', body: { tag: 'ztb', days: 3 } });
    assert.strictEqual(result.groups[0].rows[0].name, '平安银行');
    assert.strictEqual(result.groups[0].rows[0].code, 'sz000001');
  });

  it('非法 tag/days 收敛到默认值，不把脏参数发给服务端', async () => {
    let body = null;
    await fetchLqList('not-a-tag', 999, {
      post: async (path, b) => {
        body = b;
        return { list: [] };
      },
    });
    assert.deepStrictEqual(body, { tag: 'ztb', days: 1 });
  });

  it('服务端不可用 / 代发抛错 → 返回 null 不抛异常', async () => {
    assert.strictEqual(await fetchLqList('cd', 1, { post: async () => null }), null);
    assert.strictEqual(
      await fetchLqList('cd', 1, { post: async () => { throw new Error('boom'); } }),
      null
    );
  });
});

/** 单组 LqResult 构造器：pairs 为 [code, name] 二元组 */
function lqRows(pairs) {
  return {
    groups: [
      {
        title: 'g',
        rows: pairs.map((p) => ({ code: p[0], name: p[1] || '', percent: null, note: '' })),
      },
    ],
    hyTags: [],
    tsTags: [],
  };
}

/** 按 LQ_TAGS 顺序构造 9 项输入；map 中未出现的 tag 视为拉取失败 null */
function lqItems(map) {
  return LQ_TAGS.map((t) => ({
    tag: t.tag,
    result: Object.prototype.hasOwnProperty.call(map, t.tag) ? map[t.tag] : null,
  }));
}

/** 设计示例中的「近5天」9 类策略命中（cx 次新股为空榜） */
function sampleItems() {
  return lqItems({
    cd: lqRows([['sz300750', '宁德时代'], ['sh601127', '赛力斯'], ['sz000001', '平安银行']]),
    qs: lqRows([['sz300750', '宁德时代'], ['sh601127', '赛力斯'], ['sz002594', '比亚迪']]),
    dwfl: lqRows([['sz002594', '比亚迪'], ['sh600036', '招商银行']]),
    szx: lqRows([['sz000001', '平安银行']]),
    ztb: lqRows([['sh601127', '赛力斯'], ['sz300750', '宁德时代']]),
    cx: lqRows([]),
    hy: lqRows([['sz002594', '比亚迪']]),
    jzc: lqRows([['sh600036', '招商银行']]),
    fk: lqRows([['sz300750', '宁德时代'], ['sh601127', '赛力斯']]),
  });
}

describe('数据碰撞 collideLqResults', () => {
  it('碰撞天数为 6 档（去掉近1/近30），默认近5天，且都来自官网 8 档', () => {
    assert.deepStrictEqual(LQ_COLLISION_DAYS.map((d) => d.num), [3, 5, 10, 20, 60, 100]);
    assert.strictEqual(DEFAULT_COLLISION_DAYS, 5);
    assert.ok(LQ_COLLISION_DAYS.every((d) => LQ_DAYS.some((x) => x.num === d.num)));
  });

  it('9 类策略碰撞：只留命中≥2，标签按策略顺序，命中降序/代码升序', () => {
    const r = collideLqResults(sampleItems());
    assert.strictEqual(r.total, 9);
    assert.strictEqual(r.available, 9);
    assert.deepStrictEqual(r.rows, [
      { code: 'sh601127', name: '赛力斯', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
      { code: 'sz300750', name: '宁德时代', hits: 4, tags: ['超跌', '趋势', '涨停', '风口'] },
      { code: 'sz002594', name: '比亚迪', hits: 3, tags: ['趋势', '低位', '板块'] },
      { code: 'sh600036', name: '招商银行', hits: 2, tags: ['低位', '净增持'] },
      { code: 'sz000001', name: '平安银行', hits: 2, tags: ['超跌', '十字星'] },
    ]);
  });

  it('同一策略跨多个分组只算 1 次，裸 6 位与 sh/sz 前缀视为同一只', () => {
    const r = collideLqResults([
      {
        tag: 'cd',
        result: {
          groups: [
            { title: 'a', rows: [{ code: '300750', name: '宁德时代' }] },
            { title: 'b', rows: [{ code: 'sz300750', name: '宁德时代' }] },
          ],
          hyTags: [],
          tsTags: [],
        },
      },
      { tag: 'qs', result: lqRows([['300750', '']]) },
    ]);
    assert.deepStrictEqual(r.rows, [
      { code: 'sz300750', name: '宁德时代', hits: 2, tags: ['超跌', '趋势'] },
    ]);
  });

  it('只命中 1 个策略的股票被过滤，名称取命中行里第一个非空值', () => {
    const r = collideLqResults([
      { tag: 'cd', result: lqRows([['600519', ''], ['000002', '万科A']]) },
      { tag: 'qs', result: lqRows([['sh600519', '贵州茅台']]) },
    ]);
    assert.deepStrictEqual(r.rows, [
      { code: 'sh600519', name: '贵州茅台', hits: 2, tags: ['超跌', '趋势'] },
    ]);
  });

  it('部分策略失败 / 异常结构 / 未知 tag 均容错，available 只数成功项', () => {
    assert.deepStrictEqual(collideLqResults(null), { rows: [], available: 0, total: 0 });
    assert.deepStrictEqual(collideLqResults(undefined), { rows: [], available: 0, total: 0 });

    const dirty = collideLqResults([
      null,
      { tag: 'cd', result: { groups: [{ title: 'g', rows: [null, { code: '' }, {}] }] } },
      { tag: 'qs', result: { groups: 'bad' } },
      { tag: 'ztb', result: null },
    ]);
    assert.deepStrictEqual(dirty, { rows: [], available: 2, total: 4 });

    const partial = collideLqResults([
      { tag: 'cd', result: lqRows([['000001', 'A'], ['000002', 'B']]) },
      { tag: 'qs', result: null },
    ]);
    assert.deepStrictEqual(partial, { rows: [], available: 1, total: 2 });

    const unknown = collideLqResults([
      { tag: 'nope', result: lqRows([['000001', 'X']]) },
      { tag: 'cd', result: lqRows([['000001', 'X']]) },
    ]);
    assert.deepStrictEqual(unknown.rows, [], '未知 tag 不应生成标签');
  });
});
