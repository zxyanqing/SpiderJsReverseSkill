# 浏览器证据与采集

什么时候读本文件：需要从浏览器取证、核对动态资源时效、定位入口与消费点、处理 `isTrusted`，自动化读数不可靠时改用人工只读探针，或使用 Ruyi / Camoufox 等采集工具时。

## 人工只读探针

自动化取证不适用或不可靠时，可生成**只读**浏览器脚本，由用户在指定真实页面执行并回传 JSON。**非**每任务前置；无法取得浏览器数据时继续不依赖它的工作，未知标未知。

```text
确定缺少哪些信息
→ 判断自动化读数是否适用
→ 若不适用，生成只读脚本与简明操作步骤
→ 用户在指定真实页面执行并回传 JSON
→ 校验页面来源、浏览器版本与字段
→ 更新画像，或确认属性应保持缺失（见 env-discovery「保持缺失」）
```

探针要求：

- 显式打印并返回 JSON；区分缺失 / `false` / `0` / `""` / 读取异常。
- 高熵 UAData 等额外字段单独询问，不一次采集无关内容。
- **只读**：不改浏览器属性；不读 Cookie、密码、Keychain。
- 输出异常或仅 `undefined` 时给出可复制的取值方式。

可选生成：`node scripts/generate_manual_probe.js --out probe.js`（默认字段可改）。生成物须在真实页面控制台粘贴执行；结果用于更新画像或支持「保持缺失」决策，不得当作未插桩基线。

## 浏览器观察

选择能取得当前所需证据的浏览器和采集方式：用户已选工具、普通浏览器、ruyiPage/RuyiTrace、Camoufox、CloakBrowser 或手工材料均可按任务条件使用。工具改变可能影响可见值、事件和网络行为，记录版本、profile、页面阶段、会话及采集动作。工具失效时利用已有证据继续独立分析，并为缺口选择替代观察方法。

采集以消费点为中心：页面或脚本加载顺序、相关 API 调用和返回对象、存储写入、网络请求/响应、导航、异步完成点及错误分支。成功样本缺失时从网站可见流程建立接受和拒绝的判别方式。若自动交互与人工交互产生不同事件，见下文「输入事件与 isTrusted」。

Trace、Hook、HAR、截图和控制台日志各有覆盖范围。记录原始证据与采集变换；不因工具名称自动认定样本更真实。动态资源见下文「动态资源有效期」；专项 ruyiPage / Camoufox 命令见下文「ruyiPage 与 RuyiTrace 工具」「Camoufox 采集」。

## 取证上下文与生命周期身份

关键浏览器证据须带齐**可限定结论的上下文**；缺项则结论只能降级为线索，不得自动升格为「本次正式路径证据」。Frame／世界／生命周期身份须**双方均有非空有效值且一致**才可正式合并或肯定同生命周期；**任一方缺失／`null`／双方都缺**一律视为未知（降级线索／拒绝默认复用），不得把「双方都未知」当成「相同」。借鉴多世界／Frame／跨导航边界的记录方法，落入本 Skill 语义；**不**新建全工具首检平台。

| 维度 | 记录什么 | 常见误用 |
| --- | --- | --- |
| 页面／导航身份 | URL、导航／刷新世代、文档加载世代或等价 session／navigation id | 同 URL 旧生命周期调用当成当前证据 |
| Frame | 主 Frame vs 子 Frame（URL／name／稳定选择子）；跨 Frame 须显式标注 | 子 Frame 与主 Frame 同名 API 证据无标注混用 |
| 执行世界 | 主世界（page／main）vs 隔离世界（isolated／content-script 等） | 隔离世界读数冒充页面自有全局 |
| 采集窗口 | 起止时间、是否可能截断（log cap／buffer 满） | 「未观察到调用」不区分：截断 vs 未执行 vs 错上下文 |
| Hook／Trace 状态 | 是否已 install、是否已 uninstall／正式去钩、采集时是否仍挂着诊断钩 | 带钩样本当未插桩基线；清理后仍当本轮证据 |
| 取值时点 | **事件发生时**的值 ≠ 追踪结束后的安全快照 | 把结束后快照写成事件瞬时值 |

限定规则：

1. **子 Frame**：与主 Frame 的同名 API／存储／Cookie 观察必须分条记录；合并结论须说明为何可比。
2. **同 URL 刷新／再导航**：新生命周期开始后，旧样本默认失效；默认「同生命周期」须 URL／导航世代／**Frame／世界**均有效且一致（双缺≠相同）。跨 Frame／跨世界不得静默复用；仅当结构化字段 `attested===true` 且 `allowCrossContext===true` 时才可有条件复用；`conditions` 文本仅作说明，**不授予、不否决**许可。
3. **日志 cap／采集窗口／上下文／命中计数**：空结果或「未见调用」须标注 `possibly_capped`／截断未知；**仅当** `hits` 为已知有限数字且 `=== 0`，且**采集窗口**已知有效并覆盖目标执行阶段、Frame／世界与期望均**有效且一致**（双缺≠相同），才能主张「未执行」；`hits` 缺失／非有限／非零未知不得 `proveAbsence`，上下文／窗口／cap／观察器不能补足计数；不能单凭空日志或缺项上下文证明目标未访问环境。
4. **主／隔离世界**：读页面自有全局或包装页面函数时用主世界；默认隔离世界的结果不得直接当作页面契约。
5. **清理边界**：`uninstall`／去钩／清 buffer **只**影响本次干预与诊断数据；不得假定已恢复其他 Realm 或外部 Context。正式路径就绪须能证明控制句柄完整（含可核查的 `patches` 数组状态）；仅有 `uninstall`、无完整补丁状态不得冒充已卸载。正式验收关闭 Hook 见 `references/hook-templates.md`。
6. **无浏览器**：本节不阻塞本地 jsdom／Node 路径；缺浏览器证据时标未知并继续不依赖它的工作（见 `references/workflow.md`「无浏览器／本地启动」）。

人工探针若在真实页面执行，回传 JSON 时应附带页面 URL、是否 iframe、执行世界（若可知）与采集时间，以便按上表限定。

可编程辅助（与上表同口径，供标注／合并／清理边界判断；**不是**浏览器本体）：`scripts/evidence_lifecycle.js`（`mergeSameApiEvidence`／`canReuseAfterRefresh`／`interpretNoObservation`／`afterCleanup`／`realmStateFromHookControl`／`annotateEvidenceSample`）。Hook 路径清理见 `references/hook-templates.md`。

### 工具能力与检测

ruyiPage 通过 Firefox WebDriver BiDi 提供网络、Cookie、Storage 和交互观察；RuyiTrace 的定制 Firefox 可输出 DOM/JS API 的 NDJSON 调用记录。Camoufox 和 CloakBrowser 提供不同的 Firefox/Chromium 采集配置。选用任何一种工具时核对 Python/Node 包、浏览器二进制、实际启动入口和版本；包可导入不等于浏览器已安装。

```bash
node scripts/check_external_tools.js --markdown
node scripts/check_external_tools.js --python python --require-camoufox --markdown
node scripts/check_external_tools.js --require-cloakbrowser --markdown
```

RuyiTrace 自动采集与导入命令见下文「ruyiPage 与 RuyiTrace 工具」。Camoufox 可用 `python -m camoufox path` 核对浏览器本体；CloakBrowser 的 Python 和 Node 安装路径分别由 `python -m cloakbrowser info` 与 `npx cloakbrowser info` 核对。若用持久化 profile，对请求、Trace、指纹和本地对照注明同一配置；若切换工具，重新评价可比字段。

自动化交互可能改变 `isTrusted`、激活状态、事件时序或网络特征。判断某个结果为何不同，需要保存触发动作和实际浏览器响应，而不只保存一张截图或最终参数。

### 受控替换时的工具核实

浏览器也可承担 `references/controlled-substitution.md` 中的诊断实验。选择前核实注入时点、上下文覆盖、真实命中及反馈观察能力；已发生的调用不能由事后安装证明覆盖。包装和记录可能改变描述符、身份、时序与分支，用干预对照识别。工具只支持观察时改选方法，不假定其支持任意环境注入。

## 动态资源有效期

HTML、bundle、chunk、challenge JS、内联配置和 seed 可能随页面、会话或时间更新。记录 URL、获取时间、响应状态、内容哈希、关联会话和被目标代码消费的位置。分析快照与运行时输入分开。

当资源更新影响当前产物时，在相同网站流程中重新取得并复测；稳定资源可复用。无需默认让所有项目每次运行重新下载全部资源。哈希不匹配或不同阶段资源混用应作为证据问题呈现。

## 原始代码入口与消费点

从网站可观察的请求、Cookie、Storage、导航或返回值出发，追踪数据来源、目标函数入口、结果构造与最终写入者。source → entry → builder → writer 是一种有用的记录视图，实际项目可只有其中部分层次。

Hook、断点或静态搜索用于定位线索；最终以原始目标路径的调用栈、输入与消费行为确认。压缩或动态加载脚本记录资源版本和定位方式。目标代码涉及 Wasm、Worker 或事件回调时，入口可能跨异步边界。

## 输入事件与 isTrusted

当目标分支读取 `event.isTrusted`、pointer/keyboard 序列或用户激活状态时，记录实际触发方式、事件顺序、目标节点与页面阶段。自动化、脚本合成和人工输入可能产生不同事件；对照结论注明来源。

若某个关键行为只在特定交互下出现，选择能观察该交互的工具或用户提供的材料。补环境实现按目标实际使用的事件契约和状态边界建模，避免把单次事件样本泛化为所有交互。

## ruyiPage 与 RuyiTrace 工具

需要特定浏览器观察或细粒度 API Trace 时，先检测本机可用工具及版本，再按其当前接口采集。RuyiTrace 的 NDJSON 可用 `scripts/import_ruyitrace_log.js` 导入，`scripts/analyze_trace_complexity.js` 可整理调用线索。导入内容与本地运行日志标明各自来源。

工具记录包含 profile、页面阶段、资源、采集动作、日志完整性和可能的截断。自动化采集只覆盖它执行过的路径；未记录 API 不代表目标从不调用。工具不可用时保留现有材料，并继续可独立进行的目标 JS 分析。

安装或运行参数以本机工具文档与 `scripts/* --help` 为准。此工具是可选观察方式，不决定本地运行时和最终网络客户端。

### NDJSON 采集与长值

在选用 RuyiTrace 且工具可用时，可先预览采集命令，再执行并导入当前页面阶段的日志：

```bash
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --dry-run --markdown
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --duration 90 --import-after --markdown
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir case --truncation-threshold 3900 --markdown
```

手工采集时记录 trace Firefox 的路径、profile、起止时间及动作，再导入 `trace_<时间戳>_<PID>.ndjson`。若自动采集没有输出日志，记录采集失败；日志缺失不表示目标没有访问环境。可按 `api`、`stack.file/line/col` 聚合访问，但关联到当前目标产物时还需核对脚本版本与时间线。

Trace 中接近采集阈值（例如 3900 字符）的长 token、dataURL、body 或对象序列化可能只是可见片段。记录 `visibleLength`、截断疑点和实际长度未知；需要完整值时从 Network/HAR、消费点 Hook 或其他可核查来源取得长度与 SHA-256。可见片段不作为完整 fixture 期望。

## Camoufox 采集

Camoufox 可用于需要 Firefox 环境观察的任务。确认当前可用版本和工具接口后，记录 profile、代理、页面阶段、输入动作、网络与对象采样。它产生的是该配置下的观察，切换工具时重新评估可比性。

若工具不可用，保留已有材料并选择其他可行观察方式；不因某个采集器缺失停止本地 JS 分析。采集到的浏览器行为与本地运行结果分开保存。
