/**
 * 个股资金三块表格（官网 add 页「资金动态」tab 的 spData）：
 * POST /analy.get_sp {code} 由服务端代发；服务端不可用 / 失败一律返回 []。
 */
const assert = require('assert');

const tablesModule = require('../out/shared/stockFundTables');

const TABLES = [
  {
    title: '主力分析',
    d1: '分析日',
    d2: '主力成本(占比)',
    d3: '排名',
    d4: '得分',
    list: [
      { d1: '2026-11-04', d2: '53.56(38.74%)', d3: '167(-809)', d4: '77.24', color: '#008000' },
    ],
  },
  {
    title: '主力资金',
    d1: '日期',
    d2: '净流入',
    d3: '累积',
    d4: '资金评分',
    list: [
      { d1: '2026-11-04', d2: '2.24亿', d3: '2.24亿', d4: '0.00', color: '#ff0000' },
      { d1: '2026-11-03', d2: '-2.77亿', d3: '-5373.30万', d4: '0.00', color: '#008000' },
    ],
  },
  {
    title: '明/暗盘',
    d1: '日期',
    d2: '暗盘',
    d3: '明盘',
    d4: '净流入',
    list: [{ d1: '2026-11-04', d2: '3.28亿', d3: '2.23亿', d4: '5.51亿', color: '#ff0000' }],
  },
];

function ok(data) {
  return { status: 200, data: { state: true, error: 'normal', data } };
}

describe('个股资金三块表格 stockFundTables', () => {
  it('服务端不可用时不直连第三方，返回空数组', async () => {
    let called = false;
    const client = {
      post: async () => {
        called = true;
        return ok({ list: TABLES });
      },
    };

    const out = await tablesModule.fetchStockFundTables('sz000977', {
      post: async () => null,
      axios: client,
    });

    assert.deepStrictEqual(out, []);
    assert.strictEqual(called, false, '服务端不可用时不能直连第三方');
  });

  it('服务端代发 analy.get_sp，body 仅带 code 且不携带本地会话', async () => {
    const calls = [];
    const out = await tablesModule.fetchStockFundTables('sz000977', {
      post: async (path, body) => {
        calls.push({ path, body });
        return { list: TABLES };
      },
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].path, 'analy.get_sp');
    assert.deepStrictEqual(calls[0].body, { code: 'sz000977' });
    assert.strictEqual(out.length, 3, '应归一为三块表格');
  });

  it('归一为三块：标题 + 4 列表头 + 带颜色的行', async () => {
    const client = { post: async () => ok({ list: TABLES }) };
    const out = await tablesModule.fetchStockFundTables('sz000977', {
      axios: client,
    });

    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].title, '主力分析');
    assert.deepStrictEqual(out[0].columns, ['分析日', '主力成本(占比)', '排名', '得分']);
    assert.deepStrictEqual(out[0].rows[0].cells, [
      '2026-11-04',
      '53.56(38.74%)',
      '167(-809)',
      '77.24',
    ]);
    assert.strictEqual(out[0].rows[0].color, '#008000');
    assert.strictEqual(out[1].title, '主力资金');
    assert.strictEqual(out[1].rows.length, 2);
    assert.strictEqual(out[2].title, '明/暗盘');
    assert.deepStrictEqual(out[2].columns, ['日期', '暗盘', '明盘', '净流入']);
  });

  it('官网返回 13 块时只保留三块，且顺序固定', async () => {
    const titles = [
      '主力分析',
      '主力资金',
      '明/暗盘',
      '违规记录',
      '分红配送',
      '业绩预告',
      '增减持',
      '高管增减持',
      '计划回购',
      '大宗交易',
      '近期龙虎榜',
      '近期游资榜',
      '名人分析',
    ];
    // 故意倒序，验证输出顺序由白名单决定而非服务端顺序
    const list = titles
      .slice()
      .reverse()
      .map((title) => ({
        title,
        d1: '日期',
        list: [{ d1: '2026-11-04', d2: '2.24亿', color: '#ff0000' }],
      }));
    const client = { post: async () => ok({ list }) };

    const out = await tablesModule.fetchStockFundTables('sz000977', {
      axios: client,
    });

    assert.strictEqual(out.length, 3, '实测官网有 13 块，只应保留用户选中的三块');
    assert.deepStrictEqual(
      out.map((t) => t.title),
      ['主力分析', '主力资金', '明/暗盘'],
      '顺序应固定为用户指定的三块'
    );
  });

  it('明暗标题分隔符变体也能匹配', () => {
    for (const title of ['明/暗盘', '明\\暗盘', '明暗盘']) {
      const out = tablesModule.normalizeFundTables({
        list: [{ title, d1: '日期', list: [{ d1: '11-04', d2: '3.28亿' }] }],
      });
      assert.strictEqual(out.length, 1, `未匹配标题：${title}`);
    }
  });

  it('list 非数组或元素脏数据不影响其它块', async () => {
    assert.deepStrictEqual(tablesModule.normalizeFundTables(null), []);
    assert.deepStrictEqual(tablesModule.normalizeFundTables({ list: 'bad' }), []);

    const client = {
      post: async () =>
        ok({
          list: [
            null,
            { title: '', d1: '日期', list: [] },
            { title: '主力资金', d1: '日期', d2: '净流入', list: [null, { d1: '11-04', d2: '2.24亿' }] },
          ],
        }),
    };
    const out = await tablesModule.fetchStockFundTables('sz000977', {
      axios: client,
    });

    assert.strictEqual(out.length, 1, '无标题或无行数据的块应丢弃');
    assert.strictEqual(out[0].title, '主力资金');
    assert.strictEqual(out[0].rows.length, 1);
    assert.deepStrictEqual(out[0].rows[0].cells, ['11-04', '2.24亿', '', '']);
  });

  it('非法 color 不落到 style，避免注入', async () => {
    const client = {
      post: async () =>
        ok({
          list: [
            {
              title: '主力资金',
              d1: '日期',
              list: [{ d1: '11-04', color: 'red;}</style><script>alert(1)</script>' }],
            },
          ],
        }),
    };
    const out = await tablesModule.fetchStockFundTables('sz000977', {
      axios: client,
    });

    assert.strictEqual(out[0].rows[0].color, '', '危险 color 应被丢弃');
  });

  it('服务端返回空 / 代发抛错 → 空数组且不抛异常', async () => {
    assert.deepStrictEqual(
      await tablesModule.fetchStockFundTables('sz000977', { post: async () => null }),
      []
    );
    assert.deepStrictEqual(
      await tablesModule.fetchStockFundTables('sz000977', {
        post: async () => { throw new Error('boom'); },
      }),
      []
    );
  });

  it('网络异常返回空数组而不是抛错', async () => {
    const client = {
      post: async () => {
        throw new Error('ECONNABORTED');
      },
    };
    const out = await tablesModule.fetchStockFundTables('sz000977', {
      axios: client,
    });
    assert.deepStrictEqual(out, []);
  });

  it('空代码不发请求', async () => {
    let called = false;
    const client = {
      post: async () => {
        called = true;
        return ok({ list: TABLES });
      },
    };
    const out = await tablesModule.fetchStockFundTables('', {
      axios: client,
    });
    assert.deepStrictEqual(out, []);
    assert.strictEqual(called, false);
  });
});

describe('AI 资金表附录 buildStockFundTablesAppendix', () => {
  it('三块表 → 【标题】+表头+行；空/脏输入返回空串', () => {
    const tables = [
      {
        title: '主力分析',
        columns: ['分析日', '主力成本(占比)', '排名', '得分'],
        rows: [{ cells: ['2026-11-04', '53.56(38.74%)', '167', '77.24'], color: '#008000' }],
      },
      {
        title: '主力资金',
        columns: ['日期', '净流入', '累积', '资金评分'],
        rows: [{ cells: ['2026-11-04', '2.24亿', '2.24亿', '0.00'], color: '#ff0000' }],
      },
    ];
    const text = tablesModule.buildStockFundTablesAppendix(tables);
    assert.ok(text.includes('【主力分析】'), text);
    assert.ok(text.includes('分析日 | 主力成本(占比) | 排名 | 得分'), text);
    assert.ok(text.includes('2026-11-04 | 53.56(38.74%) | 167 | 77.24'), text);
    assert.ok(text.includes('【主力资金】'), text);
    assert.ok(text.includes('资金动态表格'), '应标注为资金动态表格');
    assert.strictEqual(tablesModule.buildStockFundTablesAppendix([]), '');
    assert.strictEqual(tablesModule.buildStockFundTablesAppendix(null), '');
  });

  it('无行/无标题的脏块被跳过；全脏返回空串', () => {
    assert.strictEqual(
      tablesModule.buildStockFundTablesAppendix([
        { title: '空块', columns: [], rows: [] },
        { title: '', columns: ['a'], rows: [{ cells: ['x'], color: '' }] },
      ]),
      ''
    );
  });
});
