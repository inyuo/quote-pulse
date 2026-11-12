import { commands, env, ExtensionContext, window, Uri, workspace } from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { showAiAnalysisPanel } from './utils/aiAnalysisPanel';

/**
 * 获取设置文件的默认路径
 * 优先选择当前工作区目录，如果没有工作区则选择下载目录
 */
function getDefaultSettingsPath(filename: string = 'quote-pulse.settings.json'): string {
  const workspaceFolders = workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    // 使用当前工作区目录
    return path.join(workspaceFolders[0].uri.fsPath, filename);
  } else {
    // 使用下载目录作为备选
    return path.join(os.homedir(), 'Downloads', filename);
  }
}
// import fundSuggestList from './data/fundSuggestData';
import fundCodeList from './data/fundcodeSearch';
import { BinanceProvider } from './explorer/binanceProvider';
import BinanceService from './explorer/binanceService';
import { ForexProvider } from './explorer/forexProvider';
import { FundProvider } from './explorer/fundProvider';
import FundService from './explorer/fundService';
import { NewsProvider } from './explorer/newsProvider';
import { resolveNewsSourceUrl } from './explorer/xxjwxcNews';
import { StockProvider } from './explorer/stockProvider';
import StockService from './explorer/stockService';
import globalState from './globalState';
import { LeekFundConfig } from './shared/leekConfig';
import { LeekTreeItem } from './shared/leekTreeItem';
// import checkForUpdate from './shared/update';
import { colorOptionList, randomColor } from './shared/utils';
import allFundTrend from './webview/allFundTrend';
import fundFlow, { mainFundFlow } from './webview/fundFlow';
import fundHistory from './webview/fundHistory';
import fundPosition from './webview/fundPosition';
import fundRank from './webview/fundRank';
import fundTrend from './webview/fundTrend';
import leekCenterView from './webview/leekCenterView';
import setAmount from './webview/setAmount';
import setStockPrice from './webview/setStockPrice';

import stockTrend from './webview/stockTrend';
import stockTrendPic from './webview/stockTrendPic';
import stockWindVane from './webview/stockWindVane';
import { StatusBar } from './statusbar/statusBar';
import binanceTrend from './webview/binanceTrend';
import { AiConfigView } from './webview/ai-config';

export function registerViewEvent(
  context: ExtensionContext,
  fundService: FundService,
  stockService: StockService,
  fundProvider: FundProvider,
  stockProvider: StockProvider,
  newsProvider: NewsProvider,
  binanceProvider: BinanceProvider,
  forexProvider: ForexProvider
) {
  const binanceService = new BinanceService(context);

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.refreshFollow', async () => {
      // force：清缓存重新拉取，否则重绘时会命中 TTL 缓存导致"刷新不变"
      await newsProvider.refresh(true);
      window.showInformationMessage(`刷新成功`);
    })
  );

  // Fund operation
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.refreshFund', () => {
      globalState.fundGroups = LeekFundConfig.getConfig('quote-pulse.fundGroups', []);
      globalState.fundLists = LeekFundConfig.getConfig('quote-pulse.funds', []);
      fundProvider.refresh();
      const handler = window.setStatusBarMessage(`基金数据已刷新`);
      setTimeout(() => {
        handler.dispose();
      }, 1000);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.deleteFund', (target) => {
      LeekFundConfig.removeFundCfg(target.id, () => {
        fundService.fundList = [];
        fundProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.addFund', (target) => {
      /* if (!service.fundSuggestList.length) {
        service.getFundSuggestList();
        window.showInformationMessage(`获取基金数据中，请稍后再试`);
        return;
      } */

      window.showQuickPick(fundCodeList, { placeHolder: '请输入基金代码' }).then((code) => {
      // window.showQuickPick(fundSuggestList, { placeHolder: '请输入基金代码' }).then((code) => {
        if (!code) {
          return;
        }
        LeekFundConfig.addFundCfg(target.id, code.split('|')[0], () => {
          fundProvider.refresh();
        });
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.addFundGroup', () => {
      window.showInputBox({ placeHolder: '请输入基金分组名称' }).then((name) => {
        if (!name) {
          return;
        }
        LeekFundConfig.addFundGroupCfg(name, () => {
          fundProvider.refresh();
        });
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.removeFundGroup', (target) => {
      LeekFundConfig.removeFundGroupCfg(target.id, () => {
        fundService.fundList = [];
        fundProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.renameFundGroup', (target) => {
      window.showInputBox({ placeHolder: '请输入基金分组名称' }).then((name) => {
        if (!name) {
          return;
        }
        LeekFundConfig.renameFundGroupCfg(target.id, name, () => {
          fundProvider.refresh();
        });
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.sortFund', () => {
      fundProvider.changeOrder();
      fundProvider.refresh();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.sortAmountFund', () => {
      fundProvider.changeAmountOrder();
      fundProvider.refresh();
    })
  );

  // Stock operation
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.refreshStock', () => {
      stockProvider.refresh();
      const handler = window.setStatusBarMessage(`股票数据已刷新`);
      setTimeout(() => {
        handler.dispose();
      }, 1000);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.deleteStock', (target) => {
      LeekFundConfig.removeStockCfg(target.id, () => {
        stockProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.addStockToBar', (target) => {
      LeekFundConfig.addStockToBarCfg(target.id, () => {
        stockProvider.refresh();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.leekCenterView', () => {
      if (stockService.stockList.length === 0 && fundService.fundList.length === 0) {
        window.showWarningMessage('数据刷新中，请稍候！');
        return;
      }
      leekCenterView(stockService, fundService);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.addStock', () => {
      // vscode QuickPick 不支持动态查询，只能用此方式解决
      // https://github.com/microsoft/vscode/issues/23633
      const qp = window.createQuickPick();
      qp.items = [{ label: '请输入关键词查询，如：0000001 或 上证指数' }];
      let code: string | undefined;
      let timer: NodeJS.Timeout | null = null;
      qp.onDidChangeValue((value) => {
        qp.busy = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        timer = setTimeout(async () => {
          const res = await stockService.getStockSuggestList(value);
          qp.items = res;
          qp.busy = false;
        }, 100); // 简单防抖
      });
      qp.onDidChangeSelection((e) => {
        if (e[0].description) {
          code = e[0].label && e[0].label.split(' | ')[0];
        }
      });
      qp.show();
      qp.onDidAccept(() => {
        if (!code) {
          return;
        }
        // 存储到配置的时候是接口的参数格式，接口请求时不需要再转换
        const newCode = code.replace('gb', 'gb_').replace('us', 'usr_');
        LeekFundConfig.updateStockCfg(newCode, () => {
          stockProvider.refresh();
        });
        qp.hide();
        qp.dispose();
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.sortStock', () => {
      stockProvider.changeOrder();
      stockProvider.refresh();
    })
  );

  /**
   * WebView
   */
  // 股票点击
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.stockItemClick', (code, name, text, stockCode) =>
      stockTrend(code, name, stockCode)
    )
  );
  // 基金点击
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.fundItemClick', (code, name) => fundTrend(code, name))
  );
  // 基金右键历史信息点击
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewFundHistory', (item) => fundHistory(item))
  );
  // 基金持仓
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewFundPosition', (item) => fundPosition(item))
  );
  // 基金排行
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewFundRank', () => fundRank())
  );
  // 基金走势图
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewFundTrend', () => allFundTrend(fundService))
  );
  // 资金流向
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewFundFlow', () => fundFlow())
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewMainFundFlow', () => mainFundFlow())
  );
  // 资金动态（个股资金三块表格 / 分时资金流 / 行业资金流）
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.viewStockFundFlow', () => {
      const { stockFundFlow } = require('./webview/stockFundFlow');
      // 三块表格的 analy.get_sp 由服务端代发，无需本地会话
      stockFundFlow();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.stockFundFlowForStock', (target) => {
      const { stockFundFlow } = require('./webview/stockFundFlow');
      const code = (target && (target.id || (target.info && target.info.code))) || '';
      stockFundFlow(typeof code === 'string' ? code : '');
    })
  );
  // 基金置顶
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setFundTop', (target) => {
      LeekFundConfig.setFundTopCfg(target.id, () => {
        fundProvider.refresh();
      });
    })
  );
  // 股票置顶
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setStockTop', (target) => {
      LeekFundConfig.setStockTopCfg(target.id, () => {
        fundProvider.refresh();
      });
    })
  );
  // 股票上移
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setStockUp', (target) => {
      LeekFundConfig.setStockUpCfg(target.id, () => {
        fundProvider.refresh();
      });
    })
  );
  // 股票下移
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setStockDown', (target) => {
      LeekFundConfig.setStockDownCfg(target.id, () => {
        fundProvider.refresh();
      });
    })
  );
  // AI分析股票
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.aiStockAnalysis', async (target) => {
      const { StockNewsView } = require('./webview/stock-news-view');
      const stockNewsView = StockNewsView.getInstance();
      // 资金表格与资讯源均由服务端代发，无需注入本地会话
      const result = await stockNewsView.send_ai_stock_analysis(target);
      if (result !== '') {
        // 控制台输出 - 限制长度避免控制台截断
        // const consoleResult = result.length > 2000 ? result.substring(0, 2000) + '...（内容过长，完整结果请查看OUTPUT面板或Webview）' : result;
        // console.log('AI 分析结果 -', target?.info?.name, ' 股票代码：', target?.info?.code, '\n', consoleResult);

        // 输出到 OUTPUT 面板
        const channel = window.createOutputChannel('LeekFund AI 分析');
        channel.appendLine(`==== AI 分析（${target.info.name} | ${target.info.code}）====`);
        channel.appendLine(result);
        channel.appendLine('');
        channel.show(true);

        // 使用 Webview 面板展示，限制可视高度并可滚动
        showAiAnalysisPanel(context, target.info.name, result);
      }
    })
  );

  // 设置基金持仓金额
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setFundAmount', () => {
      if (fundService.fundList.length === 0) {
        window.showWarningMessage('数据刷新中，请重试！');
        return;
      }
      setAmount(fundService);
    })
  );
  // 设置股票成本价
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setStockPrice', () => {
      if (stockService.stockList.length === 0) {
        window.showWarningMessage('数据刷新中，请重试！');
        return;
      }
      setStockPrice(stockService);
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.stockTrendPic', (target) => {
      const { code, name, type, symbol } = target.info;
      stockTrendPic(code, name, `${type}${symbol}`);
    })
  );

  /**
   * News command
   */
  // 资讯条目：登录后按来源打开对应官网子页；降级/未分组条目沿用自身 url
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.newItemClick', (news) => {
      if (!news) return;
      const url = news.source ? resolveNewsSourceUrl(news.source) : news.url;
      if (url) {
        env.openExternal(Uri.parse(url));
      }
    })
  );

  /**
   * Binance command
   */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.refreshBinance', () => {
      binanceProvider?.refresh();
    })
  );

  /* 添加交易对 */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.addBinancePair', async () => {
      const pairsList = await binanceService.getParis();
      window.showQuickPick(pairsList, { placeHolder: '请输入交易对' }).then((pair) => {
        if (!pair) return;
        LeekFundConfig.updateBinanceCfg(pair, () => binanceProvider?.refresh());
      });
    })
  );

  /* 删除交易对 */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.deletePair', (target) => {
      LeekFundConfig.removeBinanceCfg(target.id, () => {
        binanceProvider?.refresh();
      });
    })
  );

  /* 交易对置顶 */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setPairTop', (target) => {
      LeekFundConfig.setBinanceTopCfg(target.id, () => {
        binanceProvider?.refresh();
      });
    })
  );

  /* 排序 */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.binanceSort', () => {
      binanceProvider.changeOrder();
    })
  );

  /* 点击交易对 */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.binanceItemClick', (code, name) => binanceTrend(name))
  );

  /**
   * Forex command
   */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.refreshForex', () => {
      forexProvider.refresh();
    })
  );

  /**
   * Settings command
   */
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.hideText', () => {
      fundService.toggleLabel();
      stockService.toggleLabel();
      fundProvider.refresh();
      stockProvider.refresh();
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setStockStatusBar', () => {
      const stockList = stockService.stockList;
      const stockNameList = stockList.map((item: LeekTreeItem) => {
        return {
          label: `${item.info.name}`,
          description: `${item.info.code}`,
        };
      });
      window
        .showQuickPick(stockNameList, {
          placeHolder: '输入过滤选择，支持多选（限6个）',
          canPickMany: true,
        })
        .then((res) => {
          if (!res) {
            res = [];
          }
          let codes = res.map((item) => item.description);
          if (codes.length > 6) {
            codes = codes.slice(0, 6);
          }
          LeekFundConfig.updateStatusBarStockCfg(codes, () => {
            const handler = window.setStatusBarMessage(`下次数据刷新见效`);
            setTimeout(() => {
              handler.dispose();
            }, 1500);
          });
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.customSetting', () => {
      const colorList = colorOptionList();

      window
        .showQuickPick(
          [
            { label: '📌 状态栏股票设置', description: 'statusbar-stock' },
            {
              label: `🟦 状态栏显示或隐藏 ${
                process.platform === 'darwin' ? '(Cmd+Opt+T)' : '(Ctrl+Alt+T)'
              }`,
              description: 'toggle-status-bar',
            },
            { label: '🟩 基金状态栏显示或隐藏', description: 'toggle-fund-bar' },
            { label: '🟥 股票状态栏显示或隐藏', description: 'toggle-stock-bar' },
            {
              label: '🧩 状态栏图标显示或隐藏',
              description: 'toggle-status-bar-icon',
            },
            { label: '📈 状态栏股票涨时文字颜色', description: 'statusbar-rise' },
            { label: '📉 状态栏股票跌时文字颜色', description: 'statusbar-fall' },
            { label: '🍖 涨跌图标更换', description: 'icontype' },
            { label: '👀 显示/隐藏文本', description: 'hideText' },
            {
              label: globalState.showEarnings ? '隐藏盈亏' : '💰 显示盈亏',
              description: 'earnings',
            },
            {
              label: globalState.remindSwitch ? '⏱️ 关闭提醒' : '⏰ 打开提醒',
              description: 'remindSwitch',
            },
            {
              label: globalState.kLineChartSwitch ? '🔛 切换为常规k线图' : '📴 切换为筹码分布K线图',
              description: 'kLineChartSwitch',
            },
            {
              label: globalState.stockHeldTipShow ? '关闭持仓高亮' : '开启持仓高亮',
              description: 'stockHeldTipShow',
            },
            {
              label: '📤 导出设置',
              description: 'exportSettings',
            },
            {
              label: '📥 导入设置',
              description: 'importSettings',
            },
          ],
          {
            placeHolder: '第一步：选择设置项',
          }
        )
        .then((item: any) => {
          if (!item) {
            return;
          }
          const type = item.description;
          // 状态栏颜色设置
          if (type === 'statusbar-rise' || type === 'statusbar-fall') {
            window
              .showQuickPick(colorList, {
                placeHolder: `第二步：设置颜色（${item.label}）`,
              })
              .then((colorItem: any) => {
                if (!colorItem) {
                  return;
                }
                let color = colorItem.description;
                if (color === 'random') {
                  color = randomColor();
                }
                LeekFundConfig.setConfig(
                  type === 'statusbar-rise' ? 'quote-pulse.riseColor' : 'quote-pulse.fallColor',
                  color
                );
              });
          } else if (type === 'statusbar-stock') {
            // 状态栏股票设置
            commands.executeCommand('quote-pulse.setStockStatusBar');
          } else if (type === 'toggle-status-bar') {
            commands.executeCommand('quote-pulse.toggleStatusBarVisibility');
          } else if (type === 'toggle-fund-bar') {
            commands.executeCommand('quote-pulse.toggleFundBarVisibility');
          } else if (type === 'toggle-stock-bar') {
            commands.executeCommand('quote-pulse.toggleStockBarVisibility');
          } else if (type === 'toggle-status-bar-icon') {
            commands.executeCommand('quote-pulse.toggleStatusBarIconVisibility');
          } else if (type === 'icontype') {
            // 基金&股票涨跌图标
            window
              .showQuickPick(
                [
                  {
                    label: '箭头图标（红涨绿跌）',
                    description: 'arrow',
                  },
                  {
                    label: '箭头图标（绿涨红跌）',
                    description: 'arrow1',
                  },
                  {
                    label: '食物图标1（吃面、吃鸡腿）',
                    description: 'food1',
                  },
                  {
                    label: '食物图标2（烤韭菜、烤肉）',
                    description: 'food2',
                  },
                  {
                    label: '食物图标3（吃面、喝酒）',
                    description: 'food3',
                  },
                  {
                    label: '食物字体图标（吃面、吃鸡腿）',
                    description: 'iconfood',
                  },
                  {
                    label: '无图标',
                    description: 'none',
                  },
                ],
                {
                  placeHolder: `第二步：选择基金&股票涨跌图标`,
                }
              )
              .then((iconItem: any) => {
                if (!iconItem) {
                  return;
                }
                if (globalState.iconType !== iconItem.description) {
                  LeekFundConfig.setConfig('quote-pulse.iconType', iconItem.description);
                  globalState.iconType = iconItem.description;
                }
              });
          } else if (type === 'earnings') {
            const newValue = globalState.showEarnings === 1 ? 0 : 1;
            LeekFundConfig.setConfig('quote-pulse.showEarnings', newValue);
            globalState.showEarnings = newValue;
          } else if (type === 'hideText') {
            commands.executeCommand('quote-pulse.hideText');
          } else if (type === 'remindSwitch') {
            commands.executeCommand('quote-pulse.toggleRemindSwitch');
          } else if (type === 'kLineChartSwitch') {
            commands.executeCommand('quote-pulse.toggleKLineChartSwitch');
          } else if (type === 'stockHeldTipShow') {
            commands.executeCommand('quote-pulse.toggleStockHeldTipShow');
          } else if (type === 'exportSettings') {
            commands.executeCommand('quote-pulse.exportSettings');
          } else if (type === 'importSettings') {
            commands.executeCommand('quote-pulse.importSettings');
          }
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.openConfigPage', () => {
      commands.executeCommand('workbench.action.openSettings', '@ext:inyuo.quote-pulse');
    })
  );

  // 选股风向标
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.stockWindVane', () => stockWindVane())
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleRemindSwitch', (on?: number) => {
      const newValue = on !== undefined ? (on ? 1 : 0) : globalState.remindSwitch === 1 ? 0 : 1;
      LeekFundConfig.setConfig('quote-pulse.stockRemindSwitch', newValue);
      globalState.remindSwitch = newValue;
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleKLineChartSwitch', (on?: number) => {
      const newValue = on !== undefined ? (on ? 1 : 0) : globalState.kLineChartSwitch === 1 ? 0 : 1;
      LeekFundConfig.setConfig('quote-pulse.stockKLineChartSwitch', newValue);
      globalState.kLineChartSwitch = newValue;
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleStockHeldTipShow', () => {
      const newValue = !globalState.stockHeldTipShow;
      LeekFundConfig.setConfig('quote-pulse.stockHeldTipShow', newValue);
      globalState.stockHeldTipShow = newValue;
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.changeStatusBarItem', (stockId) => {
      const stockList = stockService.stockList;
      const stockNameList = stockList
        .filter((stock) => stock.id !== stockId)
        .map((item: LeekTreeItem) => {
          return {
            label: `${item.info.name}`,
            description: `${item.info.code}`,
          };
        });
      stockNameList.unshift({
        label: `删除`,
        description: `-1`,
      });
      window
        .showQuickPick(stockNameList, {
          placeHolder: '更换状态栏个股',
        })
        .then((res) => {
          if (!res) return;
          const statusBarStocks = LeekFundConfig.getConfig('quote-pulse.statusBarStock');
          const newCfg = [...statusBarStocks];
          const newStockId = res.description;
          const index = newCfg.indexOf(stockId);
          if (newStockId === '-1') {
            if (index > -1) {
              newCfg.splice(index, 1);
            }
          } else {
            if (statusBarStocks.includes(newStockId)) {
              window.showWarningMessage(`「${res.label}」已在状态栏`);
              return;
            }
            if (index > -1) {
              newCfg[index] = res.description;
            }
          }
          LeekFundConfig.updateStatusBarStockCfg(newCfg, () => {
            const handler = window.setStatusBarMessage(`下次数据刷新见效`);
            setTimeout(() => {
              handler.dispose();
            }, 1500);
          });
        });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.immersiveBackground', (isChecked: boolean) => {
      LeekFundConfig.setConfig('quote-pulse.immersiveBackground', isChecked);
      globalState.immersiveBackground = isChecked;
    })
  );

  // Settings Import/Export Commands
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.exportSettings', async () => {
      try {
        const workspaceConfig = workspace.getConfiguration();
        const allSettings: any = {};

        // Get all quote-pulse settings dynamically from extension context
        const extensionManifest = globalState.context.extension.packageJSON;
        const configurationProperties =
          extensionManifest.contributes?.configuration?.properties || {};

        // Filter to only quote-pulse configuration keys
        const leekFundConfigKeys = Object.keys(configurationProperties).filter((key) =>
          key.startsWith('quote-pulse.')
        );

        // Get all quote-pulse settings that have actual values
        leekFundConfigKeys.forEach((key) => {
          const value = workspaceConfig.get(key);
          if (value !== undefined) {
            allSettings[key] = value;
          }
        });

        // Additional inspection method as fallback to catch any dynamically created settings
        const leekFundInspection = workspaceConfig.inspect('quote-pulse');
        const inspectionSources = [
          leekFundInspection?.globalValue,
          leekFundInspection?.workspaceValue,
          leekFundInspection?.workspaceFolderValue,
        ];

        inspectionSources.forEach((source) => {
          if (source && typeof source === 'object') {
            Object.keys(source).forEach((key) => {
              const fullKey = `quote-pulse.${key}`;
              if (!allSettings[fullKey]) {
                const value = workspaceConfig.get(fullKey);
                if (value !== undefined) {
                  allSettings[fullKey] = value;
                }
              }
            });
          }
        });

        if (Object.keys(allSettings).length === 0) {
          window.showInformationMessage('没有找到任何以 "quote-pulse." 开头的设置');
          return;
        }

        // Show save dialog
        const uri = await window.showSaveDialog({
          defaultUri: Uri.file(getDefaultSettingsPath()),
          filters: {
            'JSON files': ['json'],
            'All files': ['*'],
          },
        });

        if (uri) {
          const settingsJson = JSON.stringify(allSettings, null, 2);
          await workspace.fs.writeFile(uri, Buffer.from(settingsJson));
          window.showInformationMessage(`设置已导出到: ${uri.fsPath}`);
        }
      } catch (error) {
        window.showErrorMessage(`导出设置失败: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand('quote-pulse.importSettings', async () => {
      try {
        // Show open dialog
        const uris = await window.showOpenDialog({
          defaultUri: Uri.file(getDefaultSettingsPath()),
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            'JSON files': ['json'],
            'All files': ['*'],
          },
        });

        if (!uris || uris.length === 0) {
          return;
        }

        const uri = uris[0];
        const content = await workspace.fs.readFile(uri);
        const settingsText = Buffer.from(content).toString('utf8');

        let importedSettings: any;
        try {
          importedSettings = JSON.parse(settingsText);
        } catch (parseError) {
          window.showErrorMessage('无法解析 JSON 文件，请检查文件格式');
          return;
        }

        // Filter settings that start with 'quote-pulse.'
        const leekFundSettings: any = {};
        Object.keys(importedSettings).forEach((key) => {
          if (key.startsWith('quote-pulse.')) {
            leekFundSettings[key] = importedSettings[key];
          }
        });

        if (Object.keys(leekFundSettings).length === 0) {
          window.showInformationMessage('文件中没有找到任何以 "quote-pulse." 开头的设置');
          return;
        }

        // Confirm import
        const result = await window.showInformationMessage(
          `将导入 ${Object.keys(leekFundSettings).length} 个设置项，这将覆盖现有的设置。是否继续？`,
          '确认导入',
          '取消'
        );

        if (result !== '确认导入') {
          return;
        }

        // Import settings
        const workspaceConfig = workspace.getConfiguration();
        let successCount = 0;
        let failCount = 0;

        for (const [key, value] of Object.entries(leekFundSettings)) {
          try {
            await workspaceConfig.update(key, value, true);
            successCount++;
          } catch (error) {
            console.error(`Failed to import setting ${key}:`, error);
            failCount++;
          }
        }

        if (successCount > 0) {
          window.showInformationMessage(
            `设置导入完成：成功 ${successCount} 项${failCount > 0 ? `，失败 ${failCount} 项` : ''}`
          );

          // Refresh the extension state
          commands.executeCommand('quote-pulse.refreshFund');
          commands.executeCommand('quote-pulse.refreshStock');
        } else {
          window.showErrorMessage('导入设置失败');
        }
      } catch (error) {
        window.showErrorMessage(`导入设置失败: ${error}`);
      }
    })
  );


  // 设置个股 AI 分析历史长度（A 股 / 港股均生效）
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.setAiStockHistoryRange', async () => {
      const QuickPickItems = [
        { label: '1年', description: '1y', picked: false },
        { label: '6个月', description: '6m', picked: false },
        { label: '3个月', description: '3m', picked: false },
        { label: '1个月', description: '1m', picked: false },
        { label: '1周', description: '1w', picked: false },
      ];
      const current = LeekFundConfig.getConfig('quote-pulse.aiStockHistoryRange', '3m');
      QuickPickItems.forEach(it => it.picked = it.description === current);
      const sel = await window.showQuickPick(QuickPickItems, {
        placeHolder: '选择个股 AI 分析所用的前复权日线历史长度',
      });
      if (sel && sel.description) {
        await LeekFundConfig.setConfig('quote-pulse.aiStockHistoryRange', sel.description);
        window.showInformationMessage(`已设置个股 AI 分析近 ${sel.label} 前复权日线数据`);
      }
    })
  );
  // AI 配置管理
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.openAiConfig', () => {
      AiConfigView.getInstance().show();
    })
  );
  // checkForUpdate();
}

/**
 * 量化面板命令注册：入口在 Settings 分栏的 viewsWelcome 链接。
 * 面板 4 个 tab：cjl 量价分层 / north 北向资金 / index 大盘指数 / collision 数据碰撞。
 * 需登录的数据由服务端代发，插件不再扫码登录。
 */
export function registerQuant(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.quantOpen', (target) => {
      const { quantPanel } = require('./webview/quantPanel');
      const VALID_TABS = ['cjl', 'north', 'index', 'collision'];
      const tab = target && VALID_TABS.indexOf(target.tab) !== -1 ? target.tab : 'north';
      // code 可选：tab==='cjl' 时替代默认指数集合
      const code = target && typeof target.code === 'string' ? target.code : undefined;
      quantPanel(tab, code);
    })
  );
}

export function registerCommandPaletteEvent(context: ExtensionContext, statusbar: StatusBar) {
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleStatusBarIconVisibility', () => {
      statusbar.toggleStatusBarIconVisibility();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleStatusBarVisibility', () => {
      statusbar.toggleVisibility();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleFundBarVisibility', () => {
      statusbar.toggleFundBarVisibility();
    })
  );
  context.subscriptions.push(
    commands.registerCommand('quote-pulse.toggleStockBarVisibility', () => {
      statusbar.toggleStockBarVisibility();
    })
  );
}
