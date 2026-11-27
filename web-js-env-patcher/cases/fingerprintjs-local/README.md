# fingerprintjs-local

固定来源的 **FingerprintJS 5.2.0** 本地环境案例（DOM／指纹读数／异步完成／**页面 Realm**）。无外部 MCP 可复现。

## 固定来源

见 `sources.json`：

| 资产 | pin |
| --- | --- |
| GitHub 源码 archive | commit `e196578ba35362fdf15647e013d66ac28b3c9fb5`，SHA256 `6fa4b733…41a2` |
| npm dist tarball | `@fingerprintjs/fingerprintjs@5.2.0`，SHA256 `e20efdc1…ab58` |
| 许可证 | MIT（`NOTICE` + 准备输出中的 `LICENSE`） |

上游版本或字节变化时**必须改 pin**；不得静默换题。

## 准备命令

输出目录必须为**尚不存在**的绝对路径（父目录已存在）。若父路径为 symlink（如 macOS `/tmp`），脚本会归一到 `realpath` 后再创建：

```sh
# 在 skill 根目录
node cases/fingerprintjs-local/prepare.mjs --output /absolute/work/fp-assets-001

# 可选：只读缓存目录中放好同名 archive，仍会校验 SHA256
node cases/fingerprintjs-local/prepare.mjs \
  --output /absolute/work/fp-assets-002 \
  --cache-dir /absolute/work/archive-cache
```

成功后输出含：`PREPARE.json`、`RUNNABLE.json`（含 `distUmd`／`loadPath: page-script`）、`SHA256SUMS`、`downloads/`、`vendor/`。

CI／干净机**可不依赖**外置 archive cache：直接 `prepare.mjs --output …` 下载并校验 SHA256 即可。可选加速：`--cache-dir` 或测试环境变量 `Y06_FP_CACHE_DIR`（如 `/tmp/y06-fp-check`）；**缺少该目录不得视为失败**。

## 本地运行（无 MCP）

```sh
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault wrong-prototype
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault wrong-resource-version
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault incomplete-callback
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault missing-matchMedia
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault host-require-realm
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault e09-collapse
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001 --fault e09-object-collapse
```

依赖：本 skill 已 `npm ci`／`npm install`（jsdom）。`monitoring: false`，不访问 Fingerprint 监测 CDN。

## 案例卡片

| 维 | 内容 |
| --- | --- |
| 原始输入 | 已 pin 的 FingerprintJS **UMD** dist；页内脚本 `FingerprintJS.load({ monitoring: false })` → `get()` |
| 环境后端 | Node + **jsdom 页面 Realm**（`runScripts: "dangerously"` 内联脚本）。**禁止**默认 `createRequire(dist)`＋替换宿主 `window`／`document` 冒充页面 |
| 完成信号 | `load` 与 `get` 的 Promise 均 settled，且得到结果对象 |
| 声明契约 | （1）`load` 与 `get` **均**须属于页面 `Function` Realm（缺 get 探针不得静默 ok）；（2）`matchMedia`／`screen` 相关组件错误须保留名＋信息，不得静默 `ok`；（3）版本＝`5.2.0`、非空 `visitorId`、存在 `components`；（4）`websiteAccepted` 恒 false；（5）**E09**：iframe 创建可观察；子 Frame 与主 Frame **函数与对象／原型** Realm 须同时可区分（`objectProtoDistinct`＝页面 Realm vs 子 Frame 对象原型，非宿主 `{}`）；页面路径清理不污染宿主 `globalThis` |
| 真实运行 | 真实上游 SDK 逻辑（npm dist 与源码 pin 同版本）；运行中可创建临时 iframe（观察 `iframeCreateCount`） |
| 本地模拟 | jsdom 垫片（Canvas／`MessageChannel`／`matchMedia`）、无真实网站消费方 |
| 反例 | 见 `anti-examples.md` |

## 边界

**本地模拟通过 ≠ 真实网站接受**；不得推导风控绕过率。浏览器对照若需要，另列依赖，证据层级与本地观察分开。

本案例默认 `load({ monitoring: false })`、**未**传 `debug: true`。FingerprintJS 在可选 `debug: true` 路径会序列化 `error.stack`；**该 debug 路径不在本轮 Y11／栈格式目标范围**，默认验收不覆盖。
