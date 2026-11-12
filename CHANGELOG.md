# Changelog (quote-pulse)

本 CHANGELOG 仅记录 `quote-pulse`（行情脉冲 QuotePulse）本仓库的独立改动，与原版 LeekFund 无关。

## Unreleased

### Changes
- 量化面板新增「API Key」输入入口：面板内保存到用户级设置并立即清缓存重试，状态只回显掩码，密钥不进安装包；失败空态可直接跳转填写
- 数据碰撞摘要展示服务端快照时间与过期标记（服务端策略数据改为每 4 小时刷新）
- 命名空间统一为 `quote-pulse.*`：44 个命令 id、30 个配置键、菜单/欢迎页/激活事件及模板、文档全部更名，与扩展 id 对齐；view id `leekFundView.*` 暂保留以维持侧栏布局
- 新增一次性配置迁移：激活时把旧命名空间下有值的用户设置逐项复制到同名新键（仅当新键尚未配置），旧键保留便于回滚；命令 id 不留旧别名，旧键位需重绑
- 重建 `leek-center` 前端产物，修复其 `setFundAmount` 消息误用旧命令名的问题
- 迁移到独立仓库 `inyuo/quote-pulse`，发布者由 `inyuo-fork` 改为 `inyuo`
- 品牌更名为「行情脉冲（QuotePulse）」，扩展 id 改为 `quote-pulse`；移除遥测上报与 `amplitude` / `public-ip` 依赖
- 去除「韭菜盒子」相关品牌文案、打赏入口、社区入口与上游图标

### Removed
- **期货模块整体下线**：国内（`nf_`）与海外（`hf_`）期货的行情解析、树分类、搜索、计数、配置项与相关样式全部移除；老配置里遗留的期货代码会被静默过滤

## 1.0.0 (2026-08-03)

### Features
- 基金估值数据源由下线的天天基金接口迁移至新浪行情接口（GBK 解码 + Referer 验证）
- 扩展 id 由 `leek-fund` 重命名为 `investment-monitor`，避免与原版 Marketplace 扩展冲突

### Changes
- 快讯服务（金十/选股宝）输出与抽象层适配
- `leek-center` 前端路由与 App 入口调整
- `.gitignore` 补充 `.codebuddy/`、子目录 `node_modules`、构建产物等忽略项
