---
name: web-js-env-patcher
description: Run original website JavaScript locally, diagnose browser-environment differences, and iteratively repair and validate the resulting output against its actual consumer. Use for local WebAPI, DOM, async, Realm, Worker, Wasm, fingerprint, and in-script network dependencies.
---

# Web JavaScript 补环境

## Agent 安装 / 首次使用前置

仓库**不**包含 `node_modules`。软链或拷贝本 skill 目录即完成「安装识别」；下列依赖按需由 agent **自行安装**，不要等用户提醒。

1. **DOM / jsdom 路径、跑 `assets/examples/` 下 jsdom 示例、或 `npm test`：** 在本 skill 根目录执行 `npm ci --ignore-scripts`（或 `npm install`）。缺 jsdom 包时先装再跑，禁止把 `Cannot find module 'jsdom'` 当作环境缺陷去补。
2. **无 DOM、只用 vm/脚本诊断：** 可不装 jsdom。
3. **随包 native addon / xbs：** 已在 `assets/`；按平台与任务选用，不是每个任务的前置。加载失败时换实现或记能力缺口，见 `references/runtime-frameworks.md`。

唯一工作目标是让本地运行原始网站 JS 产生目标消费方接受的结果。网站当前可观察行为提供依据；接口实现、探针、日志、报告均服务于这一目标。浏览器用于取证及按需开展受控替换诊断，默认交付本地运行路径；任务范围与交付方式遵从用户要求。

完成以任务声明的验收等级为准，**默认为 L2**（消费接受 + 稳定性；真实性独立标注，见 `references/validation.md`）；单次接受只算定位进展，不算完成。不以异常清零、API 数量、固定等待或报告数量判断。汇报须分 **实现/定位/接受** 三状态，以及 **消费接受/稳定性/数据真实性** 三维度。三类进展分开记录：实现进展（真实缺陷已修）、定位进展（解释被支持/削弱或范围缩小）、接受反馈（当前本地产物是否被消费方接受）。

## 自主推进与授权

用户授权任务或一轮工作后，自主选择观察、实现、排错、验证和调整；常规技术选择不转交用户。用户采用逐轮授权时，跨轮启动由用户决定，轮内持续推进；没有逐轮约定时，不自行增加审批。交接细则见 `references/workflow.md`。

任务明确只审查时，不获得写入授权，未修复事项保留为未完成。遇到无法自行解除的外部阻塞时，记录具体阻塞，继续做不依赖它的工作。预算、在线护栏、路线退出是这些自主规则的边界，见下文「预算、护栏与路线退出」。

## 核心决策

1. **先确认当前路径。** 尽早运行原始代码；关联加载、调用、状态变化、产物和实际消费。历史报告是线索，资源或会话变化后重检受影响假设。
2. **选择能改变判断的动作。** 区分三类进展；提出可区分的候选解释，按影响、证据与验证成本选择实验；一次实验可覆盖同一契约的关联行为。
3. **实现并检查组合结果。** 标准行为优先成熟实现；设备读数与会话动态值另行处理。涉及 DOM 标准能力时优先 jsdom（不承担布局/图形/设备读数，见 `references/runtime-frameworks.md`）。jsdom 作语义后端承担状态，公开层按浏览器反射契约包装，深度由目标实际检测决定。扩展能力按依赖选择；改动后做相称自检，见 `references/integration-self-check.md`。
4. **跨层画像保持一致。** 同一正式路径上，JS 环境读数、HTTP 头/Client Hints、TLS 指纹、以及时区语言与出口语境等，凡被启用的都须像同一客户端；禁止各层单独修对、组合自相矛盾。细则与核对时机见 `references/fingerprint.md`。
5. **自主选择验证方式。** 本地与在线均可用于发现问题、区分原因和验证修复。需要网站接受时取得真实反馈；不可取得则保留未验收。本地检查不等于网站接受，见 `references/validation.md`。
6. **及时从整体复核。** 局部修复增多但主因不清、相同反馈无法区分、组合退化时，重检入口、分支、产物边界与运行方案。自主换实验或局部后端，不按固定失败轮数等待人工指路。

## 默认主线

没有更好的依据时按此推进；可以跳步、回退或并行，顺序只是默认值。

**启动支路：** 无法取得浏览器 DOM、远程调试超时或导航失败时，只要已有原始 HTTP HTML、脚本、请求样本或目标消费方，**直接进入本地路径**。浏览器证据是可选对照，不是本地运行前置条件。→ `references/workflow.md`「无浏览器 / 本地启动」

1. **明确目标**：接受条件、消费方、交付方式。未知项记为未知，继续推进。→ `references/records-and-delivery.md`
2. **定位入口与消费点**：从请求、Cookie、Storage、导航反推写入者与入口。已有可靠入口时跳过。→ `references/browser-evidence.md`、`references/hook-templates.md`
3. **首跑原始 JS**：涉及 DOM 时用 **jsdom 创建页面 Realm**（非 vm「获取」页面 Realm）；起步可先跑 DOM 里程碑（页内双同步脚本，见 `assets/examples/jsdom-dom-milestone.js`）。正式页按原始脚本语义调度，禁止一律文档序串行。不可信页内执行须 OS/外部边界；`node:vm`/子进程不是安全隔离。无 DOM 时用 vm，不强制 jsdom；需 HTMLDDA/内部槽再加 addon。用了 jsdom 则初始化后跑特征自检。先基线再按需追踪，正式验收无诊断钩子；记录静默探测。→ `references/runtime-frameworks.md`、`references/fixture-and-trace.md`、`references/env-discovery.md`、`references/integration-self-check.md`
4. **补最小契约**：只补有访问证据或已验证结构的契约；按存在性/类型/结构/值分类，禁止无证据堆常见 API。→ `references/env-discovery.md`、`references/env-object-model.md`、`references/integration-self-check.md`
5. **对照**：相同输入下比较本地与浏览器产物或行为；隔离单项能力时用受控替换。→ `references/fixture-and-trace.md`、`references/controlled-substitution.md`
6. **交给真实消费方**：出站前按需核对跨层画像与 **同会话原子输入**（见 `references/fingerprint.md`、`references/network-session.md`）；记录产物来源、发送内容与响应，遵守在线护栏。→ `references/network-session.md`
7. **被拒或没有进展**：先走被拒后总复核八项清单，再决定是否补环境；触及复核信号或预算时做宏观复核。→ `references/env-debug-loop.md`、`references/workflow.md`

## 环境发现协议

静默缺失与存在性/形状探测、四类补环境错误、最小契约与反过度补环境、保持缺失/过度暴露、从零首轮模板、基线/追踪/正式三模式，见 `references/env-discovery.md`。正式验收不得携带访问追踪包装；追踪结果不能单独证明未插桩等价。

## 属性值来源与画像闭包

画像字段按值来源优先级取证；UA/CH/TLS/语言/时区/平台/`navigator` 须同一具名配置与版本；跨层自洽细则见 `references/fingerprint.md`。

## 无浏览器模式

浏览器不可用时仍可从 HTML/脚本/请求样本与消费方推进：jsdom 建页面 Realm → 按里程碑或正式页规则跑脚本 → 静默探测与最小补丁 → 消费方验收。浏览器不是启动前置。完整路径见 `references/workflow.md`「无浏览器 / 本地启动」。

## 按信号查文档

| 信号或情境 | 文档 |
| --- | --- |
| 开始、恢复任务，宏观复核，预算与交接，无浏览器本地启动；按需脚本排除见 `references/script-exclusion.md` | `references/workflow.md` |
| 静默缺失、存在性/形状探测、四类错误、首轮模板、追踪 vs 正式；读到≠必补、保持缺失/过度暴露 | `references/env-discovery.md` |
| 设计实验，比较候选解释，证据可信度，常见差异，测试假阳性；时间参数四类与生成时快照；被拒后总复核八项 | `references/env-debug-loop.md` |
| `ReferenceError`、缺对象，选型/替换运行时，模块分层，宿主泄露，ABI；按需场景组合（非默认复杂执行器） | `references/runtime-frameworks.md` |
| `toString`、descriptor、原型、brand、`document.all`、对象形状、强完整性检测 | `references/env-object-model.md` |
| Canvas、WebGL、Audio、字体、几何读数，配置与会话一致性，跨层画像，TLS 与 UA/CH 矛盾；属性值来源，成套配置版本 | `references/fingerprint.md` |
| Worker、Wasm、postMessage | `references/wasm-worker-postmessage.md` |
| 请求被拒，Cookie 链，challenge/验证码，目标内 XHR/fetch，TLS；同会话原子输入包，Realm↔HTTP CookieJar，导航交接三元组；多次写入时按需候选前缀试验（非默认「第 n 次」） | `references/network-session.md` |
| 浏览器证据，资源时效，`isTrusted`，Ruyi 或 Camoufox；人工只读探针（非每任务前置） | `references/browser-evidence.md` |
| Hook 采集代码 | `references/hook-templates.md` |
| fixture、Trace 对照、API 覆盖 | `references/fixture-and-trace.md` |
| 改了模块、初始化顺序、Realm 或异步能力；最小 DOM 里程碑；导航时点 Cookie 配对与同 Realm/`currentScript` | `references/integration-self-check.md` |
| 在浏览器中隔离某项本地能力 | `references/controlled-substitution.md` |
| 同一语义状态多份来源，或结构性 DOM 统一 | `references/dom-state-unification.md` |
| 验证方式，回归矩阵，检查状态含义；验收三状态/三维度，默认 L2 定义 | `references/validation.md` |
| 任务输入、实验记录、变更记忆、交付总结、清理 | `references/records-and-delivery.md` |
| 使用 native addon | `references/addon-api.md` |
| 使用 xbs isolated-vm | `references/xbs-isolated-vm-api.md` |
| 查找脚本 | `references/tools.md` |
| 写给其他 agent 的任务提示 | `references/task-prompt-template.md` |

## 预算、护栏与路线退出

默认：连续 3 次实验无进展 → 宏观复核（B1）；复核后再连续 3 次无进展或累计 2 次复核无定位进展 → 写进度报告并自选下一步（B2）。预算触发复核和报告，不是等待人工指路。在线验证默认间隔 ≥5 秒、每轮 ≤30 次；遇封禁/429/相同拒绝无新信息则停在线、回本地。本地代价远超收益时提出路线退出（如改浏览器后端），改变交付方式需用户确认。细则见 `references/workflow.md`「预算、护栏与路线退出」。用户约束优先。

## 核心工具

| 脚本 | 用途 |
| --- | --- |
| `scripts/init_env_case.js` | 生成 `env-fixture/v2` 与中性模板 |
| `scripts/check_intake.js` | 显示已知与未知 |
| `scripts/precheck_runtime.js` | Node 侧纯计算预检 |
| `scripts/run_with_trace.js` | 带访问记录首跑原始 JS |
| `scripts/compare_fixture.js` | 对照 fixture 与本地输出 |
| `scripts/check_environment_closure.js` | 按需聚合诊断；默认诊断，`--strict` 验收已选项 |
| `scripts/check_external_tools.js` | 检测取证工具链是否可用 |
| `scripts/write_stage_report.js` | 整理实验记录，不决定是否结束 |
| `scripts/load_native_addon.js` | 加载随包 addon 并报告导出 |

其余脚本见 `references/tools.md`。工具通过不等于网站接受；自测不能证明对所有未知任务都能自主成功。

## 平台提示

xbs isolated-vm 随包仅 `win32-x64`；native addon 提供 darwin-arm64 / darwin-x64 / win32-x64。选用前查 `references/runtime-frameworks.md`「平台与资产矩阵」。
