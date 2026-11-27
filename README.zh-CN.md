# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

面向 JavaScript 分析与浏览器依赖行为复现的 Agent 技能仓库，为 Cursor、Codex 及兼容的 Agent 宿主提供任务指导、本地工具、参考资料、案例和回归检查。

维护者：[John zxy](https://github.com/zxyanqing)

当前版本：**v1.6.0**。

## 项目作用

仓库包含两个可以独立使用、也可以按需配合的 skill：

| Skill | 解决的问题 | 典型交付 |
| --- | --- | --- |
| [`web-js-env-patcher`](web-js-env-patcher/SKILL.md) | 本地运行原始 JavaScript，定位其实际依赖的浏览器契约，修补相关环境，并按消费方反馈验证结果。 | 本地执行入口、环境实现、fixture，以及已验证行为的证据。 |
| [`js-ast-deobfuscate`](js-ast-deobfuscate/SKILL.md) | 基于 Babel AST 转换，提高授权 JavaScript 样本的可分析性，每项转换保留依据和保护条件。 | 恢复后的源码、转换报告、残留分析，以及有充分依据时生成的样本专用脚本。 |

`web-js-env-patcher` 从已经确定需要补环境的任务开始，保持目标原始逻辑，处理 DOM 状态、属性描述符、原型、Cookie、Storage、异步完成、Realm 归属、Worker 消息、Wasm 加载等依赖。实现深度由目标实际可观察的依赖决定。

`js-ast-deobfuscate` 先使用已注册的通用转换，分析剩余形态，再按依据选择带保护条件的样本专用脚本；不支持的形态与尚存的不确定性会保留在交付中。两个 skill 互不要求关闭对方，补环境也不要求先反混淆。

## 应用场景

适用于自建代码、明确授权的样本或公开练习目标，具体范围遵从各 skill 的要求。

| 场景 | 本项目如何提供帮助 |
| --- | --- |
| SDK 在浏览器正常，本地执行报错或结果不同。 | 关联环境读取、状态变化和实际消费边界，实现并检查目标依赖的契约。 |
| API 已存在，但 descriptor、原型、DOM 状态或 iframe 对象归属不一致。 | 定位对象可观察行为及跨 Realm 归属差异，并在组合环境中复验。 |
| Promise、timer、事件、Worker 或 Wasm 行为影响完成。 | 观察真实完成边界，修补目标实际使用的依赖。 |
| 维护时脚本、fixture、后端或环境补丁发生变化。 | 将资源哈希与运行时、fixture、配置、补丁身份关联，使实验可以追踪。 |
| 授权样本中的混淆表达式或控制流难以分析。 | 使用已支持的 AST 转换，分析残留并交付后续分析所需的源码和报告。 |
| 维护者需要回归依据，或希望比较 skill 的不同版本。 | 使用固定来源 SDK 案例和环境修复评测资产，分别衡量工具正确性与 Agent 实际效果。 |

## 开始使用

### 选择入口

通过 Agent 宿主支持的 skill 加载方式提供所需目录，入口分别为：

- 补环境：[`web-js-env-patcher/SKILL.md`](web-js-env-patcher/SKILL.md)。使用工具前先读 **Agent 安装 / 首次使用前置**。
- AST 反混淆：[`js-ast-deobfuscate/SKILL.md`](js-ast-deobfuscate/SKILL.md)。运行流水线前先读 **Agent install / first-use gate**。

提供已有脚本或样本、已知入口、观察到的差异、目标消费方或产物，以及可用的验证条件。未知项可以明确保留为未知，同时推进已有证据支持的工作。

例如，补环境任务可以这样描述：

> 这个已获授权的 SDK 在浏览器正常、本地执行失败。请运行原始脚本，定位并修补它依赖的 DOM、Cookie 和异步行为，用提供的测试消费方验证产物，记录已验证范围与尚未验证的部分。

### 按需安装依赖

仓库不提交 `node_modules`，Agent 应按所选 skill 的要求自行安装依赖。`web-js-env-patcher` 声明需要 Node.js 18 或以上；AST 运行时使用 Node.js ESM 与 Babel 依赖。

```bash
REPO="/absolute/path/to/SpiderJsReverseSkill"

# AST 流水线、检测或 fixture 运行前执行
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator"
npm install

# DOM/jsdom 示例、SDK 案例或补环境工具测试前执行
cd "$REPO/web-js-env-patcher"
npm ci --ignore-scripts
```

缺少 `node_modules`、出现 `Cannot find module 'jsdom'` 或 Babel 解析依赖错误时，应先解决安装问题，再诊断目标。无 DOM 的补环境任务可以不安装 jsdom。native addon 与 xbs 资产按任务、平台和 ABI 选用，不是每个任务的前置。

### 本地案例与检查

在 skill 目录运行补环境工具回归：

```bash
cd "$REPO/web-js-env-patcher"
npm test
```

固定来源 SDK 案例需指定一个尚不存在的绝对输出目录，其父目录必须已存在。准备步骤下载并校验固定的公开资产，本地案例无需外部 MCP 服务。

```bash
node cases/fingerprintjs-local/prepare.mjs --output /absolute/work/fp-assets-001
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001
```

依赖、错误注入和模拟边界见 [案例说明](web-js-env-patcher/cases/fingerprintjs-local/README.md)。AST 使用方法与回归命令见 [AST README](js-ast-deobfuscate/README.md) 和 [命令参考](js-ast-deobfuscate/references/commands.md)。

## 目录结构

```text
SpiderJsReverseSkill/
├── README.md / README.zh-CN.md
├── web-js-env-patcher/
│   ├── SKILL.md                 补环境工作流
│   ├── references/              契约、取证、验收与交付规范
│   ├── scripts/                 诊断、准备与验证工具
│   ├── assets/                  运行后端、示例与可选 addon
│   ├── cases/                   固定来源真实 SDK 案例
│   ├── evals/                   环境修复 Agent 评测资产
│   └── tests/                   工具与行为回归
└── js-ast-deobfuscate/
    ├── SKILL.md                 AST 工作流与转换规则
    ├── references/              能力矩阵与形态参考
    ├── scripts/                 轮次执行、分析与窄脚本脚手架
    ├── evals/                   AST skill 评测定义
    └── tools/deobfuscator/      Babel 运行时、注册转换与 fixture
```

## 案例、评测与开源分发

[`cases/`](web-js-env-patcher/cases/README.md) 用少量固定来源的真实 SDK 检查环境组合。当前案例以源码 commit 和压缩包哈希固定 FingerprintJS 5.2.0，在 jsdom 页面 Realm 中加载，检查异步完成、组件错误、iframe 函数与对象归属、宿主清理。案例包含本地垫片，其结果描述的是这一模拟环境。

[`evals/`](web-js-env-patcher/evals/README.md) 用于维护期评估 Agent 能否定位、修复并复验环境缺陷，包含七个场景、可运行工作区、评分侧故障信息、版本化评分规则和版本对比协议。普通补环境任务不要求先运行它，本次交付也不包含完整的 Agent 自动执行与调度系统。

评测运行应使用文档规定的 [隔离启动器](web-js-env-patcher/evals/isolation.md)。当前实现通过 macOS 的 `sandbox-exec` 使用 Seatbelt；只准备文件或改变工作目录不能证明隔离。其他平台需要另行实现并验证隔离路径。

案例与评测源码、配套脚本、测试和引用文档应纳入 Git。下载的上游压缩包、vendor 树、`node_modules`、缓存和运行输出应放在仓库外或明确的忽略目录中。普通用户的精简安装包可以裁剪维护资产，同时调整引用和对外声明的能力。

`evals/hidden/` 表示评测运行时仅评分者可见；提交到公开仓库后，它属于公开回归资料。需要未公开题目与答案的评测时，可以另设私有保留题集。

## 版本迭代

### v1.6.0 — 2026-11-27：环境复现与评测能力完善

本次发布集中在 `web-js-env-patcher`，对比基线为上一已提交版本 `4144462`（2026-11-24）。仓库版本与 Git 标签均为 `v1.6.0`；`js-ast-deobfuscate` 本次发布没有代码变化。

| 方面 | 上一版本 | 本次改进 |
| --- | --- | --- |
| 复现身份 | 已有资源哈希、fixture 来源和变更记录。 | 在现有资源清单中关联并分开记录 runtime、fixture、配置和环境补丁身份；新 case 模板包含该结构，旧 case 保持兼容。 |
| 真实 SDK 覆盖 | 主要通过工具测试与合成样例验证。 | 新增固定来源 FingerprintJS 案例、准备与哈希校验、页面 Realm 执行及有意义的错误注入。 |
| Agent 评测资产 | 已有评测原则，缺少同类可复用的环境修复场景包。 | 新增七个场景、过程与正式路径评分门闸、评分侧资料及版本对比协议。 |
| 评测准备与隔离 | 未提供同类评测准备与隔离工具链。 | 新增 Agent／skill 分离副本、基于字节的内容身份与重建检查，以及经主进程、子进程、链接和工作区外临时目录答案读取反例验证的 macOS 启动器。 |
| 证据有效性 | 主要通过文档约束浏览器证据和 Hook 生命周期。 | 新增可编程生命周期检查；上下文、计数、采集窗口或截断状态未知时，不能证明未调用；跨上下文复用需要结构化明确许可。 |
| Realm 与清理回归 | 已有 Hook 和组合自检。 | 新增页面／子 Realm 函数与对象检查、宿主污染反例、残缺控制句柄拒绝，以及真实 Hook 按 Realm 卸载复验。 |

本次记录的验证结果：补环境工具回归 **162/162 通过**，另有 **11/11 独立验收测试通过**，其中包含原六项反例；独立检查还覆盖 1,458 个结构化许可组合和内容重建。这些数字说明已验证的实现范围，尚未进行新旧 skill 的 Agent 实际效果对照实验。

### 2026-11-24：首次开源基线

首次提交 `20fcb28` 提供两个 skill、补环境工具与参考资料，以及随包 AST 运行时和回归 fixture；后续 README 更新形成对比基线 `4144462`。

## 如何理解验证结果

- 工具测试或 SDK 模拟通过，只证明该检查覆盖的行为；消费接受、稳定性和数据真实性按补环境 skill 的 [验收规范](web-js-env-patcher/references/validation.md) 分别记录。
- jsdom 提供其支持的 DOM 语义；布局、图形、设备读数等能力需要按目标补充实现或取得证据。
- AST 报告描述已支持的转换和残留，一次运行成功不承诺完整恢复所有混淆形态。
- 遵守各 skill 的授权与在线操作规则；证据不足的部分在最终交付中保留为未验证。

## 致谢与许可证

`web-js-env-patcher` 改编自 [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill)。固定来源案例在准备说明及相关文件中记录上游身份与声明。

MIT © John zxy — 见 [LICENSE](LICENSE)。
