/**
 * 期货模块整体移除的约束检查。
 *
 * 期货（国内交易所 nf_、海外 hf_）属于独立数据通路，已整体下线：
 * 分类、树节点、行情解析、搜索、配置项、计数都不应再出现。
 * 老用户 leek-fund.stocks 里遗留的期货代码由 LEGACY_FUTURE_RE 静默过滤，
 * 不能退化成「接口不支持该股票」的报错节点。
 *
 * 纯 Node 运行，不依赖 VS Code API：yarn test:unit
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

function configKeys() {
  const props =
    (pkg.contributes &&
      pkg.contributes.configuration &&
      pkg.contributes.configuration.properties) ||
    {};
  return Object.keys(props);
}

describe('期货模块已整体移除', () => {
  it('StockCategory 不再包含国内/海外期货分类', () => {
    const src = read('src/shared/typed.ts');
    const enumBody = src.slice(src.indexOf('enum StockCategory'));
    assert.ok(
      !/Future/.test(enumBody.slice(0, 200)),
      'StockCategory 里仍残留 Future / OverseaFuture 枚举'
    );
  });

  it('package.json 不再提供期货展开配置项', () => {
    const drifted = configKeys().filter((key) => /future/i.test(key));
    assert.deepStrictEqual(
      drifted,
      [],
      `以下期货配置项应删除：\n  ${drifted.join('\n  ')}`
    );
  });

  it('stockProvider 不再构建期货分类与子节点', () => {
    const src = read('src/explorer/stockProvider.ts');
    assert.deepStrictEqual(
      src.match(/Future|期货/g) || [],
      [],
      'stockProvider 里仍有期货分类相关代码'
    );
  });

  it('globalState 不再维护期货数量计数', () => {
    const src = read('src/globalState.ts');
    assert.ok(!/cnfStockCount|hfStockCount/.test(src), 'globalState 仍残留期货计数');
  });

  it('stockService 不再解析 nf_/hf_ 行情，也不再有期货搜索', () => {
    const src = read('src/explorer/stockService.ts');
    const leftovers = [
      'cnfStockCount',
      'hfStockCount',
      'stockIndexFuture',
      'futureUrl',
      '期货',
    ].filter((token) => src.includes(token));
    assert.deepStrictEqual(
      leftovers,
      [],
      `stockService 仍残留期货逻辑：${leftovers.join(', ')}`
    );
  });

  it('老配置里的期货代码被静默过滤，不产生「接口不支持」节点', () => {
    const src = read('src/explorer/stockService.ts');
    assert.ok(
      /LEGACY_FUTURE_RE/.test(src),
      'stockService 缺少 LEGACY_FUTURE_RE，老用户遗留的期货代码会显示为接口不支持'
    );
  });

  it('状态栏与树视图相关源码不再提及期货', () => {
    const files = [
      'src/shared/leekTreeItem.ts',
      'src/shared/utils.ts',
      'src/webview/stockTrend.ts',
      'src/shared/leekConfig.ts',
    ];
    const offenders = files.filter((rel) => /期货|Future/.test(read(rel)));
    assert.deepStrictEqual(
      offenders,
      [],
      `以下文件仍残留期货逻辑：\n  ${offenders.join('\n  ')}`
    );
  });
});
