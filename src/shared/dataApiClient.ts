import axios from 'axios';

/**
 * 服务端数据接口客户端。
 *
 * 配置 leek-fund.dataApiBaseUrl 后，需登录的掘金请求与东财资金流请求
 * 改由服务端完成（多 sessionId 轮询 + 限速 + 按天快照）；配置为空或服务
 * 不可用时调用方显示空态，插件不再扫码登录或直连兜底。
 */

const TIMEOUT = 20000;

/** 纯函数：仅接受 http(s) 字符串地址，去掉末尾斜杠；供单测覆盖 */
export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const baseUrl = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(baseUrl) ? baseUrl : '';
}

function settings(): { baseUrl: string; apiKey: string } {
  try {
    // 延迟 require，便于在无 vscode 运行时的单测中加载本模块
    const vscode = require('vscode');
    const cfg = vscode.workspace.getConfiguration('leek-fund');
    const rawKey = cfg.get('dataApiKey');
    const baseUrl = normalizeBaseUrl(cfg.get('dataApiBaseUrl'));
    const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!baseUrl) return { baseUrl: '', apiKey: '' };
    return { baseUrl, apiKey };
  } catch (e) {
    return { baseUrl: '', apiKey: '' };
  }
}

function errMsg(e: any): string {
  if (!e) return String(e);
  if (typeof e === 'string') return e;
  return e.message || e.code || String(e);
}

/** 是否启用服务端取数 */
export function isEnabled(): boolean {
  return settings().baseUrl.length > 0;
}

function requestHeaders(apiKey: string): Record<string, string> {
  return { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
}

/** 服务端代发的掘金 POST，返回官网 data.data 载荷；失败返回 null 以便降级 */
export async function postLjgx(path: string, body: Record<string, any>): Promise<any> {
  const { baseUrl, apiKey } = settings();
  if (!baseUrl) return null;
  const safePath = String(path || '').replace(/^\/+/, '');
  try {
    const res = await axios.post(`${baseUrl}/api/v1/xxjwxc/${safePath}`, body, {
      headers: requestHeaders(apiKey),
      timeout: TIMEOUT,
      validateStatus: () => true,
    });
    if (!res || res.status >= 400 || !res.data) return null;
    if (res.data.success !== true) return null;
    return res.data.data;
  } catch (e) {
    console.error('[数据服务] 掘金请求失败', path, errMsg(e));
    return null;
  }
}

/** 服务端代发的免登录 GET，返回类 axios 响应结构，便于复用现有解析函数 */
export async function getPublic(
  url: string,
  params?: Record<string, any>
): Promise<{ status: number; data: any } | null> {
  const { baseUrl, apiKey } = settings();
  if (!baseUrl) return null;
  try {
    const res = await axios.get(`${baseUrl}/api/v1/proxy-get`, {
      params: { url, params: JSON.stringify(params || {}) },
      headers: requestHeaders(apiKey),
      timeout: TIMEOUT,
      validateStatus: () => true,
    });
    if (!res || res.status >= 400 || !res.data || res.data.success !== true) return null;
    return { status: 200, data: res.data.data };
  } catch (e) {
    console.error('[数据服务] 公开行情请求失败', url, errMsg(e));
    return null;
  }
}

/** 服务端预计算的数据碰撞结果（默认最新日期） */
export async function getCollision(days: number, date?: string): Promise<any> {
  const { baseUrl, apiKey } = settings();
  if (!baseUrl) return null;
  try {
    const res = await axios.get(`${baseUrl}/api/v1/quant/collision`, {
      params: { days, ...(date ? { date } : {}) },
      headers: requestHeaders(apiKey),
      timeout: TIMEOUT,
      validateStatus: () => true,
    });
    if (!res || res.status >= 400 || !res.data || res.data.success !== true) return null;
    const payload = res.data.data;
    if (!payload || typeof payload !== 'object') return null;
    // 快照日期/是否复用缓存随结果一起交给面板展示
    return {
      ...payload,
      dataDate: typeof res.data.dataDate === 'string' ? res.data.dataDate : '',
      stale: !!res.data.stale,
    };
  } catch (e) {
    console.error('[数据服务] 碰撞结果获取失败', errMsg(e));
    return null;
  }
}
