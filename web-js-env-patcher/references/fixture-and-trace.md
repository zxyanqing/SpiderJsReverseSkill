# fixture 与 Trace 对照

什么时候读本文件：初始化或比较 fixture、解读 Trace 退出协议、做 Trace 与本地运行对照，或整理 Trace API 覆盖时。静默探测分类、追踪与正式验收分离见 `references/env-discovery.md`「追踪三模式」；本文件的 Trace/访问记录工具默认服务于追踪模式，不得把诊断包装带进正式验收。

## 局部 fixture 验证

fixture 记录输入、来源、资源版本、会话/配置、观察边界及预期行为。精确值比较只在随机输入和状态足够可比时适用；非确定性结果可比较结构、关系、状态变化与网站反馈。

浏览器样本与本地结果同时保留原始观察和解释，避免用同一份构造数据互相证明。若测试失败，先判断数据是否同路径、同版本、同阶段，再定位实现差异。fixture 通过表示本地覆盖了该样本，不表示目标网站接受。

### 生产与消费共用的 schema

初始化器、Trace 运行器和比较器使用 `scripts/fixture_schema.js`，规范版本保持 `env-fixture/v2`：

| 字段 | 含义 |
| --- | --- |
| `entry` | 函数路径；运行器 `--entry` 显式覆盖 |
| `input` | 位置参数数组；无参写 `[]`，对象参数写 `[{...}]`；null 为未知，不自动把对象拆成参数 |
| `output` | 产物字段名（例如 `sign`），不是预期值 |
| `observedOutput` | 对应输入/观察边界的原始输出，null 表示未采得；比较器默认用它作参考 |
| `expected`（可选） | 明确指定的期望完整输出，优先于观察；与 observedOutput 保留不同含义，不覆盖原始观察 |
| `websiteResponse` | 消费方真实反馈，null 为未验收；fixture 相等不会自动填为网站接受 |
| `browser` / `browserSources` | 稳定配置及每字段来源：采样事实记 `observed` 与证据、用户配置记 `user-config`；无来源为 `fixture-unspecified` |
| `request` / `runtime` | 会话 Cookie/Storage 等动态输入、时钟等诊断控制；不要混写为稳定浏览器配置 |

完整链路：

```bash
node scripts/init_env_case.js --case-dir case --entry window.run --param sign --json
# 填 sample.fixture.json: input = ["abc"], observedOutput = {"sign":"abc"}
# 原始目标示例: globalThis.run = value => ({ sign: value });
node scripts/run_with_trace.js --target case/js/original/app.js --fixture case/fixtures/sample.fixture.json --output case/tmp/node-output.json --strict --json
node scripts/compare_fixture.js --fixture case/fixtures/sample.fixture.json --actual case/tmp/node-output.json --json
```

显式 `--args '["override"]'` 覆盖位置参数；`--field`、`--expected-path`、`--actual-path` 选择比较范围。显式路径不存在时报告证据不足，不偷偷退回其他字段。不同对象键顺序不算值差异。

兼容无版本旧格式 `args`、`param`、`expected`、`expectedValue`；也兼容 v2 中相同含义的旧别名。`input`/`args` 或 `output`/`param` 同时存在但不一致会报可定位错误；`expected` 与 `expectedValue` 的字段值冲突也报错。CLI 覆盖只覆盖合法 fixture，不掩盖冲突和非法类型。未知版本拒绝，未声明兼容的版本不能静默解析。旧格式不带参数字段按无参兼容，v2 的 null 输入为证据不足。比较缺失期望/实际值为 `insufficient-evidence`，不同值为 `differences`；失效目标状态不因残留值相等而通过。

### Trace 结果和退出协议

`env-trace-cli/v2` 在 output 与 summary 中提供同一 status：`passed`、`target-failed`、`timed-out`、`insufficient-evidence` 或 `execution-failed`，并保持 `websiteAccepted: null`。缺入口/未知输入/仅加载/Promise 未完成为证据不足，缺环境或目标自己的异常为目标失败，探针损坏/非法 fixture/工具 I/O 错误为执行失败。按执行来源/阶段记录 source、phase，目标自建 Proxy 的不变量异常保留为目标失败；只有可核查的探针操作失败才标 probe-error，不能仅凭异常文字归咎工具。

默认诊断模式在已收集到目标失败、超时或证据不足时返回 0，供收集证据；`--strict` 对这些状态返回 1；工具/探针/无效 fixture 失败在两种模式均返回 2。自动化读取 status 或启用 strict，不以 entryFound 推断成功。比较器通过返回 0、差异/证据不足及上游目标失败/超时返回 1、执行或输入错误返回 2；上游 status 不会因残留值相等而丢失。与检查器 `env-check-cli/v2` 的 0/1/2 含义一致，但保留独立运行协议，目标失败不冒充工具故障。

Trace 是有限探测环境：无限 Proxy 不代表完整 API；定时器只记录意图、Promise 不等待完成且没有完整产物。正式异步交付须使用有完成条件和期限的 runtime。Trace 不注入宿主 native addon；显式请求会报不支持。

CLI 在加载、入口调用及探针收集后分别经过一个宿主事件轮次，收集 Promise 未处理拒绝，再判定状态和落盘。使用 V8 promiseHooks 的 init 回调，在 Promise 创建时以 WeakMap 记录目标求值区间（包括该次 vm 排空的微任务）及阶段；不再访问 Promise 的原型链，改成 null、普通对象或 Proxy 原型均不改变记录。即使 Promise 未被入口返回，也记录具体错误、source=target 和创建时的 load/entry/probe 阶段；正常已处理拒绝不算失败。宿主工具代码区间创建的拒绝为 source=tool；没有创建记录的来源保留 unknown，不据此断言为工具故障。这是单次有限探测运行的执行来源记录，不是任意跨后端 Promise 的 Realm 证明。

这些事件轮次用于 Node 拒绝通知，不执行计时器或提供 I/O 完成保证。CLI 在专用 Worker 中显式启用 Node 的 `--unhandled-rejections=throw`，使拒绝先到达收集监听器；即使启动命令或 `NODE_OPTIONS` 指定了 `strict`，CLI 也会完成分类并写出结果。Trace 的 `--strict` 仍独立控制 Trace 退出码。Worker 使用自己的 Node 启动参数，主线程的显式 Node 参数不会原样传给 Worker。

Promise 创建钩子和拒绝监听器仅在本次运行内存在，finally 停止或移除。`require('.../run_with_trace').run(args)` 在调用方线程运行，保留宿主的 Node 拒绝策略；在启用 Node 严格策略的宿主里，未处理拒绝仍可能终止宿主。需要稳定的结构化产物时使用 CLI。args 使用 CLI 解析后的字段（包括 timeout）；同线程并发调用明确拒绝，共享宿主的其他并行任务不在来源归属契约内。仅启用 V8 init 钩子，避免 vm 终止 Promise 回调时留下 Node async-id 栈不平衡。

Trace 的加载、入口、异步拒绝及探针异常统一规范化：在 vm timeout 内读取 name/message/code 并转换为字符串，单字段最多保留 16,384 个字符，再传给只接受宿主数据的分类器。空字符串、0、false、null 与原始值 throw 保留相应文本；转换自身抛错时标 normalizationFailed/error-snapshot-failed 与 snapshot 操作，不推断成缺方法；转换超时为 timed-out。原始目标对象不会在宿主经过 String、instanceof 或 JSON.parse 的隐式转换。脚本执行关闭 vm 的 displayErrors，防止 Node 自动整理堆栈时在 timeout 外读取目标 stack。

异常 `code` 作为原始细节保留，不单独决定超时。入口、探针和异常快照先在 vm 内捕获普通抛错；vm 中断从执行边界单独记录为 `timeoutEvidence: vm-execution-boundary`。加载原始脚本时保留其全局声明语义，无法添加同样的捕获层；Node 未提供独立标记，因此用其原生错误、预算对应的消息和实际耗时推断，标记为 `vm-signature-and-elapsed`。该标记表示推断，加载脚本若在预算边缘抛出完全相同的错误仍可能无法区分。

各探针必须返回 JSON 字符串并通过对应的结构校验：入口要求自有布尔 `entryFound` 及有效的同步、异步、缺失或异常分支；泄露自检要求完整检查字段及正确类型；事件需要对象元素、类型和摘要使用的路径或属性，异步异常事件还需要规范化的错误字段。有效的缺失入口仍为 `insufficient-evidence`；通道结构损坏则记录对应操作的 `probe-error`，状态为 `execution-failed`，退出码为 2。

### 未知值与诊断默认值

基础环境未知 navigator 字段为 undefined，null 样本不被解释成浏览器事实；已采样/用户值含 `0`、false 和空字符串保留原值。缺目标必需字段时标明具体缺口，可继续独立工作；纯计算任务不被无关设备字段阻塞。

Trace 使用同一未知值策略：缺失 languages 为 undefined，即使只有 language 已知也不会推导第二语言；显式采样数组原样保留，与 browserSources 一致。

只有 `installBaseEnv(..., { diagnosticDefaults: true })` 或 Trace `--diagnostic-defaults` 明确启用固定诊断配置，来源记录为 diagnostic-default；返回的 provenance/Trace configuration 可查，不回写原 fixture，不宣称真实采样。位置 URL 的 example.com 只是未取证时的模板占位，需从返回 provenance 判断，不当作页面事实；正式路径需要地址语义时填写 pageUrl。

## Trace 与本地运行对照

当前路径有 Trace 且差异可能影响产物时，可建立 runtime contract 并对照本地运行。比较顺序、Realm、receiver、descriptor、返回对象、异常和状态时间线时，只选择目标实际依赖的维度。分组观察不能重建丢失的全局先后关系。

用于结论的浏览器 Trace、目标源码和本地 audit 记录资源版本、采集阶段及哈希。哈希不匹配、数据缺失或 audit 未真实执行属于证据/执行问题，不写作 matched。no-send 模式可检查本地请求语义；其结果不能证明网站已接受。

可用 `build_trace_runtime_contract.js`、`run_trace_runtime_audit.js` 与 `check_trace_api_coverage.js`。命令参数见各脚本 `--help`。是否运行深度对照由当前假设与验证成本决定。

## Trace API 覆盖

Trace 可用于发现当前目标路径上的访问、调用、receiver、返回值、异常和顺序。先核对采集来源、页面阶段、资源版本及是否截断，再把观察关联到产物消费点。Trace 未出现某 API 不证明网站从不访问它。

`scripts/import_ruyitrace_log.js`、`scripts/analyze_trace.js` 和 `scripts/check_trace_api_coverage.js` 可整理现有证据。优先验证影响当前目标路径的差异；旧轮次和不同 baseline 不自动合并成当前事实。覆盖矩阵可记录“已观察”“未观察”“证据不足”“不适用”及关联影响，不作为首轮实现所有 P0/P1 API 的统一任务。

需要严格 Trace-runtime 对照时显式选择该检查，并核对源码/证据来源和实际运行观察；工具检查通过仍不是网站接受。

`analyze_trace.js` 按 JSONL 探测事件整理路径、模块建议、缺口及反射风险；不生成 API 覆盖合同，也不证明语义通过。最小入口检查：`node scripts/analyze_trace.js --help`。
