# 反例（须被声明的消费观察发现）

消费观察实现：`observe.mjs`。运行：`run-local.mjs --fault <id>`。

加载路径：**页面 Realm** 内联 `<script>`（UMD）；禁止默认 `createRequire(dist)`＋挂宿主全局。

| id | 注入 | 期望观察码（至少其一） |
| --- | --- | --- |
| `wrong-prototype` | 将页面 `window.navigator` 换成无原型空对象 | `runtime-error` 和／或 `callback-incomplete` |
| `wrong-resource-version` | 加载伪造 UMD（结果 `version = 9.9.9`） | `resource-version-mismatch` |
| `incomplete-callback` | harness 不 await `load()`/`get()`（不启动未完成异步以免挂住 Node） | `callback-incomplete` |
| `missing-matchMedia` | 不安装 `matchMedia` 垫片 | `component-error`（保留组件名＋错误信息，不得仅名字列表且 `ok`） |
| `host-require-realm` | 故意走宿主 `require(dist)` | `realm-mismatch` |
| `e09-collapse` | 注入「子 Frame 函数／对象 Realm 均不可区分」伪证据 | `e09-realm-not-distinct` 和／或 `e09-object-realm-not-distinct` |
| `e09-object-collapse` | 函数 Realm 字段均正确，仅 `objectProtoDistinct=false`（观察注入） | `e09-object-realm-not-distinct` |
| （探针级）同原型 iframe | 页面与子 Frame 对象原型相同（如默认 jsdom iframe）时探针须判 `objectProtoDistinct=false` | `e09-object-realm-not-distinct` |

正例：`--fault baseline`（或默认）须 `observation.ok === true`，SDK 函数 `instanceof` 页面 `Function`，且 **`websiteAccepted` 恒为 false**。

禁止：把上述本地观察通过写成真实网站接受或风控绕过率；禁止用仅组件名列表掩盖 `matchMedia`／`screen` 等组件错误。
