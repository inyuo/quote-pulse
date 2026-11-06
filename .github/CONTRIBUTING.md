# 参与行情脉冲（QuotePulse）的开发

## 这是什么项目

行情脉冲（QuotePulse）是一个 VS Code 扩展，在编辑器侧边栏里实时展示基金、股票的行情、盈亏、资金流与资讯数据。

本项目派生自上游 [LeekHub/leek-fund](https://github.com/LeekHub/leek-fund)，遵循 **BSD-3-Clause** 协议。上游的版权声明与免责声明完整保留在仓库的 `LICENSE` 与源码版权头中，本项目与上游官方无任何隶属关系。

## 兼容性硬约束（改代码前必读）

为了让已安装老版本的用户升级后**配置不丢失**，以下标识属于对外契约，**任何 PR 都不得修改**：

| 类型 | 前缀 / 取值 | 说明 |
| --- | --- | --- |
| 命令 id | `leek-fund.*` | 用户键位与 `keybindings.json` 依赖它们 |
| 侧边栏 view id | `leekFundView.*` | 视图容器依赖它们 |
| 配置键 | `leek-fund.*`、`investment-monitor.*` | 用户 `settings.json` 里已写入这些键 |

这些约束由 `test/extension-identity.test.js` 强制校验，改动会让 CI 直接失败。如果确实需要新增能力，请使用**新的**前缀（如 `quote-pulse.*`）并保持老键可用。

## 环境准备

```bash
# 安装依赖
yarn install

# Node 版本建议与 CI 一致（Node 18）
node -v
```

## 常用命令

```bash
yarn lint          # ESLint（会自动修复）
yarn compile       # TypeScript 编译到 out/
yarn test:unit     # 单元测试（mocha）
yarn check:manifest # 校验 package.json 的 contributes 与 src 注册一致
yarn package       # 打包 VSIX
```

改动 webview 页面（`template-packages/leek-center`）后需要重新构建模板，否则打包产物仍是旧页面。**全新 clone 时该构建产物目录为空**（被 `template-packages/leek-center/.gitignore` 忽略，不入仓库），不构建则「行情中心」会提示「请检查模板文件是否存在」：

```bash
yarn --cwd ./template-packages/leek-center install
yarn --cwd ./template-packages/leek-center run build
```

`yarn compile`（通过 `postcompile` 钩子）和 `yarn package`（通过 `vscode:prepublish`）都会自动执行上述模板构建，只有直接 F5 调试前需要手动跑一次。

## 分支策略

- `main`：主分支，只接受来自 `dev` 的合并，发布版本打 `v*` tag 触发自动打包
- `dev`：日常开发分支，从 `main` 切出功能分支

```bash
git checkout dev
git pull origin dev
git checkout -b feature/your-topic
```

## 提交规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

- type: feat | fix | docs | style | refactor | test | chore | revert
- scope: 使用中文小写，如「期货」「行情中心」
- body: 每行不超过 100 字符
```

## 提交 Pull Request

1. 从 `dev` 切出功能分支并完成改动
2. 本地跑通 `yarn lint && yarn test:unit && yarn package`
3. 推送分支：

   ```bash
   git push -u origin HEAD
   ```

4. 打开 [行情脉冲仓库](https://github.com/inyuo/quote-pulse) 发起 Pull Request，目标分支选择 `dev`
5. 维护者会 review 并给出修改意见或直接合并

较大的改动建议**先开 issue 讨论**再动手，避免做无用功。

## 需要帮助？

- 问题反馈：[Issues](https://github.com/inyuo/quote-pulse/issues)
- 讨论：[Discussions](https://github.com/inyuo/quote-pulse/discussions)

## 行为准则

本项目采用 [Contributor Covenant](https://www.contributor-covenant.org/) 作为行为准则，请阅读 [完整文本](/CODE_OF_CONDUCT.md) 了解哪些行为被接受、哪些不被接受。
