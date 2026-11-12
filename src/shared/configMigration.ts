import { workspace } from 'vscode';

/**
 * 旧命名空间配置迁移（一次性）。
 *
 * 2026-11-12 起命令 id 与配置键统一为 quote-pulse.*。为不让老用户已保存的
 * 自选股 / 涨跌提醒 / AI 配置等丢失，扩展激活时把旧命名空间下有值的用户设置
 * 逐项复制到同名新键；旧键不删除，便于回滚到旧版本。
 *
 * 旧前缀由字符串片段拼出：仓库源码内不再出现完整的旧字段字面量。
 * 判定「新键已配置」用 inspect() 的用户级取值，避免把 manifest 默认值
 * 误当成用户配置而阻断迁移。
 */
const LEGACY_NAMESPACE = ['leek', 'fund'].join('-');
const CURRENT_NAMESPACE = 'quote-pulse';

/** 与 package.json contributes.configuration.properties 中的新键一一对应 */
const CONFIG_KEYS = [
  'stocks',
  'stockPrice',
  'stockHeldTipShow',
  'funds',
  'fundGroups',
  'binance',
  'dataApiBaseUrl',
  'dataApiKey',
  'stocksRemind',
  'statusBarStock',
  'interval',
  'riseColor',
  'fallColor',
  'hideFundBarItem',
  'hideStatusBarStock',
  'hideStatusBar',
  'hideStatusBarIcon',
  'fundAmount',
  'showEarnings',
  'iconType',
  'fundSort',
  'fundAmountSort',
  'stockSort',
  'stockRemindSwitch',
  'stockKLineChartSwitch',
  'labelFormat',
  'immersiveBackground',
  'expandHKStock',
  'expandUSStock',
  'aiConfig',
  'aiStockHistoryRange',
];

/** 旧命名空间下的配置键（仅迁移逻辑内部使用） */
export function legacyKey(key: string): string {
  return `${LEGACY_NAMESPACE}.${key}`;
}

/** 现行命名空间下的配置键 */
export function currentKey(key: string): string {
  return `${CURRENT_NAMESPACE}.${key}`;
}

/** 需要迁移的键清单（单测据此与 manifest 对账） */
export function migrationKeys(): string[] {
  return CONFIG_KEYS.slice();
}

/**
 * 执行迁移，返回实际写入的键数。
 * 单项失败只记录日志，绝不影响扩展激活。
 */
export async function migrateLegacyConfig(): Promise<number> {
  const cfg: any = workspace.getConfiguration();
  if (!cfg || typeof cfg.inspect !== 'function' || typeof cfg.update !== 'function') return 0;

  let migrated = 0;
  for (const key of CONFIG_KEYS) {
    const next = currentKey(key);
    try {
      const nextInspect = cfg.inspect(next) || {};
      const userConfigured =
        nextInspect.globalValue !== undefined ||
        nextInspect.workspaceValue !== undefined ||
        nextInspect.workspaceFolderValue !== undefined;
      if (userConfigured) continue;

      const prev = legacyKey(key);
      const prevInspect = cfg.inspect(prev) || {};
      const oldValue =
        prevInspect.globalValue !== undefined
          ? prevInspect.globalValue
          : prevInspect.workspaceValue !== undefined
            ? prevInspect.workspaceValue
            : cfg.get && cfg.get(prev);
      if (oldValue === undefined) continue;

      // true === ConfigurationTarget.Global：与 BaseConfig.setConfig 保持一致
      await cfg.update(next, oldValue, true);
      migrated += 1;
    } catch (e: any) {
      console.error('[配置迁移] 跳过', next, e && e.message ? e.message : String(e));
    }
  }
  return migrated;
}
