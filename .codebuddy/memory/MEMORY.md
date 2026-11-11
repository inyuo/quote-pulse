# 长期记忆 (MEMORY.md)

> 下方「leek-fund-old」章节是 2026-08-03 及更早的历史记录（远端 `leek-fund-new`、扩展名 `investment-monitor` 等），**当前状态以本节为准**。

## 当前状态（2026-11-11）

- **本仓库**：`quote-pulse`（行情脉冲 QuotePulse），GitHub `inyuo/quote-pulse`，活跃分支 `dev`；发布者 `inyuo`、版本基线 `1.0.0`。打包必须走 `yarn package` → `quote-pulse-1.0.0-<时间戳>.vsix`（自动清理旧包）；直接 `node scripts/package.js` 会报 `vsce: command not found`。
- **服务端是另一个独立仓库**：Gitee 私有 `https://gitee.com/inyu_admin/invest-monitor.git`（本机 `/Users/jinyu/WorkSpace/invest-monitor`，服务器 `124.71.128.214:/root/.hermes/invest-monitor`）。`qp_service/` 数据服务以 Blueprint 挂进该 Flask 应用，端口 8800；插件通过 `leek-fund.dataApiBaseUrl` / `dataApiKey` + `/api/v1/*` 只读调用。2026-11-11 起插件**彻底删除扫码登录与本地直连降级**，服务端不可用时需登录数据直接空态。两仓库无 submodule，**改数据服务不要在本工作区找 `qp_service/`**。
- **量化面板**（2026-11-11 重构）：入口在 `Settings` 分栏「个性定制」之后；4 个 tab `cjl/north/index/collision`，默认 `north`；数据碰撞走服务端 `/api/v1/quant/collision` 预计算快照，插件侧做标签筛选/搜索/排序；`src/shared/lqData.ts` 与服务端 `qp_service/collide.py` 的标签口径须一致。
- **服务器旧改动保留在 Gitee 分支 `server-local-20261110`**（`7f83000`、`a873d9d`），未合并 master；全量备份 `/root/backup/invest-monitor-worktree-20261110.tar.gz`。master 基线 `718126e`。
- **密钥/凭据**：服务器 `/etc/qp-data-service.env`（600）存 API Key、Flask secret、Fernet key、应急密码哈希；不进仓库。Gitee 凭据在服务器 `credential.helper=store` / 本机钥匙串。
- **网络**：本机 GitHub 直连不通，push 需 `https_proxy=http://127.0.0.1:7897`；Gitee 直连可用；服务器公网仅放行 `22/8888/6700/7863/5532/6699/8800`。
- **自动推送**：每次代码变更后自动 commit + push（两个仓库都适用）。
- **详细日志**：[2026-11-10](2026-11-10.md)（数据服务搭建、关联关系处理、验证结果）、[2026-11-11](2026-11-11.md)（量化面板重构口径、改动清单与验证）。
- **`.codebuddy/` 自 2026-11-11 起不再被 `.gitignore` 忽略**，整个目录（含历史日记 `2026-07-27.md` / `2026-08-01.md` / `2026-08-03.md`）纳入版本库，后续新增记忆文件直接 `git add` 即可。

## 项目：leek-fund-old（VS Code 扩展 LeekFund / 韭菜盒子）
- 技术栈：TypeScript 扩展，`yarn` 管理；`src/` 为扩展主代码，`template-packages/leek-center` 为韭菜中心 React 前端（CRA，prepublish 时 build 到 `template/leek-center/build`）。
- **`package.json` 现在是严格 JSON（无尾逗号、无注释）**：原项目曾用 JSONC，但 `vsce package` 用严格 `JSON.parse` 会报 `not a valid JSON file`。2026-07-27 已转为严格 JSON 以便打包。未来编辑此文件**不要加尾逗号/注释**，否则 `vsce` 打包失败（VS Code 运行时仍兼容严格 JSON）。
- 打包命令：`npx vsce package`；安装：`code --install-extension investment-monitor-x.y.z.vsix` 或 VS Code 内 `Extensions: Install from VSIX...`。
- 数据接口现状（2026-07-27）：基金估值数据源已从下线的天天基金 `fundgz.1234567.com.cn` 迁移到新浪 `hq.sinajs.cn/list=fu_{code}`（GBK 解码 + `Referer: https://finance.sina.com.cn`），详见 2026-07-27 日记。
- **远端仓库**：`https://github.com/inyuo/leek-fund-new.git`（origin 已配置，含 `master`/`dev_v1` 分支，911+ 提交真实历史）。
- **⚠️ 本地 `master` 与远端完全分叉**（本地孤立起点 `d3ce0f8`）。**绝不要直接 `git push` 本地 master**（会丢远端历史/被拒）。正确做法：基于 `origin/master` 新建功能分支再推送开 PR。
- **当前活跃分支**：`dev`（基于 `origin/master` + 功能改动 cherry-pick，2026-08-03）。
- **版本基线**：已重置为 `1.0.0`（与上游 3.24.0 解耦），name=`investment-monitor`，publisher=`inyuo-fork`。
- **Release 工作流**：`.github/workflows/release.yml` — push `v*` tag → 自动构建 `yarn compile && yarn package` → 上传 `investment-monitor-*.vsix` 为 Release asset。
- **发版流程**：`yarn release`（standard-version bump 版本 + 打 v* tag + 更新 CHANGELOG）→ `git push --follow-tags origin dev` → GitHub Action 自动产出 Release。
- **git push 网络问题**：特定环境下需 `GIT_HTTP_VERSION=1.1 git push`（默认 HTTP2 协商失败）。
- **AI 配置不入包**：API Key 等通过 `workspace.getConfiguration('leek-fund.aiConfig')` 存于 VS Code 本地 settings，不会打包进 .vsix。

## 用户偏好
- 用中文对话与回答。
- 数据/可视化任务优先用 plotly（交互式），必要时 seaborn/matplotlib 兜底。
