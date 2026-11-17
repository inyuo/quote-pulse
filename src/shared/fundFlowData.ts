/**
 * 资金动态窗口的多源编排层。
 *
 * 分层意图（方案二）：
 * - `xxjwxcData` / `emMoneyFlow` —— 单一数据源客户端，只负责请求与解析
 * - `fundFlowData`（本文件）      —— 跨源选择与降级，返回窗口直接可用的结构
 * - `webview/stockFundFlow.ts`   —— 只负责开窗与消息收发，不含取数逻辑
 *
 * 这样编排逻辑也能被单测覆盖（mock 两个源的导出函数即可），
 * 不必把降级判断塞进无法测试的 webview 层。
 */
import {
  fetchStockMainFlow,
  fetchStockAnalysisGroups,
  fetchStockQuote,
  fetchIndustryFlow,
  MainFlowData,
  AnalysisGroup,
} from './xxjwxcData';
import {
  fetchEastIndustryFlow,
  fetchEastStockMainFlow,
  fetchEastStockFlowBatch,
  EastStockFlowRow,
  toSecid,
} from './emMoneyFlow';
import { fetchStockNames } from './tencentStock';
import { LjgxFetchDeps } from './ljgxData';
import { FundTable, fetchStockFundTables } from './stockFundTables';
import { mapLimit } from './utils';

/** 逐股取数并发上限：第三方接口短时高并发会触发反爬（实测东财被封） */
const STOCK_CONCURRENCY = 5;
/** 列表最多展示的自选股数，避免自选几十只时请求过多 */
const MAX_STOCKS = 30;

/** 日志只取 message：避免 axios 错误对象（含完整 config/request）刷屏输出面板 */
function errMsg(e: any): string {
  if (!e) return String(e);
  if (typeof e === 'string') return e;
  return e.message || e.code || String(e);
}

/** 粒度 A：一只自选股的当日主力净流入 */
export interface StockFundRow {
  code: string;
  /** 股票名称（腾讯批量行情），取不到时为空串 */
  name: string;
  /** 当日累计主力净流入（取分时序列末元素），两源皆无时为 null */
  mainNet: number | null;
  /** 数据日期（如 20261019），东财备源无日期时为空串 */
  tm: string;
  /** 数据来源：xxjwxc（主）/ east（备源）/ ''（无数据） */
  source: string;
}

/** 粒度 D：一个行业的主力资金流 */
export interface IndustryRow {
  /** 东财板块代码（BK 开头），xxjwxc 源没有代码时为空串 */
  code: string;
  name: string;
  amount: number;
  /** 占成交额比例（%），xxjwxc 源无此数据时为 0 */
  ratio: number;
}

/** 所属板块（粒度 C） */
export interface SectorRow {
  name: string;
  percent: number;
}

/**
 * 选中股详情：分时曲线 + 所属板块 + 第三方分析 + 个股资金三块表格。
 * fundTables 需登录态，未登录/失败为空数组（模板据此隐藏左栏）。
 */
export interface StockDetail {
  code: string;
  name: string;
  /** 现价，取不到时为 0 */
  price: number;
  /** 涨跌幅（%），取不到时为 0 */
  percent: number;
  mainFlow: MainFlowData | null;
  /** 第三方量化分析（结构化分组，供窗口按卡片渲染） */
  analysis: AnalysisGroup[];
  sectors: SectorRow[];
  /** 官网资金动态三块：主力分析 / 主力资金 / 明-暗盘 */
  fundTables: FundTable[];
}

/**
 * 是否为 A 股个股代码（sh/sz + 6 位数字）。
 * 港股 hk、美股 usr 一律不支持 —— 若不过滤，
 * 这些代码会各自白等 30s 超时 + 1 次重试，拖垮整个窗口。
 */
export function isAShareCode(code: any): boolean {
  if (typeof code !== 'string') return false;
  return toSecid(code) !== null;
}

/**
 * 粒度 A：逐股取当日主力净流入。
 *
 * - 非 A 股代码直接跳过（不发请求）
 * - 先东财批量一次取完（~0.3s）：逐股调 xxjwxc 单次 5-6s 且服务端
 *   单 worker 串行处理，30 只自选股逐股请求首屏要排队数分钟
 * - 批量没覆盖到的股票（接口失败/停牌）才逐股走主源 + 东财单股兜底，
 *   限流并发，避免打爆第三方
 * - 单股失败保留该行、mainNet 置 null —— 绝不让一只股票拖垮整个列表
 * - mainNet 取**末元素**：main[] 是分时累计序列，求和会得到天文数字
 * - 名称随批量行情一并带回；仍缺失的用腾讯批量补，失败只丢展示名
 */
export async function loadStockFundRows(codes: any): Promise<StockFundRow[]> {
  const list = (Array.isArray(codes) ? codes : [])
    .filter(isAShareCode)
    .slice(0, MAX_STOCKS);

  if (list.length === 0) return [];

  const batch = await fetchEastStockFlowBatch(list).catch((e) => {
    console.error('[资金动态] 东财批量行情失败', errMsg(e));
    return new Map<string, EastStockFlowRow>();
  });

  const missing = list.filter((code) => !batch.has(code));

  /** 逐股兜底：主源 xxjwxc 分时末值，失败回退东财单股当日值 */
  async function fallbackRow(code: string): Promise<StockFundRow> {
    try {
      const flow = await fetchStockMainFlow(code);
      if (flow && flow.main.length > 0) {
        return {
          code,
          name: '',
          mainNet: flow.main[flow.main.length - 1],
          tm: flow.tm,
          source: 'xxjwxc',
        };
      }
    } catch (e) {
      console.error('[资金动态] 取个股资金流失败', code, errMsg(e));
    }

    try {
      const east = await fetchEastStockMainFlow(code);
      if (east !== null && east !== undefined && !isNaN(east)) {
        return { code, name: '', mainNet: east, tm: '', source: 'east' };
      }
    } catch (e) {
      console.error('[资金动态] 东财个股资金流兜底失败', code, errMsg(e));
    }

    return { code, name: '', mainNet: null, tm: '', source: '' };
  }

  const [fallback, nameRows] = await Promise.all([
    mapLimit(missing, STOCK_CONCURRENCY, fallbackRow),
    (async () => {
      // 批量源没带回名称的代码，用腾讯批量行情一次补齐
      const need = list.filter((code) => {
        const east = batch.get(code);
        return !east || !east.name;
      });
      if (!need.length) return {} as { [code: string]: string };
      return fetchStockNames(need).catch((e) => {
        console.error('[资金动态] 批量取股票名称失败', errMsg(e));
        return {} as { [code: string]: string };
      });
    })(),
  ]);

  const fallbackByCode = new Map(fallback.map((row) => [row.code, row]));
  const rows: StockFundRow[] = list.map((code) => {
    const east = batch.get(code);
    if (east) {
      return {
        code,
        name: east.name || (nameRows && nameRows[code]) || '',
        mainNet: east.mainNet,
        tm: '',
        source: 'east',
      };
    }
    const row = fallbackByCode.get(code);
    return row
      ? { ...row, name: row.name || (nameRows && nameRows[code]) || '' }
      : { code, name: (nameRows && nameRows[code]) || '', mainNet: null, tm: '', source: '' };
  });
  return rows;
}

/**
 * 粒度 D：全行业资金流排名。
 * 东财 `clist/get` 为主源（有板块代码与占比），空了回退 xxjwxc `get_hy_time`。
 */
export async function loadIndustryRows(): Promise<IndustryRow[]> {
  try {
    const east = await fetchEastIndustryFlow();
    if (Array.isArray(east) && east.length > 0) {
      return east.map((row) => ({
        code: row.code,
        name: row.name,
        amount: row.amount,
        ratio: row.ratio,
      }));
    }
  } catch (e) {
    console.error('[资金动态] 东财行业资金流失败', errMsg(e));
  }

  try {
    const rows = await fetchIndustryFlow();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      code: '',
      name: row.name,
      amount: row.amount,
      ratio: 0,
    }));
  } catch (e) {
    console.error('[资金动态] 量化数据源行业资金流失败', errMsg(e));
    return [];
  }
}

/** 快速头部信息：先于完整详情推送，让名称/价格秒级出现（东财单只 ~0.3s） */
export interface StockQuickInfo {
  code: string;
  name: string;
  price: number;
  percent: number;
}

/**
 * 选中股的快速信息（P2 分阶段推送第一阶段）。
 * 曲线/分析/三块表格依赖 xxjwxc（单次 5-6s），先把名称与现价补出来，
 * 慢数据随后由 loadStockDetail 完整覆盖。
 */
export async function loadStockQuick(code: any): Promise<StockQuickInfo | null> {
  const safeCode = typeof code === 'string' ? code : '';
  if (!isAShareCode(safeCode)) return null;
  try {
    const rows = await fetchEastStockFlowBatch([safeCode]);
    const row = rows.get(safeCode);
    if (!row) return null;
    return {
      code: safeCode,
      name: row.name,
      price: row.price,
      percent: row.percent,
    };
  } catch (e) {
    console.error('[资金动态] 快速行情失败', safeCode, errMsg(e));
    return null;
  }
}

/**
 * 选中股详情：分时资金曲线（B）+ 所属板块（C）+ 第三方分析结论。
 *
 * 三个子请求并发且各自 catch —— 任一失败只丢该字段，
 * 其余照常返回（教训：韭研超时被静默吞掉时，模型只能回答"无法实时抓取"）。
 */
export async function loadStockDetail(code: any, deps?: LjgxFetchDeps): Promise<StockDetail> {
  const safeCode = typeof code === 'string' ? code : '';
  const empty: StockDetail = {
    code: safeCode,
    name: '',
    price: 0,
    percent: 0,
    mainFlow: null,
    analysis: [],
    sectors: [],
    fundTables: [],
  };

  if (!isAShareCode(safeCode)) return empty;

  const pair = await Promise.all([
    fetchStockMainFlow(safeCode).catch((e) => {
      console.error('[资金动态] 取分时资金流失败', errMsg(e));
      return null;
    }),
    fetchStockQuote(safeCode).catch((e) => {
      console.error('[资金动态] 取个股信息失败', errMsg(e));
      return null;
    }),
    fetchStockAnalysisGroups(safeCode).catch((e) => {
      console.error('[资金动态] 取分析结论失败', errMsg(e));
      return [];
    }),
    fetchStockFundTables(safeCode, deps).catch((e) => {
      console.error('[资金动态] 取个股资金三块表格失败', errMsg(e));
      return [] as FundTable[];
    }),
  ]);
  const flow = pair[0];
  const quote = pair[1];
  const analysis = pair[2];
  const fundTables = pair[3];

  let sectors: SectorRow[] = [];
  if (quote && Array.isArray(quote.hy)) {
    sectors = quote.hy
      .filter((item: any) => item && typeof item.name === 'string' && item.name)
      .map((item: any) => ({ name: item.name, percent: Number(item.percent) || 0 }));
  }

  return {
    code: safeCode,
    name: quote && typeof quote.name === 'string' ? quote.name : '',
    price: quote ? Number(quote.price) || 0 : 0,
    percent: quote ? Number(quote.percent) || 0 : 0,
    mainFlow: flow,
    analysis: Array.isArray(analysis) ? analysis : [],
    sectors,
    fundTables: Array.isArray(fundTables) ? fundTables : [],
  };
}

export default {
  isAShareCode,
  loadStockFundRows,
  loadIndustryRows,
  loadStockDetail,
};
