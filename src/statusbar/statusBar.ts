import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import FundService from '../explorer/fundService';
import StockService from '../explorer/stockService';
import globalState from '../globalState';
import { DEFAULT_LABEL_FORMAT } from '../shared/constant';
import { LeekFundConfig } from '../shared/leekConfig';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { events, formatLabelString } from '../shared/utils';

export class StatusBar {
  private stockService: StockService;
  private fundService: FundService;
  private fundBarItem: StatusBarItem;
  private statusBarList: StatusBarItem[] = [];
  private statusBarItemLabelFormat: string = '';
  constructor(stockService: StockService, fundService: FundService) {
    this.stockService = stockService;
    this.fundService = fundService;
    this.statusBarList = [];
    this.fundBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
    this.refreshStockStatusBar();
    this.bindEvents();
    /* events.on('updateConfig:quote-pulse.statusBarStock',()=>{

    }) */
  }

  get riseColor(): string {
    return LeekFundConfig.getConfig('quote-pulse.riseColor');
  }

  get fallColor(): string {
    return LeekFundConfig.getConfig('quote-pulse.fallColor');
  }

  /** 隐藏股市状态栏 */
  get hideStatusBarStock(): boolean {
    return LeekFundConfig.getConfig('quote-pulse.hideStatusBarStock');
  }

  /** 隐藏状态栏 */
  get hideStatusBar(): boolean {
    return LeekFundConfig.getConfig('quote-pulse.hideStatusBar');
  }

  /** 隐藏基金状态栏 */
  get hideFundBarItem(): boolean {
    return LeekFundConfig.getConfig('quote-pulse.hideFundBarItem');
  }

  /** 隐藏图标 */
  get hideStatusBarIcon(): boolean {
    return LeekFundConfig.getConfig('quote-pulse.hideStatusBarIcon');
  }

  bindEvents() {
    events.on('stockListUpdate', () => {
      this.refreshStockStatusBar();
    });
    events.on('fundListUpdate', () => {
      this.refreshFundStatusBar();
    });
  }

  refresh() {
    this.refreshFundStatusBar();
    this.refreshStockStatusBar();
  }

  /** 切换状态栏显示 */
  toggleVisibility() {
    LeekFundConfig.setConfig('quote-pulse.hideStatusBar', !this.hideStatusBar);
    this.refresh();
  }

  /** 切换基金状态栏显示 */
  toggleFundBarVisibility() {
    LeekFundConfig.setConfig('quote-pulse.hideFundBarItem', !this.hideFundBarItem);
    this.refreshFundStatusBar();
  }

  /** 切换股票状态栏显示 */
  toggleStockBarVisibility() {
    LeekFundConfig.setConfig('quote-pulse.hideStatusBarStock', !this.hideStatusBarStock);
    this.refreshStockStatusBar();
  }

  /** 切换图标显示 */
  toggleStatusBarIconVisibility() {
    LeekFundConfig.setConfig('quote-pulse.hideStatusBarIcon', !this.hideStatusBarIcon);
    this.refresh();
  }

  refreshStockStatusBar() {
    if (this.hideStatusBar || this.hideStatusBarStock || !this.stockService.stockList.length) {
      if (this.statusBarList.length) {
        this.statusBarList.forEach((bar) => bar.dispose());
        this.statusBarList = [];
      }
      return;
    }

    let sz: LeekTreeItem | null = null;
    const statusBarStocks = LeekFundConfig.getConfig('quote-pulse.statusBarStock');
    const barStockList: Array<LeekTreeItem> = new Array(statusBarStocks.length);

    this.statusBarItemLabelFormat =
      globalState.labelFormat?.['statusBarLabelFormat'] ??
      DEFAULT_LABEL_FORMAT.statusBarLabelFormat;

    this.stockService.stockList.forEach((stockItem) => {
      const { code } = stockItem.info;
      if (code === 'sh000001') {
        sz = stockItem;
      }
      if (statusBarStocks.includes(code)) {
        // barStockList.push(stockItem);
        barStockList[statusBarStocks.indexOf(code)] = stockItem;
      }
    });

    if (!barStockList.length) {
      barStockList.push(sz || this.stockService.stockList[0]);
    }

    let count = barStockList.length - this.statusBarList.length;
    if (count > 0) {
      while (--count >= 0) {
        const stockBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
        this.statusBarList.push(stockBarItem);
      }
    } else if (count < 0) {
      let num = Math.abs(count);
      while (--num >= 0) {
        const bar = this.statusBarList.pop();
        bar?.hide();
        bar?.dispose();
      }
    }
    barStockList.forEach((stock, index) => {
      this.updateBarInfo(this.statusBarList[index], stock);
    });
  }

  updateBarInfo(stockBarItem: StatusBarItem, item: LeekTreeItem | null) {
    if (!item) return;
    const {
      code,
      percent,
      open,
      yestclose,
      high,
      low,
      updown,
      amount,
      afterPrice,
      afterPercent,
      heldAmount,
      heldPrice,
    } = item.info;
    const deLow = percent.indexOf('-') === -1;
    // Respect hideStatusBarIcon config
    const icon = this.hideStatusBarIcon ? '' : (deLow ? '📈' : '📉');
    stockBarItem.text = formatLabelString(this.statusBarItemLabelFormat, {
      ...item.info,
      percent: `${percent}%`,
      icon,
    });
    let heldText = '';
    if (heldAmount && heldPrice) {
      heldText = `成本：${heldPrice}   持仓：${heldAmount}\n`;
    }
    let afterText = '';
    if (afterPrice) {
      afterText = `盘后：${afterPrice}   涨跌幅：${afterPercent}%\n`;
    }
    stockBarItem.tooltip = `「今日行情」 ${
      item.info?.name ?? '今日行情'
    }（${code}）\n涨跌：${updown}   百分：${percent}%\n最高：${high}   最低：${low}\n今开：${open}   昨收：${yestclose}\n${afterText}${heldText}成交额：${amount}\n更新时间：${
      item.info?.time
    }`;
    stockBarItem.color = deLow ? this.riseColor : this.fallColor;
    stockBarItem.command = {
      title: 'Change stock',
      command: 'quote-pulse.changeStatusBarItem',
      arguments: [item.id],
    };

    stockBarItem.show();
    return stockBarItem;
  }

  refreshFundStatusBar() {
    // 隐藏基金状态栏
    if (this.hideStatusBar || this.hideFundBarItem) {
      this.fundBarItem.hide();
      return;
    }

    // Respect hideStatusBarIcon config for fund bar
    const icon = this.hideStatusBarIcon ? '' : '🐥';
    this.fundBarItem.text = `${icon}\$(pulse)`;
    this.fundBarItem.color = this.riseColor;
    this.fundBarItem.tooltip = this.getFundTooltipText();
    this.fundBarItem.show();
    return this.fundBarItem;
  }

  private getFundTooltipText() {
    let fundTemplate = '';
    for (let fund of this.fundService.fundList.slice(0, 14)) {
      const detailInfo = fund.info || { percent: '' };
      fundTemplate += `${
        detailInfo.percent?.indexOf('-') === 0 ? ' ↓ ' : detailInfo.percent === '0.00' ? '' : ' ↑ '
      } ${detailInfo.percent}%   「${
        detailInfo.name
      }」\n--------------------------------------------\n`;
    }
    // tooltip 有限定高度，所以只展示最多14只基金
    const tips = this.fundService.fundList.length >= 14 ? '（只展示前14只）' : '';
    return `「基金详情」\n\n ${fundTemplate}${tips}`;
  }
}
