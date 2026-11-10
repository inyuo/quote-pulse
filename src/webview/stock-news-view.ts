import { window, workspace } from 'vscode';
import OpenAI from 'openai';
import { fetchJYGNewsByCode, buildJygNewsAppendix } from './jiuyangongshe-news';
import { fetchRecentQfqTradeDataForAi } from '../shared/aiStockHistoryData';
import {
  hasXxjSession,
  fetchXxjNewsGroupsForAi,
  buildXxjNewsAppendix,
} from '../explorer/xxjwxcNews';
import { LjgxStorage, fetchShareCjl } from '../shared/ljgxData';
import { loadStockDetail, loadIndustryRows } from '../shared/fundFlowData';
import {
  AI_STOCK_SYSTEM_PROMPT,
  AI_CONFIG_MISSING,
  AI_SERVICE_DOWN,
  AI_EMPTY_REPLY,
  classifyAiResult,
  buildAiStockAnalysisPrompt,
  buildCjlAppendixForAi,
  buildFundFlowAppendixForAi,
} from '../shared/aiStockPrompt';

type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/**
 * 个股 AI 分析。
 *
 * 原「个股新闻」webview 页面与 leek-fund.stockNews 命令已下线，
 * 本类只保留 leek-fund.aiStockAnalysis 使用的分析能力。
 */
export class StockNewsView {
  private static instance: StockNewsView;
  private aiStockAnalysisInProgress = false;

  private constructor() {}

  public static getInstance(): StockNewsView {
    if (!StockNewsView.instance) {
      StockNewsView.instance = new StockNewsView();
    }
    return StockNewsView.instance;
  }

  async send_ai(userMessage: string): Promise<string> {
    try {
      const aiConfig = this.getAiConfig();

      if (!aiConfig.apiKey || !aiConfig.baseUrl || !aiConfig.model) {
        return AI_CONFIG_MISSING;
      }

      const openai = new OpenAI({
        apiKey: aiConfig.apiKey,
        baseURL: aiConfig.baseUrl,
      });

      const completion = await openai.chat.completions.create({
        model: aiConfig.model,
        messages: [
          { role: 'system', content: AI_STOCK_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        // reasoning 思考模型的思考 token 计入该预算，4000 常在思考阶段就被截断导致 content 为空
        max_tokens: 16000,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || AI_EMPTY_REPLY;
    } catch (error) {
      console.error('AI请求失败:', error);
      return AI_SERVICE_DOWN;
    }
  }

  async send_ai_stock_analysis(target: any, deps?: { store?: LjgxStorage }): Promise<string> {
    if (!target?.info) {
      window.showErrorMessage('未获取到股票信息');
      return '';
    }

    if (this.aiStockAnalysisInProgress) {
      window.showWarningMessage('AI 分析正在进行中，请稍候完成后再试');
      return '';
    }

    const cfg = workspace.getConfiguration();
    const range: string = cfg.get('leek-fund.aiStockHistoryRange', '3m');
    const rangeLabel =
      {
        '1y': '近1年',
        '6m': '近6个月',
        '3m': '近3个月',
        '1m': '近1个月',
        '1w': '近1周',
      }[range] || '近3个月';

    // 资金动态 / 量价分层都要求带交易所前缀的代码，树项 id 就是该形态
    const aiCode = String(target?.id || target?.info?.code || '').trim();
    const keyword = String(target?.info?.name || target?.info?.code || '').trim();
    const asOf = new Date().toISOString().slice(0, 10);

    window.showWarningMessage(
      `开始分析：${target.info.name} 股票 ${rangeLabel}的前复权日线数据，股票代码：${target.info.code}`
    );

    // 四组数据并发拉取，各自独立降级：任一失败只丢掉对应附录
    const tradeTask = fetchRecentQfqTradeDataForAi(aiCode, range).catch((e) => {
      console.error('获取历史交易数据失败:', e);
      return null;
    });

    // 新闻附录：登录后用「资讯」栏四来源分类信息替代韭研该股新闻（与资讯视图同源切换），
    // 未登录（或分类源为空）保留韭研公社该股新闻
    const newsTask = (async () => {
      if (hasXxjSession()) {
        const groups = await fetchXxjNewsGroupsForAi();
        const text = buildXxjNewsAppendix(groups);
        if (text) return text;
      }
      if (!keyword) return '';
      const items = await fetchJYGNewsByCode(keyword, 10, 0);
      return buildJygNewsAppendix(keyword, items);
    })().catch((e) => {
      console.error('拼接个股新闻失败:', e);
      return '';
    });

    // 资金动态：复用窗口同一编排层，一次拿到报价 / 分时资金 / 板块 / 量化结论 / 三表
    const fundTask = (async () => {
      const pair = await Promise.all([
        loadStockDetail(aiCode, { store: deps?.store }),
        loadIndustryRows(),
      ]);
      return buildFundFlowAppendixForAi(pair[0], pair[1]);
    })().catch((e) => {
      console.error('拼接资金动态数据失败:', e);
      return '';
    });

    // 量价分层：分时累计成交额（登录接口，未登录返回 null）
    const cjlTask = fetchShareCjl([aiCode], { store: deps?.store }).catch((e) => {
      console.error('获取量价分层数据失败:', e);
      return null;
    });

    const resolved = await Promise.all([tradeTask, newsTask, fundTask, cjlTask]);
    const tradeData = resolved[0];
    const newsAppendix = resolved[1];
    const fundFlowAppendix = resolved[2];
    const cjlAppendix = buildCjlAppendixForAi(resolved[3]);

    const { user: message } = buildAiStockAnalysisPrompt({
      name: String(target.info.name || aiCode),
      code: String(target.info.code || aiCode),
      rangeLabel,
      asOf,
      qfqCsv: tradeData && tradeData.text ? tradeData.text : '',
      qfqSourceLabel: tradeData && tradeData.sourceLabel ? tradeData.sourceLabel : '',
      newsAppendix,
      fundFlowAppendix,
      cjlAppendix,
    });

    this.aiStockAnalysisInProgress = true;
    try {
      const result = await this.send_ai(message);

      // 只精确比对宿主固定错误文案；模型正文里的「数据不可用/缺失」是正常分析内容
      const status = classifyAiResult(result);

      if (status === 'config') {
        window.showWarningMessage('AI 配置不完整，请在设置中完善 API Key / Base URL / 模型');
        return '';
      }
      if (status === 'service') {
        window.showErrorMessage('AI 服务暂不可用，请稍后再试');
        return '';
      }
      return result;
    } catch (err) {
      console.error('调用 AI 分析失败:', err);
      window.showErrorMessage('调用 AI 分析失败，请稍后再试');
      return '';
    } finally {
      this.aiStockAnalysisInProgress = false;
    }
  }

  getAiConfig(): AiConfig {
    const result = workspace.getConfiguration().get('leek-fund.aiConfig', {
      apiKey: '',
      baseUrl: '',
      model: '',
    });
    return result;
  }
}

export default StockNewsView;
