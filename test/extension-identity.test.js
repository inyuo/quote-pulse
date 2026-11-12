/**
 * 扩展身份约束：品牌名（name / displayName）可以改，但命令 id 与配置键必须
 * 保持 `quote-pulse.*` 前缀不动，否则老用户的 settings.json、键位绑定与
 * webview 里的 executeCommand 都会失效。纯 Node 运行，不依赖 VS Code API。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const EXPECTED_NAME = 'quote-pulse';
const EXPECTED_DISPLAY_NAME = '行情脉冲 (QuotePulse)';
const EXPECTED_PUBLISHER = 'inyuo';
const EXPECTED_REPO_URL = 'https://github.com/inyuo/quote-pulse';

// 命令 id 的唯一合法前缀
const COMMAND_PREFIX = 'quote-pulse.';
// 配置键前缀白名单：investment-monitor.* 是历史发布期遗留的两条键，同样不可改名
const CONFIG_KEY_PREFIXES = ['quote-pulse.', 'investment-monitor.'];
// 侧边栏 view 的 id 前缀（改名时同样不要动）
const VIEW_PREFIX = 'leekFundView.';

function commandIds() {
  return ((pkg.contributes && pkg.contributes.commands) || []).map(
    (item) => item.command
  );
}

function configKeys() {
  const props =
    (pkg.contributes &&
      pkg.contributes.configuration &&
      pkg.contributes.configuration.properties) ||
    {};
  return Object.keys(props);
}

function viewIds() {
  const views = (pkg.contributes && pkg.contributes.views) || {};
  const ids = [];
  Object.keys(views).forEach((container) => {
    (views[container] || []).forEach((view) => ids.push(view.id));
  });
  return ids;
}

describe('扩展身份：品牌名与 id 兼容性', () => {
  it('扩展 name 为 quote-pulse', () => {
    assert.strictEqual(pkg.name, EXPECTED_NAME);
  });

  it('displayName 为「行情脉冲 (QuotePulse)」', () => {
    assert.strictEqual(pkg.displayName, EXPECTED_DISPLAY_NAME);
  });

  it('publisher 为 inyuo（Marketplace 标识 inyuo.quote-pulse）', () => {
    assert.strictEqual(pkg.publisher, EXPECTED_PUBLISHER);
  });

  it('repository 指向独立仓库 inyuo/quote-pulse', () => {
    assert.strictEqual(
      pkg.repository && pkg.repository.url,
      EXPECTED_REPO_URL,
      'repository.url 需指向新仓库，否则安装页与更新检查会指向旧地址'
    );
  });

  it('contributes.commands 全部命令 id 仍以 quote-pulse. 开头', () => {
    const ids = commandIds();
    assert.ok(ids.length > 0, 'contributes.commands 不应为空');
    const drifted = ids.filter((id) => !String(id).startsWith(COMMAND_PREFIX));
    assert.deepStrictEqual(
      drifted,
      [],
      `以下命令 id 偏离 ${COMMAND_PREFIX} 前缀，会导致老用户键位与命令引用失效：\n  ${drifted.join(
        '\n  '
      )}`
    );
  });

  it('activationEvents 里的 onCommand 仍引用 quote-pulse. 命令', () => {
    const onCommands = (pkg.activationEvents || [])
      .filter((e) => String(e).startsWith('onCommand:'))
      .map((e) => String(e).slice('onCommand:'.length));
    const drifted = onCommands.filter((id) => !id.startsWith(COMMAND_PREFIX));
    assert.deepStrictEqual(
      drifted,
      [],
      `以下 activationEvents.onCommand 偏离 ${COMMAND_PREFIX} 前缀：\n  ${drifted.join(
        '\n  '
      )}`
    );
  });

  it('配置键前缀保持在 quote-pulse./investment-monitor. 白名单内', () => {
    const keys = configKeys();
    assert.ok(keys.length > 0, 'contributes.configuration.properties 不应为空');
    const drifted = keys.filter(
      (key) => !CONFIG_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    assert.deepStrictEqual(
      drifted,
      [],
      `以下配置键前缀不在白名单内，用户已有设置会读不到：\n  ${drifted.join(
        '\n  '
      )}`
    );
  });

  it('侧边栏 view id 仍以 leekFundView. 开头', () => {
    const ids = viewIds();
    assert.ok(ids.length > 0, 'contributes.views 不应为空');
    const drifted = ids.filter((id) => !String(id).startsWith(VIEW_PREFIX));
    assert.deepStrictEqual(
      drifted,
      [],
      `以下 view id 偏离 ${VIEW_PREFIX} 前缀：\n  ${drifted.join('\n  ')}`
    );
  });
});
