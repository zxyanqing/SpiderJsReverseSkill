# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

面向 Cursor / Codex 等 Agent 的 Web/JS 逆向相关技能仓库。按任务选用对应 skill，互不要求关闭其他 skill。

维护者：[John zxy](https://github.com/zxyanqing)

## 包含的技能

### 1. `web-js-env-patcher` — Web JS 补环境

在本地运行网站**原始** JS，定位并修补浏览器环境差异，按真实消费方反馈验收产物。

- 入口：`web-js-env-patcher/SKILL.md`（agent 请先读 **Agent 安装 / 首次使用前置**）
- 改编自：https://github.com/lwjjike/xbsReverseSkill

### 2. `js-ast-deobfuscate` — JS AST 反混淆

基于 Babel AST 的分层反混淆（方案 A：REGISTRY；方案 B：样本范围窄脚本，按需）。

- 入口：`js-ast-deobfuscate/SKILL.md`（agent 请先读 **Agent install / first-use gate**）
- 运行时：`js-ast-deobfuscate/tools/deobfuscator`

## Agent：运行依赖（请自行执行）

仓库**不**包含 `node_modules`。本仓库对 agent 可用后，按 skill 需要自行安装依赖。

```bash
REPO="<本仓库路径>"

# 1) js-ast-deobfuscate — 跑任何流水线前必须执行
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator" && npm install

# 2) web-js-env-patcher — 需要 DOM/jsdom 示例或 npm test 时执行
cd "$REPO/web-js-env-patcher" && npm ci --ignore-scripts
```

给 agent 的规则：

- 出现缺少 `node_modules` / `Cannot find module 'jsdom'` / Babel 解析失败 → 按上面安装；不要当成目标站环境缺陷。
- `web-js-env-patcher` 无 DOM 时可跳过步骤 2；一旦跑 jsdom 示例、里程碑或 `npm test`，必须先做步骤 2。
- `web-js-env-patcher/assets/` 下的 native addon / xbs 按平台与任务选用，非每个任务前置。

## 说明

- 研究/工程向技能；遵守各 skill 内的授权与在线护栏。
- 工具检查通过 ≠ 网站接受。

## 许可证

MIT © John zxy — 见 [LICENSE](./LICENSE)。

`web-js-env-patcher` 改编自 https://github.com/lwjjike/xbsReverseSkill。
