# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

**给爬虫工程师与 JS 逆向学习者用的 Agent Skill 仓库。**  
面向 Cursor / Codex 等 AI 编码助手：把网站里生成 **Cookie、签名、加密参数、动态 token** 的原始 JS，放到 **Node 本地补环境**跑通，并用真实消费方反馈验收；需要时再用 **AST 反混淆**把脚本摊开分析。

维护者：[John zxy](https://github.com/zxyanqing)  
当前版本：**v1.6.0**

---

## 为什么爬虫 / JS 逆向会需要它

做 Web 爬虫时，难点常常不在发请求，而在：

- 参数、Cookie、签名只在浏览器里由 **JS 算出来**
- 脚本做了 **环境检测 / 指纹 / DOM / 异步**，Node 里直接跑就挂或结果不对
- 代码 **混淆**严重，入口和调用链看不清
- 本地「能跑出一个值」≠ **接口真的认**

本仓库把两件事做成可给 Agent 直接执行的 skill：

| 你卡在哪 | 用哪个 skill | 它帮你做什么 |
| --- | --- | --- |
| 浏览器能过，本地跑原始 JS 报错 / 产物不被认 | [`web-js-env-patcher`](web-js-env-patcher/SKILL.md) | **补环境**：保留网站原始逻辑，补齐 DOM、Cookie、Storage、指纹读数、Realm、异步、Worker、Wasm 等依赖，按消费方是否接受验收 |
| 混淆太重，先要读懂结构 / 控制流 / 字符串 | [`js-ast-deobfuscate`](js-ast-deobfuscate/SKILL.md) | **AST 反混淆**：Babel 流水线 + 证据与护栏；不够再生成样本范围窄脚本 |

两者可单独用，也可配合：**先反混淆看清入口 → 再补环境本地出参验收**。不必为了「还原算法」而还原——目标是拿到可复现、可验证的本地执行路径。

---

## 关键词（检索 / 对号入座）

`爬虫` · `JS逆向` · `补环境` · `jsdom` · `Cookie` · `签名` · `加密参数` · `动态参数` · `token` · `指纹` · `Fingerprint` · `反混淆` · `AST` · `控制流平坦化` · `本地复现` · `消费方验收`

适用任务类型（按样本逐一分析，不保证某一固定站点/版本开箱即过）：

| 场景 | 本项目如何帮你 |
| --- | --- |
| **某数** 3 / 4 / 5 / 6 代相关脚本的补环境 | 围绕加载、入口、浏览器检测、Cookie/状态、异步依赖，本地跑原始脚本并验证产物 |
| **某验** 加密 / 参数生成相关脚本的补环境 | 定位 DOM、指纹、对象行为、时间与随机等真实依赖，实现后复验 |
| **某里** 加密 / 参数相关脚本的补环境 | 分析初始化、环境读取、事件与异步链、Cookie/Storage 与参数消费，形成可复现本地路径 |
| 其他依赖浏览器生成 Cookie / 签名 / token / 请求参数的脚本 | 保持生成逻辑，修环境差异，关联输入→环境→产物→消费结果 |
| SDK 浏览器正常、本地失败或结果不一致 | 对齐环境读取、状态变化与消费边界 |
| 混淆导致难以定位入口与调用链 | 用已支持的 AST 转换提高可读性，交付源码与残留报告 |

> 上表名称描述**任务类型**，不是对某一商业产品的专项绕过承诺。完成以该任务声明的验收条件与真实反馈为准。

---

## 仓库里有什么

```text
SpiderJsReverseSkill/
├── web-js-env-patcher/     # 补环境主 skill（工作流、契约、脚本、运行时资产、回归）
└── js-ast-deobfuscate/     # AST 反混淆 skill（REGISTRY、形态分析、窄脚本脚手架）
```

`web-js-env-patcher` 改编自 [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill)，在通用补环境方法、验收与工程资产上做了改版强化。

---

## 开始使用

### 1. 选入口

把对应 skill 目录提供给 Agent 宿主（按你使用的 Cursor / Codex 等工具的 skill 加载方式即可）。

- 补环境 → [`web-js-env-patcher/SKILL.md`](web-js-env-patcher/SKILL.md)（先读文内 **Agent 安装 / 首次使用前置**）
- 反混淆 → [`js-ast-deobfuscate/SKILL.md`](js-ast-deobfuscate/SKILL.md)（先读 **Agent install / first-use gate**）

任务里尽量带上：原始 JS / 样本、已知入口、浏览器侧现象、目标产物与消费方式、授权范围。未知项可标明「未知」并继续推进。

示例提示词：

> 使用 web-js-env-patcher，为已获授权的某数第 6 代样本做补环境。原始 JS、入口与浏览器请求样本已提供。请在本地运行原始脚本，定位 DOM / Cookie / 指纹 / 异步依赖，生成目标产物，并按给定消费条件复验；记录已验证与未验证项。

### 2. 按需安装依赖（Agent 自行执行）

仓库**不**提交 `node_modules`。缺包时先装依赖，再诊断目标。

```bash
REPO="/absolute/path/to/SpiderJsReverseSkill"

# 反混淆流水线前必做
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator" && npm install

# 补环境涉及 DOM/jsdom 或 npm test 时
cd "$REPO/web-js-env-patcher" && npm ci --ignore-scripts
```

- `Cannot find module 'jsdom'` / Babel 解析失败 → 安装问题，不是「网站环境缺 API」。
- 无 DOM 的补环境任务可不装 jsdom。
- native addon / xbs 按任务与平台选用，非每个任务前置。

### 3. 本地工具回归（可选）

```bash
cd "$REPO/web-js-env-patcher" && npm test
```

工具绿 ≠ 目标站接受。任务仍须跑原始脚本并看消费反馈。AST 用法见 [js-ast-deobfuscate/README.md](js-ast-deobfuscate/README.md)。

---

## 如何理解结果

- **补环境**：消费接受 / 稳定性 / 数据真实性分开报；默认验收见 [`validation.md`](web-js-env-patcher/references/validation.md)。
- **jsdom** 只管其支持的 DOM 语义；布局、图形、设备读数等按目标另补。
- **AST**：报告写清已做转换与残留；一次成功不承诺解开所有混淆家族。
- 仅用于自有、明确授权或公开练习目标；遵守各 skill 的在线护栏。

---

## 版本迭代

### v1.6.0 — 2026-11-27：补环境复现与证据校验

对比基线 `4144462`（2026-11-24）。本版主要增强 `web-js-env-patcher`（复现身份、组合行为、证据生命周期、Realm/Hook 清理回归）。记录：**162/162** 工具测试、**11/11** 独立验收通过。场景举例不代表已逐站逐版本验收。

### 2026-11-24：首次开源基线

首次提交提供两个 skill、补环境工具链与 AST 运行时。

---

## 致谢与许可证

`web-js-env-patcher` 改编自 [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill)。

MIT © John zxy — 见 [LICENSE](LICENSE)。
