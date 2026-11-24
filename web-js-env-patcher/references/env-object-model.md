# 目标 WebAPI 对象模型

什么时候读本文件：处理 `toString`、descriptor、原型、brand、`document.all`、对象形状，或遇到强完整性检测时。最小契约范围与「存在性/类型/结构/值」分类见 `references/env-discovery.md`；本文件不重复那份分类表，只写对象模型与反射实现要点。

按原始目标的访问链组织对象：全局对象、构造函数、实例、prototype、方法、属性描述符、访问器、返回对象和内部状态。先以可运行的当前路径确定必要范围，再对参与产物的契约加深验证。普通对象和兼容库可以承担其能表达的行为；反射或 native 特性成为实际差异时再选相应能力。

扩展接口的优先级与已有实现的正确性分开。返回对象、全局构造器、公开方法和内部状态已被实现时，在完整安装后检查它们是否相互一致；创建子上下文后复查父上下文。不同入口修改同一状态时验证联动，而非只看单个 getter 的值。具体方法见 `references/integration-self-check.md`。

## 易混淆的行为

- `window`、`self`、`globalThis` 与 iframe/Worker 的全局关系由实际 Realm 决定。Worker 不等于主 Window 的浅拷贝；创建、消息、终止或导航时观察生命周期。
- `document.cookie` 的读写体现作用域、覆盖和时序；目标若写 Cookie，单一静态字符串不能代表完整契约。
- `createElement(tag)` 的返回对象可能继续进入 DOM 树、属性、事件或 Canvas 等路径；按实际 tag 和后续消费实现。
- `navigator.userAgentData` 的值及 `getHighEntropyValues()` 结果与请求 Client Hints 同属跨层画像，采样时记录同一配置；完整跨层义务见 `references/fingerprint.md`「跨层画像一致性」。
- `crypto`、时间、随机数、Storage 与动态资源既有 API 语义，也有单次状态。fixture 精确比较需控制可比输入。
- `document.all` 的 HTMLDDA 特性无法由普通对象完全表达。若目标依赖 `typeof`、布尔值或等于 null 的特殊行为，查看 xbs/addon 能力并做最小 probe。

对象形状详见下文「对象形状与私有状态」；native 行为详见下文「WebAPI 反射与 native 行为」。对象模型应以网站观察和本地目标运行核对，不能从通用 API 名单自动生成“已通过”结论。

## 被触发时的对象关系

当目标读取 `document` 的原型或构造器时，常见继承链为 `EventTarget → Node → Document → HTMLDocument`。具体浏览器可能有差异，按当前页面采样。若 `document.createElement(tag)` 返回值继续被消费，常见关系包括：

| tag | 典型构造链 |
| --- | --- |
| `canvas` | `HTMLCanvasElement → HTMLElement → Element → Node → EventTarget` |
| `video` | `HTMLVideoElement → HTMLMediaElement → HTMLElement → Element → Node → EventTarget` |
| `audio` | `HTMLAudioElement → HTMLMediaElement → HTMLElement → Element → Node → EventTarget` |
| `img` | `HTMLImageElement → HTMLElement → Element → Node → EventTarget` |
| `a` | `HTMLAnchorElement → HTMLElement → Element → Node → EventTarget` |

`localStorage` / `sessionStorage` 被调用时，关注 `Storage.prototype` 上的 `getItem`、`setItem`、`removeItem`、`clear`、`key`，以及 `length`、键覆盖顺序和每个存储区的独立状态。目标若调用 `getRandomValues`，局部 fixture 可以记录相同随机字节以比较算法；交付运行时的随机策略和精确值复现应分开说明。

当目标读取 `navigator.userAgentData`，观察 `brands`、`mobile`、`platform`、`toJSON()` 和 `getHighEntropyValues()` 的 Promise、参数及返回字段，并与当前请求的 Client Hints 比较；二者同属画像，跨层核对见 `references/fingerprint.md`「跨层画像一致性」。若目标从未读取这些成员，它们不属于默认实现清单。

## 对象形状与私有状态

目标代码检查 ownKeys、descriptor、prototype、brand、constructor 或 getter/setter 时，采集同路径的浏览器对象形状并与本地对象比较。先确定哪一层差异会影响目标结果，再用 `check_object_shape_audit.js` 或定向 probe 复验。

内部状态可用闭包、WeakMap、native private slot 等方式保存。若自有属性或 Symbol 被目标枚举到，按观察修复泄露。不要只按属性前缀判断，也不要要求所有未触及对象达到完全同构。

跨 Realm 对象的构造器和原型可能不同；iframe/Worker 实现按目标所需独立状态和生命周期处理。对象形状通过是局部事实，不等同于网站验收。

## WebAPI 反射与 native 行为

当目标检查函数源码、descriptor、getter/setter、prototype、brand、非法 receiver、集合对象或 `document.all` 时，观察相应浏览器行为并选择能表达该契约的实现。普通 JS、成熟库、addon 或 xbs 各有能力边界；native 能力按需选用，不作为每个项目的默认前置。jsdom 场景下语义后端与反射外观的分层见 `references/runtime-frameworks.md`「分层原则」。

addon 的 `createProtoChains`、`createNativeFunction`、`createGetter`、`createSetter`、`createNativeCollection`、`getMimeTypesAndPlugins`、`createUndetectable` 等接口见 `references/addon-api.md`。xbs 版本在 isolated-vm Context 内通过 `window.xbs` 使用，见 `references/xbs-isolated-vm-api.md`。在纯 JS 路径中，`assets/env-modules/native-protect.js` 可处理部分函数表现，但不能保证所有引擎内部槽或 HTMLDDA 行为。

实现前明确当前目标实际消费的对象/成员及反射深度。浏览器中是 accessor 的属性、构造错误或 `Object.prototype.toString` 结果，在触发该路径时按观察验证。返回对象继续被调用或读写时一起测试。对当前能力无法覆盖的行为，参见下文「原生能力缺口」并标明局部适用范围。

专项工具如 `check_env_realism.js` 和 `check_webapi_addon_coverage.js` 的静态结果可帮助发现疑点，不能证明网站接受或强制所有实现采用 addon。

### 特殊行为探针

`document.all` 是 HTMLDDA 的典型例子。当目标执行相关分支时，可在浏览器和本地分别记录：

```js
typeof document.all;
document.all == undefined;
document.all === undefined;
Boolean(document.all);
'all' in document;
```

仅用 `undefined` 作为属性值无法同时满足这些关系。选用 addon/xbs 时可核对 `createUndetectable` 或 `xbs.dom.createDocument()` 的实际结果；纯 JS 近似实现标明不支持的运算。

函数反射也可能经过多个通道：`fn.toString()`、`Function.prototype.toString.call(fn)`、先保存原始 `toString` 再调用、`String(fn)`，以及 `structuredClone(fn)` / `MessagePort.postMessage(fn)` 的错误行为。只对目标实际走到的通道采样和比较。addon 提供的函数创建器与 JS 层 `NativeProtect` 可能在这些通道表现不同，选择依据是当前目标证据。

默认 `markNativeFunction`/模块安装只记录弱引用映射及标签，不修改宿主原型。`enableNativeProtection()` 是显式原地模式，只作用于执行该模块的 Realm；`disposeNativeProtection()` 仅在当前属性仍指向本实例补丁时恢复，并释放记录。vm 模板在目标 Realm 内独立加载它并管理生命周期，宿主 `require` 的单例不参与。先前保存的原生 toString、HTMLDDA、内部槽仍不由 JS fallback 保证；不把源码伪装视为隔离。

## 原生能力缺口

当目标路径需要 HTMLDDA、内部槽、跨 Realm brand、DataCloneError 或其他 JS 层无法表达的行为时，先用最小 probe 复现浏览器与本地差异，核对现有 addon/xbs API 是否支持。区别实现错误、证据缺失与能力缺口。

记录目标操作、实际观察、当前运行时限制、受影响的产物、可选实现路径和最小验证用例。native/addon 只是候选路线，也可采用成熟运行时或经证据支持的局部兼容实现；无法确认的网站接受条件保持未验收。局部兼容实现注明覆盖范围。

## 复杂浏览器完整性检查

某些目标会组合函数 native 表现、descriptor、原型、跨 Realm、事件、设备读数和网络状态。先确认实际访问链与消费点，再组合必要的定向 probe。单个 WebAPI 名称或站点类型不能决定需要全量浏览器仿真。

目标路径若确实依赖引擎内部行为，评估已有 addon、xbs、成熟运行时与局部兼容方案的表达能力；无法覆盖的点记录为能力缺口。网站拒绝可由多个维度造成，使用控制变量的实验更新判断。

## WebAPI 行为矩阵

iframe、Worker、消息、DOM/CSSOM、EventTarget、timer 与 Performance 等能力在目标路径触发时按实际观察建立矩阵。记录输入、Realm、事件顺序、状态变化、返回值与消费结果；无目标依赖的类别标为不适用并写理由，尚未观察到的类别标为证据不足。

浏览器 baseline 和 Node audit 可用同一 probe 比较，但 probe 的结果只说明所测行为。使用 `check_webapi_env_detection_matrix.js --require` 时，提供真实观察来源与对应版本；静态字段或手填 matched 不能代替执行证据。

优先实现当前产物所需的最小完整契约。Realm 与生命周期差异可能使同名 API 行为不同，需结合目标调用链判断影响。
