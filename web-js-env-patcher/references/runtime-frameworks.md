# 本地运行时选型与重新评估

什么时候读本文件：出现 `ReferenceError` 或缺对象、选择或替换运行时、查看模块分层与模板边界、宿主泄露，或处理 native ABI 时。

按原始 JS 所需能力和任务交付方式选择。用户指定技术时遵从选择，并处理已观察到的适配问题。

涉及 DOM 标准能力时优先 jsdom，直接共享对应节点与权威状态。具体版本缺口和集成约束需有证据，再由 agent 自主选择适配或补充后端；不把布局、图形、设备读数等一律交给 jsdom，无 DOM 依赖时不强制引入。普通 jsdom 维护按受影响关系回归。结构性状态来源统一专项的进入条件与验收见 `references/dom-state-unification.md`。

| 路径 | 适用条件 | 需要观察 |
| --- | --- | --- |
| Node / 轻量 shim | 当前路径依赖少 | 宿主泄露、默认能力分支和标准行为 |
| jsdom 优先的成熟 DOM 实现 | 解析、DOM 树、事件或选择器占主要依赖 | 浏览器差异、节点身份、桥接与初始化 |
| Node vm | 需要独立全局和脚本上下文 | 不是强安全边界；公开函数与异常所属 Realm |
| isolated-vm / xbs | 任务需要相应隔离或特殊能力 | 二进制 ABI、跨 Context 数据与维护成本 |
| addon | 必要行为依赖原生对象能力 | 真实导出、可移植性、组合后的语义 |

成熟实现既可以作为底层，也可以提供有限后端；选择时比较覆盖范围和适配成本，不默认每个 API 都另建一套镜像或整个项目必须迁移。标准语义、设备读数和会话状态分别实现。

## 按需组合 / 场景选择

先确认输入、消费方与所需语义，**只组合必要部分**。复杂页面执行器是可选参考，不是默认模板或验收前置。纯计算不引入 jsdom；简单 DOM 不强制 Python 网络流程。

| 任务实际需要 | 适合的起点 | 何时增加其它组件 |
| --- | --- | --- |
| 纯 JS、无 DOM | 普通 JS / `node:vm` | 仅需独立全局或预算时加包装 |
| 少量 DOM | `assets/examples/jsdom-composition.js`（outside-only 组合） | 需页内脚本顺序/`currentScript` 时用 DOM 里程碑 |
| 真实 HTML、多脚本、外链 | 页面执行 + 资源映射 | iframe/异步/导航再加 |
| 产物交真实 HTTP | 现有客户端 + CookieJar | 会话交接再加私有通道（见 `network-session.md`） |
| 不可信 / 可能卡死 | 独立进程 + OS/外部限制 | 按风险选隔离强度；子进程本身 ≠ 安全隔离 |

当适配层持续增加、模块互相覆盖或一个字段存在多份状态时，比较继续修补与替换局部后端。选一条真实受影响路径，在可恢复副本中验证覆盖、行为和集成成本，再决定是否扩大。历史投入不是固定架构的理由，单个接口缺失也不是推倒重来的理由。

资产在 `assets/runtime-frameworks/`。选用 xbs 时看 `references/xbs-isolated-vm-api.md` 和 `scripts/check_xbs_isolated_vm.js`；`window.xbs` 仅在对应 Context 中，`createDocument(options)` 已移除旧 profile 参数。普通 addon 查 `references/addon-api.md`。只有选用的 native 能力确实需要时进入下文「Native ABI 兼容」。

切换运行方案后用正式初始化和原始目标路径验证，并检查产物消费边界是否变化；按 `references/integration-self-check.md` 选择受影响检查。

## 平台与资产矩阵

| 资产 | darwin-arm64 | darwin-x64 | win32-x64 | linux |
| --- | --- | --- | --- | --- |
| native addon（`assets/native-addon/`） | 有；**已实测可加载（Node v22.22.1）**；声明兼容版本 v25.8.2（见 `load_native_addon` / `check_node_runtime_compat`） | 有；**未实测**（本机为 darwin-arm64） | 有；**未实测** | 无 |
| xbs isolated-vm（`assets/runtime-frameworks/xbs-isolated-vm/`） | 无 | 无 | 有；声明兼容 Node v26.3.1；**未实测**（本机非 win32） | 无 |

选用前用 `scripts/load_native_addon.js`、`scripts/check_node_runtime_compat.js`、`scripts/check_xbs_isolated_vm.js` 复核当前 Node / ABI / 平台。macOS 上不要默认选 xbs。

## 可执行模板契约

vm 模板支持单 Window 的 `window === self === top === parent === globalThis` 及真实 `Window.prototype` 关系；不实现 WindowProxy、iframe 或导航，Worker 不安装 base-env。`initialize()` 单次调用，重复调用拒绝；多个 runtime 的构造器、私有状态和反射补丁独立。`dispose()` 幂等，释放引用与目标补丁；不删除项目文件。失败后 runtime 进入 failed，只可 dispose 后新建，避免继续使用半完成状态。

`installEnv(scope, fixture)` 可继续调用正式 base/storage/document 安装器：宿主 WeakMap 注册表将它们路由为目标上下文内求值的模块，fixture 通过 JSON 数据复制。也可用 `envModules: ['base-env', 'storage-env']`。自定义接口应在目标 Realm 内定义；初始化检查 sandbox 和实际 globalThis 的自有 descriptor、原型链及方法/访问器，拒绝其中的宿主函数/对象，循环引用只访问一次。宿主 API 只是可信编排工具，不能直接把 host require、URL、错误、回调或 addon 对象赋给 scope；审计不构成任意敌意安装器的安全证明。

load 与字符串路径 call（如 `window.sdk.run`）均经过 vm timeout；call 参数只接受有限 JSON 数据，不接受宿主函数、访问器、特殊实例或隐式参数展开。同步及 Promise/微任务完成受预算约束；模板不提供定时器、网络或 Worker 后端，需要这些能力时另选有调度和最终终止边界的 adapter。内部微任务使用 `microtaskMode: 'afterEvaluate'`，不直接在宿主 await 目标 Promise；普通 vm 依然不是敌意代码的强安全边界，外部宿主桥接的工作不受这个保证。

`load()` / `call()` 的结果在同一预算内导出为宿主数据，不能再直接返回目标 Realm 对象。对象和数组采用 JSON 快照，getter、toJSON、Proxy trap 都在 vm 内执行；原型和对象身份不传出，嵌套字段遵从 JSON 的省略/转换规则，循环引用或嵌套 BigInt 等无法序列化的值明确失败。顶层 undefined、null、BigInt、NaN、正负 Infinity、-0 和其他普通原始值保留；Symbol 结果拒绝。目标拒绝/异常也在 vm 内读取 name/message/code，再构造宿主 Error；快照超时进入 failed。

执行时设置 `displayErrors: false`，避免 Node 的默认异常堆栈整理在 timeout 之外读取被抛出对象的 stack 或 Proxy get；异常数据继续走上述有界快照。该设置同时用于 Trace 的目标执行，Trace 来源与异常协议见 `references/fixture-and-trace.md`。

函数结果返回冻结、无原型、不可调用的身份句柄 `{ id, type: 'function' }`，不会把目标 then getter 交给宿主 Promise 解析。`loadHandle(expression)` 在 Promise 完成后对对象或函数返回同类句柄，同一 runtime 内同一目标身份得到同一个句柄；原始值仍直接返回。句柄只用于身份比较，不能用于宿主直接调用、属性访问或作为 call 的参数；调用仍使用入口字符串或在目标表达式内完成。不同 runtime 的句柄不能互换；dispose 清空缓存。`initialize()` 仅完成初始化并返回 undefined，避免 async 返回全局对象时隐式读取 then。`context` / `sandbox` 属性仅供可信宿主编排，不属于数据快照接口。

此 vm 组合只支持目标 Realm 的 JS fallback（`capabilities.nativeAddon === false`），显式 addon 请求会拒绝，不注入宿主 addon；不能将宿主创建的 native 函数改个原型后宣称隔离。直接宿主/native 模式仍可使用 native-protect 工具，但不继承 vm 隔离契约，二进制 ABI 和 native 跨 Realm 适配需另验。没有运行的 native/平台路径应明确写成未验证。

## 首跑前：页面 Realm、脚本调度与安全边界

- **页面 Realm**：有 DOM 时由 **jsdom** 创建 Window/Document；`node:vm` / jsEnv 仅宿主编排，**不**「用 vm 获取页面 Realm」。
- **里程碑 vs 正式页**：双经典同步页内脚本的文档序 **仅**约束 `assets/examples/jsdom-dom-milestone.html` / `jsdom-dom-milestone.js` fixture；正式页按原始 `async`/`defer`/module/动态插入语义调度，禁止一律按标签串行。见 `references/workflow.md`「脚本执行路径」。
- **`node:vm` 不是安全沙箱**；**单独子进程也不是**安全隔离。隐藏 `process`/`require` 几个全局 ≠ 安全隔离。不可信页内执行（含 `runScripts: "dangerously"`）须 OS/外部边界，且执行环境无敏感凭证。限制输入大小、时间、内存与输出；尽量不向页面 Realm 暴露宿主 `process`/`Buffer`/`require`/宿主网络对象或可回调宿主的函数。
- 未消费的布局/GPU/设备读数等能力不实现；不在 jsdom 上再维护第二套 `window`/`document`/Cookie/Storage 状态源；确需包装时只做反射外观，底层状态仍由 jsdom 持有（与「分层原则」一致）。

## jsdom 最小组合示例

`assets/examples/jsdom-composition.js` 通过 runtime-factory 的 jsEnv adapter 正式初始化并运行原始同步 JS，解析 HTML、querySelector/getElementById、属性/文本修改、Cookie 和 Storage 都使用同一 jsdom Window。不要再安装手写 base/document/storage 覆盖该 Window。示例的非透明有限边界为：受控同步脚本、`runScripts: "outside-only"`；**不满足** DOM 里程碑的 `currentScript`/页内双脚本要求。无浏览器布局/设备后端，无异步完成或强隔离保证。需要有界异步或潜在敌意脚本时将整条后端放入可终止的进程/Worker，且仍须满足上文 OS/外部安全边界（子进程本身 ≠ 安全隔离）。

DOM 里程碑（页内双经典同步脚本）见 `assets/examples/jsdom-dom-milestone.js` 与 `references/integration-self-check.md`「最小 DOM 里程碑」。

示例的 `fixture.request.cookie` 是 Cookie 请求头字符串（如 `first=1; second=2`）：逐对注入同一 jsdom cookie jar，保留值中的等号。请求头没有原 Cookie 的 Domain/Path 元数据，因此按 pageUrl 的 host-only、Path=/ 初始化；修改时使用相同作用域。属性齐全的响应 Cookie 另用 `request.setCookies: ['sid=abc; Path=/; Secure; HttpOnly', ...]`，每条按 Set-Cookie 语义注入并由 jar 决定可见性。非字符串头、非法 Cookie 对或非字符串数组会拒绝初始化，不静默丢 Cookie；不要把属性附在 request.cookie 后当作 Set-Cookie。

维护测试使用精确的开发依赖 `jsdom@24.1.3`（Node >=18，验证环境为 Node 22）；选择该版本用于复现同步 DOM 示例，不代表最新或完整浏览器。先 `npm ci --ignore-scripts`，再运行 `node assets/examples/jsdom-composition.js` 或全套测试。复制示例时在实际项目声明并验证所选 jsdom 依赖，未用 DOM 的任务不需要安装它。

### 分层原则

涉及 DOM 标准能力时仍优先 jsdom。jsdom 负责语义；目标可见的反射外观按需包装；布局/图形/设备读数另走读数层。不提供通用外观层实现资产——覆盖范围由目标实际检测决定。

| 层 | 承担的内容 | 规则 |
| --- | --- | --- |
| 语义后端 | jsdom 的节点、属性、Cookie、Storage、事件等状态 | 唯一权威来源，与 `references/dom-state-unification.md` 一致 |
| 反射外观层 | 目标可见的构造器、原型、描述符、`toString`、属性枚举、错误与堆栈 | 只做转换和包装；读写转发到语义后端，**不另存状态**（与专项「适配边界清楚」双向一致） |
| 读数层 | 布局、图形、设备等具体读数 | 来自声明配置或采样回放，见 `references/fingerprint.md` |

包装深度按目标实际检测分级，不默认全量包装：

1. **目标没有反射检测**：直接暴露 jsdom 对象，不包装。
2. **目标检测了部分接口**：只包装被访问到的接口，依据来自访问记录和下文特征探针。
3. **强完整性检测**：外观层可考虑 addon 的 `createNativeFunction`、`createProtoChains` 等；xbs 的 `createDocument` 仅 win32-x64 可用，选用前先查上文平台矩阵。

约束：外观层不能成为第二份状态来源；若包装需要缓存，缓存必须能从后端重建并正确失效。包装不能改变 jsdom 的语义行为；包装后按 `references/integration-self-check.md` 回归受影响联动。探针结果决定第 2 级覆盖哪些接口；`tests/jsdom-trait-probe.test.js` 中的「处理后对照」（例如覆盖 `navigator.userAgent`）是外观层的最小示例。

### jsdom 自身特征

用了 jsdom 之后，先跑自检，把结果记为「本地已知差异」；再结合目标实际访问记录决定处理哪些项。**不要求消除全部特征。** 下列各项均在 `jsdom@24.1.3`（Node v22.22.1）上实测成立。自检探针：`assets/examples/jsdom-trait-probe.js`（只观察、不修改；经 jsEnv 正式初始化）。

| ID | 特征 | 观察方法 | 实测结果 | 建议处理 | 文档 |
| --- | --- | --- | --- | --- | --- |
| T1 | 方法 `toString` 暴露 JS 源码 | `Function.prototype.toString.call(document.createElement)` | 返回含 `createElement` 实现的源码，无 `[native code]` | 按访问记录做反射包装 | `env-object-model.md`「WebAPI 反射与 native 行为」 |
| T2 | 访问器 `toString` 暴露 JS 源码 | `Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Document.prototype,'cookie').get)` | getter 源码可见 | 同上 | `env-object-model.md` |
| T3 | 默认 UA 含 `jsdom` | `navigator.userAgent` | `... jsdom/24.1.3` | 从 fixture/声明配置注入 UA | `fingerprint.md` |
| T4 | `plugins` / `mimeTypes` 为空 | `navigator.plugins.length`、`mimeTypes.length` | 均为 `0` | 按需注入采样插件列表 | `fingerprint.md` |
| T5 | `webdriver` 为 `undefined` | `navigator.webdriver` | `undefined`（常见浏览器为 `false`） | 按目标观察注入 | `fingerprint.md` |
| T6 | 默认 `languages` | `[...navigator.languages]` | `['en-US','en']` | 按采样注入 | `fingerprint.md` |
| T7 | 元素布局读数为 0 | `getBoundingClientRect()`、`offsetWidth`、`clientWidth` | 宽高均为 0 | 采样回放 | `fingerprint.md` |
| T8 | `screen` 为 0；`innerWidth/Height` 有默认 | `screen.width/height`；`innerWidth/innerHeight` | screen 全 0；inner 默认 `1024`/`768` | 按采样注入视口与 screen | `fingerprint.md` |
| T9 | 包装对象暴露内部 Symbol | `Object.getOwnPropertySymbols(document)`、`Reflect.ownKeys(navigator)` | 出现 `Symbol(impl)`、`Symbol(SameObject caches)` 等 | 按枚举深度处理对象形状 | `env-object-model.md`「对象形状与私有状态」 |
| T10 | 异常堆栈含 jsdom 路径 | 触发 `document.querySelector('(')` 后读 `error.stack` | 含 `node_modules/jsdom`（及 nwsapi） | 按目标是否读 stack 决定是否包装错误 | `env-object-model.md` |
| T11 | canvas `getContext` 未实现 | `canvas.getContext('2d')` / `'webgl'` | 返回 `null`，并有 virtual console「Not implemented」；运行探针时可能向 **stderr** 输出该提示，属预期观察副作用，不是改环境 | 读数层回放或声明不支持 | `fingerprint.md` |

候选项中「泛化的原型链/描述符与浏览器不同」未单独成行：在无浏览器 baseline 时，除 T9 的内部 Symbol 外，未能把 Document/HTMLElement/Navigator/Storage 的常规描述符形态稳定判为独立特征；见执行报告。

## 补环境分层与模块资产

本节用于把补环境从“一坨 env.js”拆成可验证、可替换、可复用的模块。

### Level 1 / 2 / 3 分层

| 层级 | 目标 | 常见模块 | 进入条件 | 交付要求 |
|---|---|---|---|---|
| Level 1 基础运行层 | 让目标 JS 在隔离 Node.js 运行上下文中加载并可调用入口，核查所选模式边界 | window/self/globalThis、location、URLSearchParams、atob/btoa、TextEncoder、Date、console、setTimeout、Storage | 已有可运行材料；入口、fixture 可在观察中补齐 | 不暴露 Node；能记录缺失环境 |
| Level 2 指纹与对象真实性层 | 让环境更接近浏览器并通过常见检测 | navigator、screen、document、plugins、mimeTypes、crypto、performance、Canvas/WebGL/WebGPU/Audio/字体/DOM 几何值回放、属性描述符、原型链、toString | Level 1 能运行但输出不一致或出现检测 | 有 descriptor/accessor/prototype/native-like/Object.prototype.toString 记录；指纹终端 API 有真实采样值 |
| Level 3 目标 SDK 专用层 | 针对具体站点 SDK 的初始化、缓存、消息和异步行为 | SDK init、动态 chunk、Worker、WASM、postMessage、IndexedDB 摘要、请求封装 | 已确认目标 SDK 依赖 | 写入 notes，避免污染通用 env |

### 模块选择矩阵

| trace / 错误信号 | 优先模块 | 备注 |
|---|---|---|
| `ReferenceError: window` / `self` | base-env | 先建立全局别名 |
| `location.href/origin/pathname` | location-env | 由 fixture.pageUrl/apiUrl 生成 |
| `navigator.userAgent/language/platform` | navigator-env | 使用浏览器真实样本 |
| `document.cookie` | document-cookie-env | 敏感值脱敏记录 |
| `localStorage.getItem` | storage-env | 从 fixture 注入 key/value |
| `crypto.getRandomValues` | crypto-env | 依据目标区分真实随机、采样和可重复诊断源 |
| `performance.now` | time-env | 与 Date.now 联动 |
| `canvas/WebGL/WebGPU/Audio/字体/DOM 几何` | fingerprint-env | 按证据选择适用后端或采样回放，标明设备/会话来源 |
| `Object.getOwnPropertyDescriptor` | descriptor-env / native-protect | 检查 enumerable/configurable/writable，区分 data descriptor 与 accessor descriptor |
| `Function.prototype.toString` | native-protect / native-addon | 普通函数、构造函数、getter、setter 都要保护 |
| `document.all` | native-addon | JS 难以完全模拟，优先 addon |
| `Worker/postMessage/WASM` | worker-wasm-env | 单独建消息链 |

### 推荐目录

```text
case/
├── env/
│   ├── base-env.js
│   ├── navigator-env.js
│   ├── document-env.js
│   ├── storage-env.js
│   ├── crypto-time-env.js
│   ├── native-protect.js
│   └── target-sdk-env.js
├── result/
│   ├── run.js          # 入口示例；名称和语言按任务确定
│   └── src/            # 最终项目模块：env、signer、request、utils 等
└── notes/
    ├── entry-chain.md
    ├── missing-env-priority.md
    └── silent-failure-checklist.md
```

Skill 自带模板位于 `assets/env-modules/`，使用前应复制到 case 中按目标调整，不要直接改 Skill 内模板。

### 环境模块模板定位

| 模板 | 定位 | 已知边界 | 建议用法 |
| --- | --- | --- | --- |
| `base-env.js` | 可交付组件（有限） | 单 Window 身份与静态 location；无导航、WindowProxy、iframe；Worker 不安装 | 无 DOM 或仅需全局别名时；与 storage 等组合 |
| `storage-env.js` | 可交付组件（有限） | 私有 Map、receiver 校验、local/session 独立；无命名属性枚举与存储事件 | 需要 Storage 且未走 jsdom 时 |
| `document-env.js` | **有限诊断桩** | 无 HTML 解析/树/选择器/事件；Cookie 无域路径过期；`querySelector`/`getElementById` 恒 null | 仅诊断；**有 DOM 需求时用** `assets/examples/jsdom-composition.js`，**不要与 jsdom 叠加** |
| `fingerprint-env.js` | 可交付组件（回放） | 回放采样值，不在 Node 内真实渲染 | 接入 `fingerprint.fixture.json` 后按证据启用 |
| `native-protect.js` | 工具 | addon 优先，失败才 JS fallback；`enableNativeProtection` 显式原地补丁 | 反射/`toString` 需要时；注意 Realm | 
| `realm-install.js` | 工具（宿主编排） | 宿主 WeakMap 注册表；不把宿主桥挂到目标可见对象 | vm/jsEnv 安装器路由模块时使用 |

### 固化规则

- 探测阶段可以用 Proxy；交付阶段逐步替换为真实对象。
- 依据原始代码、运行错误、浏览器观察或已有 Trace 选择必要契约；无 Trace 也可启动。已实现能力在正式组合后检查相关联动，不等显式 Trace 读取构造器。
- 每轮补齐后跑 fixtures，对比目标参数，不以“不报错”为完成。
- 通用模块和目标 SDK 专用模块分开，避免把站点私有逻辑写进通用 env。
- 敏感 Cookie、token、localStorage 值只放在本地 fixture，不写入总结原文。
- 按改动和目标依赖选择 `check_env_realism.js` 等检查；选择原型、描述符、访问器、反射、`document.all` 或指纹回放中适用的部分，不把无关项目列为交付前置条件。工具通过与语义验收分别记录。
- 入口名称、目录和语言按用户任务确定；整理可运行入口及其依赖，区分诊断资产与交付资产。

### 模块笔记模板

```markdown
## 环境模块补齐记录

| 模块 | 触发证据 | 补齐内容 | 真实性处理 | 验证结果 |
|---|---|---|---|---|
| base-env | ReferenceError: window | window/self/globalThis | descriptor 已记录 | 通过加载 |
| storage-env | localStorage.getItem | 注入 key 列表 | Storage 原型待补 | sign 仍不一致 |
```

### 模板能力边界与组合

`base-env` 是单 Window 的有限身份/静态 location 模板，不实现导航、WindowProxy 或 iframe；Worker 不安装该模块。
`storage-env` 支持私有 Map、有效 receiver 校验及两种 Storage 的独立状态，未实现命名属性枚举和存储事件。
`document-env` 仅作有限诊断桩：无 HTML 解析/树/选择器/事件，Cookie 不含域、路径和过期语义。恒返 null 不表示真实查询通过。

无 DOM 的纯计算路径可直接选 vm，不安装 DOM 模块。少量 DOM 若涉及解析、选择器或修改，也可直接用成熟 DOM 后端；可执行示例 `assets/examples/jsdom-composition.js` 经 runtime-factory/jsEnv 正式初始化后共享同一 jsdom Window、节点、Cookie 和 Storage，不叠加手写 document。
示例仅覆盖受控同步脚本；异步和敌意脚本需另选有终止边界的后端。见上文「可执行模板契约」。

## 补环境代码组织

按目标路径的稳定接口分离运行时、环境组件、目标代码加载和结果消费。已有项目结构优先，避免为满足固定目录名而重构。运行入口清楚说明输入、输出及异步完成边界；错误与诊断信息便于定位到原始源码。

关键行为有证据出处时，注释解释非显然的浏览器差异和适用条件。代码质量工具提供启发式提示，不能从行长、注释语言或模块数量推断网站接受。若用户选择严格代码规范，再按对应规则验收。原始目标脚本与手写环境代码区分管理。

## 宿主泄露

目标 JS 可能读到 Node 的 `process`、`Buffer`、`require`、全局网络或新版本宿主 WebAPI。按实际运行时隔离需求和目标访问路径检查，避免把宿主行为误写为浏览器观察。若隔离用于处理不可信代码，另评估安全边界；Node `vm` 本身不是强安全沙箱；单独子进程也不是安全隔离。不可信页内脚本执行须满足上文「首跑前」OS/外部边界，不得仅凭「已用 vm/子进程」声称安全。

## Native ABI 兼容

只有选用 addon 或 xbs 且实际加载失败时进入此流程。记录当前 Node 版本、ABI、平台、二进制路径和加载错误，再查看随包文件支持的版本。可选择兼容 Node、匹配构建产物、替代运行时或无需 native 的实现；选择由目标所需能力和项目约束决定。

`scripts/check_node_runtime_compat.js` 与 `scripts/check_xbs_isolated_vm.js` 可提供诊断。版本切换后复测实际目标路径。ABI 修复不是所有补环境项目的前置步骤。
