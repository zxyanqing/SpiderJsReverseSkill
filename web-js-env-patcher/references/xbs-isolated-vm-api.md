# xbs isolated-vm API 使用说明

什么时候读本文件：任务选用随包 xbs isolated-vm，需要确认平台前提、Context 内入口，或按 API 名检索 assets 全文时。

> 本文档已根据当前随包 xbsVm API 文档同步更新。原始文档也随包保存于 `assets/runtime-frameworks/xbs-isolated-vm/XBS_API_USAGE.md` 与 `assets/runtime-frameworks/xbs-isolated-vm/XBS_DOM_API_USAGE.md`。

全文以随包原始文档为唯一版本，不在此重复上述两个 assets 文件。

## 使用前提与平台限制

平台矩阵见 `references/runtime-frameworks.md`。当前随包 xbs 二进制仅提供 `win32-x64`；在其他平台选用会直接失败。加载前核对 `xbs-isolated-vm/<platform>-<arch>/isolated_vm.node` 与 Node ABI。

## 选用 xbs 时的上下文

- 选用随包 xbs 时，加载对应平台的 `xbs-isolated-vm/<platform>-<arch>/isolated_vm.node` 并核对 ABI。
- `window.xbs` / `globalThis.xbs` 只存在于 isolated-vm Context 内；普通 Node addon 的桥接需要单独验证。
- `xbs.dom.createDocument(options)` 是当前 xbs DOM 的公开入口；旧 API 已删除。
- 需要基础 DOM 时优先通过 `xbs.dom.createDocument({ url, html, skeleton, omitApis, features })` 创建 document，再由 runtime 或项目代码决定是否安装到 `window.document`。
- `document.all` 可由 `xbs.dom.createDocument()` 提供的 `HTMLAllCollection` / HTMLDDA 行为表达；手写 document 时可评估 `xbs.createUndetectable(callback, handlers)`，并核对原型链 fallback。
- 对手写 `document.all` 这类特殊对象才优先使用 `createUndetectable(callback, handlers)`；如果需要基础 DOM，应优先使用 `xbs.dom.createDocument()` 自动提供的 `document.all`。
- 手动创建 `document.all` 时，`length / item / namedItem / constructor` 等已有原型链属性不要定义成 `document.all` 自有属性；更接近浏览器的安装方式是挂到 `Document.prototype` getter，而不是直接作为 document 自有属性。
- 评估能力缺口前核对 xbs API 的参数与目标所需行为。

## 常用能力一览

| API / 能力 | 用途 | assets 全文位置 |
| --- | --- | --- |
| `createNativeFunction` | native-like 函数或构造函数 | `XBS_API_USAGE.md` §3 |
| `createGetter` / `createSetter` | native-like 访问器 | `XBS_API_USAGE.md` §4–5 |
| `createProtoChains` | 批量构造函数与原型链 | `XBS_API_USAGE.md` §6 |
| 原型链注册表 API | 查看/清理 isolate 注册表 | `XBS_API_USAGE.md` §7 |
| `createNativeObject` | 单对象构造（旧式） | `XBS_API_USAGE.md` §8 |
| `createInterceptor` | V8 属性拦截器 | `XBS_API_USAGE.md` §9 |
| `createNativeCollection` | HTMLCollection / NodeList 风格集合 | `XBS_API_USAGE.md` §10 |
| `getMimeTypesAndPlugins` | mimeTypes / plugins | `XBS_API_USAGE.md` §11 |
| `createUndetectable` | HTMLDDA / document.all 近似 | `XBS_API_USAGE.md` §12 |
| Private slot API | get/set/has/deletePrivate | `XBS_API_USAGE.md` §13 |
| `throwTypeError` | native 层 TypeError | `XBS_API_USAGE.md` §14 |
| `xbs.dom.createDocument` | 创建 document（唯一公开 DOM 入口） | `XBS_DOM_API_USAGE.md` §4 |
| createDocument 前 omitApis | 创建前禁用 API | `XBS_DOM_API_USAGE.md` §5 |
| 常用 DOM 能力 | 属性、方法与集合 | `XBS_DOM_API_USAGE.md` §6–7 |
| iframe 行为 | iframe 相关约定 | `XBS_DOM_API_USAGE.md` §9 |

## 检索方法

```bash
rg -n "createDocument" assets/runtime-frameworks/xbs-isolated-vm/
rg -n "createUndetectable" assets/runtime-frameworks/xbs-isolated-vm/XBS_API_USAGE.md
rg -n "^## " assets/runtime-frameworks/xbs-isolated-vm/XBS_API_USAGE.md
rg -n "^## " assets/runtime-frameworks/xbs-isolated-vm/XBS_DOM_API_USAGE.md
```

参数、示例与行为细节以 assets 全文为准；本文件只保留参考文档独有的选用上下文与索引。
