/**
 * 量化面板：3 个 canvas Tab（量价分层 / 北向资金 / 大盘指数）
 * + 1 个 DOM 表格 Tab（数据碰撞，来自服务端预计算快照）。
 *
 * 2026-11-11 起插件不再扫码登录：需登录的数据统一由 qp-data-service 代发，
 * 服务端未配置或不可用时直接显示空态，不再有任何本地直连兜底。
 *
 * 懒加载：init 只拉当前 tab 对应的数据（cjl → fetchShareCjl、north/index →
 * 免登录接口），其余字段推 null；Tab 切换消息推对应数据，refresh 重拉当前 tab。
 * 数据碰撞走独立的 {type:'collision'} 消息，服务端快照按 days 做 60s 缓存。
 *
 * 交互契约：
 * - 宿主 → 模板：{type:'init', data:{tab, cjl, north, index, collisionDays,
 *   collisionDayMeta, collisionTags, updatedAt}}
 * - 宿主 → 模板：{type:'collision', data:{days, rows, available, total,
 *   unavailable, reason, httpStatus, dataDate, updatedAt}}
 * - 模板 → 宿主：ready / refresh / selectTab{tab} / requestCollision /
 *   selectCollisionDays{days} / refreshCollision / openStock{code}。
 *
 * 惯例沿用 stockFundFlow：attached Set 防复用面板重复挂监听、
 * 失败静默不抛错、console.error 只打 message。
 */
import { commands, ViewColumn } from 'vscode';
import ReusedWebviewPanel from './ReusedWebviewPanel';
import { getTemplateFileContent } from '../shared/utils';
import {
  fetchIndexSpark,
  fetchNorthFundTrends,
  fetchShareCjl,
} from '../shared/ljgxData';
import {
  DEFAULT_COLLISION_DAYS,
  LQ_COLLISION_DAYS,
  LQ_TAGS,
} from '../shared/lqData';
import { getCollision } from '../shared/dataApiClient';

const VIEW_TYPE = 'quote-pulse.quant';
const TITLE = '量化面板';
const TEMPLATE = 'quant.html';

type QuantTab = 'cjl' | 'north' | 'index' | 'collision';

const VALID_TABS: QuantTab[] = ['cjl', 'north', 'index', 'collision'];

/** 服务端碰撞快照缓存（60s）与同档在途请求合并 */
const COLLISION_TTL_MS = 60 * 1000;
const collisionCache = new Map<number, { time: number; data: any }>();
const collisionInflight = new Map<number, Promise<any>>();

/** 量价分层默认查询集合：上证指数 + 深证成指（分层累计分布） */
const CJL_CODES = ['sh000001', 'sz399001'];

/** 日志只取 message：避免错误对象（含完整 config/request）刷屏 */
function errMsg(e: any): string {
  if (!e) return String(e);
  if (typeof e === 'string') return e;
  return e.message || e.code || String(e);
}

/**
 * viewType → 是否已挂消息监听。
 * ReusedWebviewPanel 复用同一 panel，重复挂监听会导致同一条消息处理多次；
 * panel dispose 后移除标记。
 */
const attached = new Set<string>();

/** 当前展示 tab（复用面板时切换 tab 不重建窗口），默认北向资金 */
let currentTab: QuantTab = 'north';

/** 可选个股代码（命令带 code 参数时覆盖量价分层的默认查询集合） */
let currentCode = '';

/** 「数据碰撞」当前窗口（6 档之一，默认近 5 天） */
let currentCollisionDays = DEFAULT_COLLISION_DAYS;

/** 量价分层查询集合：命令参数带 code 时查个股，否则查两大指数 */
function cjlCodes(): string[] {
  return currentCode ? [currentCode] : CJL_CODES;
}

/**
 * 推送当前 tab 的 init 数据。懒加载：只拉 tab 对应接口，其余字段恒 null；
 * 各 fetch 函数自带失败 → null 降级，这里再兜一层 catch 保证不抛错。
 */
async function pushInit(panel: any, tab: QuantTab): Promise<void> {
  let cjl: any = null;
  let north: any = null;
  let index: any = null;

  try {
    if (tab === 'cjl') {
      cjl = await fetchShareCjl(cjlCodes()).catch(() => null);
    } else if (tab === 'north') {
      north = await fetchNorthFundTrends().catch(() => null);
    } else if (tab === 'index') {
      index = await fetchIndexSpark().catch(() => null);
    }
  } catch (e) {
    console.error('[量化面板] 拉取面板数据失败', errMsg(e));
  }

  try {
    await panel.webview.postMessage({
      type: 'init',
      data: {
        tab,
        cjl,
        north,
        index,
        collisionDays: currentCollisionDays,
        collisionDayMeta: LQ_COLLISION_DAYS,
        collisionTags: LQ_TAGS.map((t) => t.label),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('[量化面板] 推送面板数据失败', errMsg(e));
  }
}

/** 宿主内部使用的碰撞结果（与 dataApiClient.CollisionResult 字段对齐） */
type CollisionResultLike = {
  ok: boolean;
  reason?: string;
  status?: number;
  data?: any;
};

/** 服务端成功载荷结构校验：脏数据一律收敛成失败 */
function normalizeCollision(result: CollisionResultLike): any {
  if (!result || result.ok !== true || !result.data) return null;
  const payload = result.data;
  if (typeof payload !== 'object' || !Array.isArray(payload.rows)) return null;
  return payload;
}

/** 按窗口拉服务端快照：成功结果 60s TTL 复用、同档在途请求合并；失败不缓存 */
async function loadCollision(days: number): Promise<CollisionResultLike> {
  const hit = collisionCache.get(days);
  if (hit && Date.now() - hit.time < COLLISION_TTL_MS) return hit.data;

  const flying = collisionInflight.get(days);
  if (flying) return flying;

  const task: Promise<CollisionResultLike> = getCollision(days)
    .catch((): CollisionResultLike => ({ ok: false, reason: 'unreachable' }))
    .then((result: CollisionResultLike): CollisionResultLike => {
      collisionInflight.delete(days);
      if (!result || !result.ok) return result || { ok: false, reason: 'unreachable' };
      const payload = normalizeCollision(result);
      if (!payload) return { ok: false, reason: 'invalid_response', status: result.status };
      const success: CollisionResultLike = { ok: true, status: result.status, data: payload };
      // 只缓存成功快照：配置修好 / 服务端恢复后点重试可立即重新取数
      collisionCache.set(days, { time: Date.now(), data: success });
      return success;
    });
  collisionInflight.set(days, task);
  return task;
}

/**
 * 推送「数据碰撞」：默认取服务端预计算快照（按日期归档的 9 类策略归并结果）。
 * 失败时把具体原因（未配置 / 密钥错 / 不可达 / 无快照 / 响应异常）透传给模板，
 * 由模板给出对应引导；不再有登录引导或本地直连兜底。
 */
async function pushCollision(panel: any, days: number): Promise<void> {
  const result = await loadCollision(days);
  const payload = result && result.ok ? normalizeCollision(result) : null;
  const data = payload
    ? {
        days,
        rows: payload.rows,
        available: typeof payload.available === 'number' ? payload.available : 0,
        total: typeof payload.total === 'number' ? payload.total : LQ_TAGS.length,
        unavailable: false,
        reason: '',
        httpStatus: 0,
        dataDate: typeof payload.dataDate === 'string' ? payload.dataDate : '',
      }
    : {
        days,
        rows: [],
        available: 0,
        total: LQ_TAGS.length,
        unavailable: true,
        reason: (result && result.reason) || 'unreachable',
        httpStatus: (result && result.status) || 0,
        dataDate: '',
      };

  try {
    await panel.webview.postMessage({
      type: 'collision',
      data: Object.assign({}, data, { updatedAt: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[量化面板] 推送碰撞数据失败', errMsg(e));
  }
}

function handleMessage(panel: any, message: any): void {
  if (!message || typeof message.command !== 'string') return;

  switch (message.command) {
    // 前端脚本就绪：按当前 tab 懒加载
    case 'ready':
      void pushInit(panel, currentTab);
      break;
    // 顶部刷新：碰撞 tab 清该档快照缓存后重算，其余 tab 重拉当前数据
    case 'refresh':
      if (currentTab === 'collision') {
        collisionCache.delete(currentCollisionDays);
        void pushCollision(panel, currentCollisionDays);
      } else {
        void pushInit(panel, currentTab);
      }
      break;
    case 'selectTab': {
      const tab = message.tab;
      if (VALID_TABS.indexOf(tab) !== -1) {
        currentTab = tab;
        void pushInit(panel, tab);
      }
      break;
    }
    // 模板进入「数据碰撞」tab 时索取数据；命中 60s 缓存时不会产生新请求
    case 'requestCollision':
      void pushCollision(panel, currentCollisionDays);
      break;
    case 'selectCollisionDays': {
      const days = Number(message.days);
      if (LQ_COLLISION_DAYS.some((d) => d.num === days)) {
        currentCollisionDays = days;
        void pushCollision(panel, days);
      }
      break;
    }
    case 'refreshCollision':
      collisionCache.delete(currentCollisionDays);
      void pushCollision(panel, currentCollisionDays);
      break;
    // 结果行「资金动态」→ 复用暗盘榜的个股命令
    case 'openStock': {
      const code = typeof message.code === 'string' ? message.code : '';
      if (!code) break;
      try {
        void commands.executeCommand('quote-pulse.stockFundFlowForStock', { id: code });
      } catch (e) {
        console.error('[量化面板] 打开个股资金动态失败', errMsg(e));
      }
      break;
    }
    default:
      break;
  }
}

/**
 * 打开量化面板。
 * @param tab 初始 tab：cjl 量价分层 / north 北向资金（默认）/ index 大盘指数 /
 *   collision 数据碰撞
 * @param code 可选个股代码（tab==='cjl' 时替代默认指数查询集合）
 */
export function quantPanel(tab: QuantTab, code?: string): void {
  if (VALID_TABS.indexOf(tab) !== -1) currentTab = tab;
  currentCode = typeof code === 'string' ? code : '';

  const panel = ReusedWebviewPanel.create(VIEW_TYPE, TITLE, ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  if (attached.has(VIEW_TYPE)) {
    // 复用已存在的面板：脚本仍在运行，主动按当前 tab 重推一次即可
    void pushInit(panel, currentTab);
    return;
  }

  attached.add(VIEW_TYPE);
  panel.onDidDispose(() => attached.delete(VIEW_TYPE));
  panel.webview.onDidReceiveMessage((message: any) => handleMessage(panel, message));
  panel.webview.html = getTemplateFileContent(TEMPLATE, panel.webview);
}

export default quantPanel;
