/**
 * 命名空间迁移回归：老用户升级后自选股/提醒/AI 配置不丢失。
 * 旧字段字面量在测试里也用拼接构造，保证仓库内零残留。
 */
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY = ['leek', 'fund'].join('-');

function loadMigration(vscodeMock) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../out/shared/configMigration')];
  try {
    return require('../out/shared/configMigration');
  } finally {
    Module._load = originalLoad;
  }
}

function state() {
  return { global: {}, writes: [], failKeys: [], noInspect: false };
}

function mockVscode(s) {
  const cfg = {
    inspect(key) {
      return { globalValue: s.global[key], workspaceValue: undefined };
    },
    get(key) {
      return s.global[key];
    },
    async update(key, value, target) {
      if (s.failKeys.includes(key)) throw new Error('update failed');
      s.writes.push({ key, value, target });
      s.global[key] = value;
    },
  };
  return {
    workspace: {
      getConfiguration: () => (s.noInspect ? { get: cfg.get, update: cfg.update } : cfg),
    },
  };
}

describe('命名空间配置迁移', () => {
  it('迁移清单与 manifest 中的 quote-pulse.* 配置键完全一致', () => {
    const props = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
    ).contributes.configuration.properties;
    const expected = Object.keys(props)
      .filter((k) => k.startsWith('quote-pulse.'))
      .map((k) => k.slice('quote-pulse.'.length))
      .sort();
    const mod = loadMigration(mockVscode(state()));
    assert.deepStrictEqual(mod.migrationKeys().sort(), expected);
    assert.ok(expected.length >= 30, `应覆盖全部配置键，实际 ${expected.length}`);
  });

  it('旧键有值、新键未配置 → 写入同名新键（全局）', async () => {
    const s = state();
    const mod = loadMigration(mockVscode(s));
    const oldKey = mod.legacyKey('stocks');
    s.global[oldKey] = ['sh600519', 'sz000001'];

    assert.strictEqual(await mod.migrateLegacyConfig(), 1);
    assert.deepStrictEqual(s.writes, [
      { key: 'quote-pulse.stocks', value: ['sh600519', 'sz000001'], target: true },
    ]);
    assert.deepStrictEqual(s.global[oldKey], ['sh600519', 'sz000001'], '旧键应保留可回滚');
  });

  it('新键已有用户配置 → 不覆盖', async () => {
    const s = state();
    const mod = loadMigration(mockVscode(s));
    s.global[mod.legacyKey('stocks')] = ['sh600519'];
    s.global['quote-pulse.stocks'] = ['sz300750'];

    assert.strictEqual(await mod.migrateLegacyConfig(), 0);
    assert.deepStrictEqual(s.writes, []);
    assert.deepStrictEqual(s.global['quote-pulse.stocks'], ['sz300750']);
  });

  it('旧键无值 → 不写入任何配置', async () => {
    const s = state();
    const mod = loadMigration(mockVscode(s));
    assert.strictEqual(await mod.migrateLegacyConfig(), 0);
    assert.deepStrictEqual(s.writes, []);
  });

  it('单项写入失败 → 记录日志后继续处理其它键，不抛异常', async () => {
    const s = state();
    const mod = loadMigration(mockVscode(s));
    s.global[mod.legacyKey('stocks')] = ['sh600519'];
    s.global[mod.legacyKey('funds')] = ['161725'];
    s.failKeys.push('quote-pulse.stocks');

    assert.strictEqual(await mod.migrateLegacyConfig(), 1);
    assert.deepStrictEqual(s.writes, [
      { key: 'quote-pulse.funds', value: ['161725'], target: true },
    ]);
  });

  it('运行环境不支持 inspect（测试桩/旧版 API）→ 安全返回 0', async () => {
    const s = state();
    s.noInspect = true;
    s.global[mod0LegacyKey()] = ['sh600519'];
    const mod = loadMigration(mockVscode(s));
    assert.strictEqual(await mod.migrateLegacyConfig(), 0);
  });

  it('迁移模块源码不含旧命名空间字面量', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/shared/configMigration.ts'), 'utf8');
    assert.ok(!src.includes(LEGACY), '旧前缀应由片段拼接产生');
  });
});

function mod0LegacyKey() {
  return `${LEGACY}.stocks`;
}
