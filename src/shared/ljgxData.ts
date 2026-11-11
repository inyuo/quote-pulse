/**
 * ljgx（xxjwxc「量价掘金」）数据源客户端。
 *
 * 2026-11-11 起插件不再扫码登录：需登录的接口统一由服务端 qp-data-service
 * 代发（多 sessionId 轮询 + 限速 + 按天快照），本模块只负责免登录的公开行情。
 * 服务端未配置或请求失败一律返回 null，由 UI 显示空态，不再有本地兜底。
 *
 * 惯例沿用：所有函数失败一律返回 null / 降级值，绝不抛异常；
 * console.error 只打 message，不打完整 axios 错误对象。
 */
import axios from 'axios';
import { postLjgx as postViaDataApi, isEnabled as isDataApiEnabled } from './dataApiClient';

const LJGX_TIMEOUT = 30000;

/** 日志只取 message：axios 错误对象带完整 config/request/response，直接打会刷屏 */
function errMsg(e: any): string {
  if (!e) return String(e);
  if (typeof e === 'string') return e;
  return e.message || e.code || String(e);
}

/** 数字收敛：仅保留有限数字（剔除 null/NaN/Infinity/字符串） */
function validNumber(v: any): boolean {
  return typeof v === 'number' && isFinite(v);
}

/** 字符串收敛：非字符串一律空串 */
function str(v: any): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 请求依赖（测试注入用）。
 * - post：直接注入服务端代发结果，便于纯函数化测试；
 * - axios：历史测试注入的假客户端，仅用于免登录/单测直连，生产不会走此分支；
 * - store：兼容历史测试参数，生产忽略（已无会话存储）。
 */
export interface LjgxFetchDeps {
  post?: (path: string, body: Record<string, any>) => Promise<any>;
  axios?: typeof axios;
  store?: any;
}

/**
 * 需登录的掘金 POST：生产只走服务端只读 API。
 * 返回官网 data.data 载荷；不可用返回 null。
 */
export async function ljgxPostAuth(
  path: string,
  body: Record<string, any>,
  deps?: LjgxFetchDeps
): Promise<any> {
  if (deps && deps.post) {
    try {
      return await deps.post(path, body);
    } catch (e) {
      console.error('[LJGX]', path, '服务端代发失败', errMsg(e));
      return null;
    }
  }

  if (deps && deps.axios) {
    // 测试注入：直连假客户端（不携带任何凭据）
    try {
      const res = await deps.axios.post(`https://www.xxjwxc.cn/shares/api/v1/${path}`, body, {
        timeout: LJGX_TIMEOUT,
        validateStatus: () => true,
      });
      if (!res || res.status >= 400) return null;
      const data = res.data;
      if (!data || data.state !== true || !data.data) return null;
      return data.data;
    } catch (e) {
      console.error('[LJGX]', path, '请求失败', errMsg(e));
      return null;
    }
  }

  if (!isDataApiEnabled()) return null;
  return postViaDataApi(path, body);
}

/**
 * 量价分层（成交量接口）：POST /analy.get_share_cjl，body {codes:[...]}。
 * 成功 data.data = {tm:<日期>, price:<数值数组，可能含 null 元素>, ...}，
 * 此处只保留 tm 与过滤后的 price（剔除非有限数字）。失败策略同上。
 */
export async function fetchShareCjl(
  codes: string[],
  deps?: LjgxFetchDeps
): Promise<{ tm: string; price: number[] } | null> {
  const body = { codes: Array.isArray(codes) ? codes : [] };
  const payload = await ljgxPostAuth('analy.get_share_cjl', body, deps);
  if (!payload) return null;
  if (!Array.isArray(payload.price)) {
    console.error('[LJGX] analy.get_share_cjl 载荷不可解析（price 非数组）');
    return null;
  }
  return {
    tm: str(payload.tm),
    price: payload.price.filter(validNumber),
  };
}

/** ---------- 免登录数据接口（北向资金分时 / 大盘指数）---------- */

/* 免登录接口不走 xxjwxc 登录态，直连东财 push2 与腾讯 proxy；东财 push2 有
 * IP 频率风控前科（见 emMoneyFlow.ts），浏览器 UA/Referer 与 15s 超时沿用其
 * 惯例。失败一律返回 null，绝不抛异常。 */

const EM_KAMT_URL =
  'https://push2.eastmoney.com/api/qt/kamt.rtmin/get' +
  '?fields1=f1,f2,f3,f4&fields2=f51,f52,f54,f56&ut=b2884a393a59ad64002292a3e90d46a5';
const QQ_INDEX_URL = 'https://proxy.finance.qq.com/cgi/cgi-bin/market/hs/index?scenes=6';

const FREE_TIMEOUT = 15000;
const FREE_HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/**
 * 数字收敛：数字直取，数字字符串转数；空串/`-`/非数字返回 NaN。
 * 东财分时样本未到时刻用 `-` 占位、腾讯分时条目为 "0930 价格 量" 空格串，
 * 统一经此处过滤。
 */
function strNumber(v: any): number {
  if (validNumber(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 北向资金分时（kamt.rtmin s2n）归一化结果：三数组按下标对齐 */
export interface NorthFundTrends {
  times: string[];
  hgtNet: number[];
  szgtNet: number[];
}

/**
 * 解析东财 kamt.rtmin 载荷（纯函数）。
 *
 * data.s2n 是『时间,沪股通净流入,深股通净流入,合计』字符串数组（fields2 顺序
 * f51,f52,f54,f56），如 "9:30,5.10,6.20,11.30"；未到样本为 "10:56,-,-,-"。
 * 归一化：`-`/空串/非数字样本整行剔除，保证三数组严格对齐；无任何有效样本
 * （s2n 缺失、非数组或全空）返回 null。
 */
export function parseNorthFundTrends(payload: any): NorthFundTrends | null {
  const s2n = payload && payload.data && payload.data.s2n;
  if (!Array.isArray(s2n)) return null;

  const times: string[] = [];
  const hgtNet: number[] = [];
  const szgtNet: number[] = [];
  for (const row of s2n) {
    const parts = String(row || '').split(',');
    const hgt = strNumber(parts[1]);
    const szgt = strNumber(parts[2]);
    if (!isFinite(hgt) || !isFinite(szgt)) continue;
    times.push(String(parts[0] || '').trim());
    hgtNet.push(hgt);
    szgtNet.push(szgt);
  }
  if (!times.length) return null;
  return { times, hgtNet, szgtNet };
}

/**
 * 北向资金分时净流入（免登录，东财 kamt.rtmin）。
 * deps.axios 仅供测试注入；网络/HTTP/响应不可解析失败 → null 不抛。
 */
export async function fetchNorthFundTrends(
  deps?: { axios?: typeof axios }
): Promise<NorthFundTrends | null> {
  const client = (deps && deps.axios) || axios;
  try {
    const res = await client.get(EM_KAMT_URL, {
      headers: FREE_HEADERS,
      timeout: FREE_TIMEOUT,
      validateStatus: () => true,
    });
    if (!res || res.status >= 400) {
      console.error('[LJGX] kamt.rtmin HTTP error', res && res.status);
      return null;
    }
    return parseNorthFundTrends(res.data);
  } catch (e) {
    console.error('[LJGX] kamt.rtmin 请求失败', errMsg(e));
    return null;
  }
}

/** 大盘指数 spark 条目：分时价格序列 + 最新涨跌幅 */
export interface IndexSparkItem {
  code: string;
  name: string;
  price: number[];
  percent: number;
}

/** 腾讯分时样本 "0930 3605.39 5145513" → 价格段（第二段，非数字 NaN） */
function minuteRowPrice(row: any): number {
  const parts = typeof row === 'string' ? String(row).trim().split(/\s+/) : [];
  return parts.length > 1 ? strNumber(parts[1]) : NaN;
}

/** 条目涨跌幅：percent/zdf/Zdf 字段优先，缺失则由 pre（昨收）与最新价推导 */
function resolvePercent(it: any, lastPrice: number): number {
  for (const key of ['percent', 'zdf', 'Zdf']) {
    const n = strNumber(it[key]);
    if (isFinite(n)) return n;
  }
  const pre = strNumber(it.pre);
  if (isFinite(pre) && pre !== 0 && isFinite(lastPrice)) {
    return ((lastPrice - pre) / pre) * 100;
  }
  return NaN;
}

/**
 * 解析腾讯 hs/index 载荷（纯函数）。
 *
 * 实测（2026-11-04）scenes=6 响应无 esllt_list；等价数组为 data.minute_set
 * （对象值形态，条目 {code, pre, data:["0930 3605.39 …", …]}，无 name 字段）。
 * 防御式兼容：优先取 data.esllt_list（数组形态），否则取 minute_set 的值；
 * 条目 code 兼容 Symbol、name 兼容 Name，percent 兼容 zdf/Zdf 字段。
 * 只保留 price 序列非空且 percent 可解析的条目；整体解析不出返回 null。
 */
export function parseIndexSpark(payload: any): IndexSparkItem[] | null {
  const data = payload && payload.data;
  if (!data || typeof data !== 'object') return null;

  let items: any[] | null = null;
  if (Array.isArray(data.esllt_list)) items = data.esllt_list;
  else if (data.minute_set && typeof data.minute_set === 'object') {
    items = Object.keys(data.minute_set).map((k) => data.minute_set[k]);
  }
  if (!items) return null;

  const out: IndexSparkItem[] = [];
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    const price = Array.isArray(it.price)
      ? it.price.filter(validNumber)
      : Array.isArray(it.data)
      ? it.data.map(minuteRowPrice).filter(isFinite)
      : [];
    if (!price.length) continue;

    const percent = resolvePercent(it, price[price.length - 1]);
    if (!isFinite(percent)) continue;
    out.push({
      code: str(it.code) || str(it.Symbol) || str(it.symbol),
      name: str(it.name) || str(it.Name),
      price,
      percent,
    });
  }
  return out.length ? out : null;
}

/**
 * 大盘指数 spark（免登录，腾讯 CGI hs/index）。
 * deps.axios 仅供测试注入；网络/HTTP/响应不可解析失败 → null 不抛。
 */
export async function fetchIndexSpark(
  deps?: { axios?: typeof axios }
): Promise<IndexSparkItem[] | null> {
  const client = (deps && deps.axios) || axios;
  try {
    const res = await client.get(QQ_INDEX_URL, {
      headers: FREE_HEADERS,
      timeout: FREE_TIMEOUT,
      validateStatus: () => true,
    });
    if (!res || res.status >= 400) {
      console.error('[LJGX] qq hs/index HTTP error', res && res.status);
      return null;
    }
    return parseIndexSpark(res.data);
  } catch (e) {
    console.error('[LJGX] qq hs/index 请求失败', errMsg(e));
    return null;
  }
}
