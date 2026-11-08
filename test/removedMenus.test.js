/**
 * 已下线菜单的回归护栏：用户要求删除的 4 组菜单、对应页面与宿主入口
 * 不得再出现在源码和扩展清单里。构建产物由 yarn compile 重新生成后另行核验。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = 'template-packages/leek-center/src';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

describe('已下线菜单与页面', () => {
  it('行情中心「工具 / 我的预警」菜单已移除', () => {
    const header = read(`${SRC}/components/layout/Header.tsx`);
    assert.ok(!header.includes('我的预警'), 'Header 不应再渲染「我的预警」');
    assert.ok(!header.includes('SubMenu'), '仅剩一个子项的「工具」SubMenu 应整体移除');
  });

  it('数据中心 4 组菜单、导入与路由已移除', () => {
    const dc = read(`${SRC}/view/data-center/index.tsx`);
    const labels = [
      '韭研公社个股新闻',
      '欢迎PR',
      '新股数据',
      '新股申购',
      '新股日历',
      '增发',
      '配股',
      'xingu',
      'xingurili',
      'zengfa',
      'peigu',
      'stock-news',
      'other',
    ];
    for (const label of labels) {
      assert.ok(!dc.includes(label), `数据中心不应再包含 ${label}`);
    }
    assert.ok(!read(`${SRC}/router-config.ts`).includes('stock-news'), '顶层路由表不应再注册个股新闻');
    assert.ok(!read(`${SRC}/App.tsx`).includes('/data-center/stock-news'), 'App 不应再为个股新闻隐藏布局');
  });

  it('对应页面文件与个股新闻宿主服务已删除', () => {
    const removed = [
      `${SRC}/view/data-center/other.tsx`,
      `${SRC}/view/data-center/stock-news/index.tsx`,
      `${SRC}/view/data-center/stock-news/style.less`,
      `${SRC}/view/data-center/xingu/index.tsx`,
      `${SRC}/view/data-center/xingu/index.less`,
      `${SRC}/view/data-center/xingurili/index.tsx`,
      `${SRC}/view/data-center/xingurili/index.less`,
      `${SRC}/view/data-center/zengfa/index.tsx`,
      `${SRC}/view/data-center/zengfa/index.less`,
      `${SRC}/view/data-center/peigu/index.tsx`,
      `${SRC}/view/data-center/peigu/index.less`,
      'src/webview/leek-center/stock-news-service.ts',
    ];
    for (const file of removed) {
      assert.strictEqual(exists(file), false, `${file} 应已删除`);
    }
  });

  it('个股新闻命令、欢迎页链接与消息分发已移除', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(
      !pkg.contributes.commands.some((c) => c.command === 'leek-fund.stockNews'),
      '不应再声明 leek-fund.stockNews'
    );
    assert.ok(
      !JSON.stringify(pkg.contributes.viewsWelcome).includes('leek-fund.stockNews'),
      'Stock 视图欢迎内容不应再链接已删除的页面'
    );
    assert.ok(
      !read('src/registerCommand.ts').includes("registerCommand('leek-fund.stockNews'"),
      '不应再注册 leek-fund.stockNews'
    );
    assert.ok(
      !read('src/webview/leekCenterView.ts').includes('getNewsData'),
      '行情中心不应再分发个股新闻取数消息'
    );
    assert.ok(
      !read('src/webview/stock-news-view.ts').includes('/data-center/stock-news'),
      'AI 分析服务不应再渲染个股新闻页面'
    );
  });

  it('新闻快讯菜单、页面与金十快讯链路已移除', () => {
    assert.ok(
      !read(`${SRC}/components/layout/Header.tsx`).includes('新闻快讯'),
      '行情中心顶部不应再有新闻快讯菜单'
    );
    const router = read(`${SRC}/router-config.ts`);
    assert.ok(!router.includes('FlashNewsView') && !router.includes('/news'), '不应再注册 /news 路由');

    const removed = [
      `${SRC}/view/flash-news.tsx`,
      `${SRC}/components/flash-news-list/index.tsx`,
      `${SRC}/components/flash-news-list/jin10-news-item.tsx`,
      `${SRC}/components/flash-news-list/index.less`,
      `${SRC}/constant/news.const.ts`,
      `${SRC}/stores/news.store.ts`,
      'src/webview/leek-center/flash-news-view.ts',
      'src/output/flash-news/FlashNewsDaemon.ts',
      'src/output/flash-news/FlashNewsOutputServer.ts',
      'src/output/flash-news/NewsFlushServiceAbstractClass.ts',
      'src/output/flash-news/impl/Jin10FlushService.ts',
      'resources/light/news.svg',
      'resources/dark/news.svg',
    ];
    for (const file of removed) {
      assert.strictEqual(exists(file), false, `${file} 应已删除`);
    }

    const pkg = JSON.parse(read('package.json'));
    assert.ok(
      !pkg.contributes.commands.some((c) => c.command === 'leek-fund.toggleFlashNews'),
      '不应再声明 toggleFlashNews'
    );
    assert.ok(
      !JSON.stringify(pkg.contributes.menus).includes('leek-fund.toggleFlashNews'),
      '资讯视图菜单不应再引用 toggleFlashNews'
    );
    const props = pkg.contributes.configuration.properties;
    assert.ok(!props['leek-fund.flash-news'], '不应再保留快讯输出开关配置');
    assert.ok(
      !props['investment-monitor.flash-news-important-only'],
      '不应再保留金十重要快讯配置'
    );

    const register = read('src/registerCommand.ts');
    assert.ok(!register.includes('toggleFlashNews'), '不应再注册快讯开关命令');
    assert.ok(!register.includes('flash-news-show'), '不应再注册快讯状态栏命令');
    assert.ok(!register.includes('FlashNewsOutputServer'), '不应再注入 OUTPUT 快讯服务');

    const extension = read('src/extension.ts');
    assert.ok(!extension.includes('FlashNewsDaemon'), '启动流程不应再拉起金十 WebSocket');
    assert.ok(!extension.includes('flashNewsOutputServer'), '不应再初始化快讯 OUTPUT 服务');

    const leekCenter = read('src/webview/leekCenterView.ts');
    assert.ok(!leekCenter.includes('LeekCenterFlashNewsView'), '行情中心不应再注册快讯推送服务');
    assert.ok(!leekCenter.includes('FlashNewsServerInterface'), '不应再引用快讯服务接口');
    assert.ok(leekCenter.includes("case 'pageReady'"), 'pageReady 仍需保留给自选/预警数据初始化');

    assert.ok(!read(`${SRC}/services/background.ts`).includes('postFlashNews'), '前端不应再接收快讯推送');
    assert.ok(!read(`${SRC}/stores/index.ts`).includes('news.store'), '不应再挂载 news store');
  });

  it('资讯侧栏与 AI 分析共享数据源保留（避免误删）', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(
      pkg.contributes.views.leekFundMenu.some((v) => v.id === 'leekFundView.news'),
      '资讯侧栏视图应保留'
    );
    assert.ok(
      pkg.contributes.commands.some((c) => c.command === 'leek-fund.refreshFollow'),
      '刷新资讯命令应保留'
    );
    assert.ok(exists('src/explorer/xxjwxcNews.ts'), 'AI 分析共用的资讯数据层应保留');
    assert.ok(exists('src/webview/stock-news-view.ts'), 'AI 分析服务应保留');
  });
});
