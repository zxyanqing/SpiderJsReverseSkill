# 工具索引

什么时候读本文件：需要查找 `scripts/` 下某个脚本的用途、调用时机或相关文档时。用途来自各脚本 `--help` 或源码头部；**没有 CLI `--help` 的已注明**。默认多为诊断；`--strict` 才对已选差异以退出码 1 验收。工具通过不等于网站接受，见 `references/validation.md`。

格式：`脚本 | 用途（一句） | 何时用 | 相关文档`

## 1. 起步与任务输入

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `init_env_case.js` | 建立中性 `env-fixture/v2` 与任务模板；已有文件默认保留 | 开新 case 或补齐骨架 | `fixture-and-trace.md`、`workflow.md` |
| `check_intake.js` | 解析任务输入，显示已知与未知 | 起步核对材料是否够用 | `workflow.md` |
| `parse_curl.js` | 从 curl 样本抽出可疑参数与位置；样本值不可直接当最终产物 | 只有请求样本、需定位参数字段时 | `network-session.md`、`fixture-and-trace.md` |
| `precheck_runtime.js` | 输出 Node 侧纯计算预检；浏览器侧需另跑同类片段比对 | 正式补环境前做一次宿主能力摸底 | `runtime-frameworks.md` |

## 2. 运行与 Trace

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `run_with_trace.js` | 在探测用 Worker/vm 上下文带访问记录运行目标，收集缺失环境摘要 | 首跑原始 JS、定位缺对象/分支 | `fixture-and-trace.md`、`env-debug-loop.md` |
| `analyze_trace.js` | 汇总 trace / missing-env 为可读摘要 | 跑完 `run_with_trace` 后整理缺口 | `fixture-and-trace.md` |
| `build_trace_runtime_contract.js` | 从原始 Trace 生成逐 API 的 runtime 契约（机器可验证输入） | 有 RuyiTrace/NDJSON，需要行为契约时 | `fixture-and-trace.md` |
| `run_trace_runtime_audit.js` | 强制 no-send 跑项目审计入口并写出 observations | 已有契约，要对 Node 实现做行为审计时 | `fixture-and-trace.md` |
| `check_trace_runtime_conformance.js` | 比较 Trace 行为契约与 Node audit；P0/P1 不一致不可手填绕过 | 契约与 audit 都齐，要做符合性诊断时 | `fixture-and-trace.md`、`validation.md` |
| `check_trace_api_coverage.js` | 检查 Trace API inventory、覆盖矩阵与实现闭环 | 核对 Trace 覆盖与计划外新增 API 说明 | `fixture-and-trace.md` |

## 3. 对照与 fixture

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `compare_fixture.js` | 比较 fixture 期望与实际输出的指定字段 | 本地产物与样本对照 | `fixture-and-trace.md`、`validation.md` |
| `check_fingerprint_fixture.js` | 诊断指纹 fixture 来源、完整性与选定 API 覆盖 | 设备读数回放路径 | `fingerprint.md` |
| `check_result.js` | **无 CLI `--help`**：共享检查协议装饰器（`decorate` / `exitCode` / `HELP`），供其他检查脚本复用退出码语义 | 改检查器协议时读源码；不要当独立 CLI 跑 | `validation.md` |

## 4. 环境真实性与对象检查

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `check_env_realism.js` | 对当前源码做启发式真实性诊断；addon 等项需显式 `--require-*` | 怀疑描述符/原型/native 缺口时 | `env-object-model.md`、`fingerprint.md` |
| `check_object_shape_audit.js` | 检查对象形状 baseline / Node audit 与私有状态泄露 | 目标枚举 ownKeys、descriptor 时 | `env-object-model.md` |
| `check_webapi_env_detection_matrix.js` | 检查环境检测矩阵与 browser/Node audit 是否闭环 | 完整性检测或多通道反射路径 | `env-object-model.md`、`env-debug-loop.md` |
| `check_webapi_addon_coverage.js` | 提示 native-like 实现中普通函数/宿主复用等潜在差异 | 已选用 addon 或 native-protect 并需审计时 | `addon-api.md`、`env-object-model.md` |
| `check_node_leakage.js` | 列出宿主常见泄露变量与目标上下文阻断清单 | 怀疑 `process`/`Buffer`/`require` 暴露时 | `runtime-frameworks.md` |

## 5. 网络与会话

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `check_xhr_fetch_semantics.js` | 比较 browser/Node 网络 transcript 的请求响应与会话字段 | 脚本内 XHR/fetch 语义要对齐时 | `network-session.md` |
| `check_xhr_fetch_session_bridge.js` | 检查 XHR/fetch 是否仅为 mock，或已接 live session bridge | 需要真实会话复用 TLS 客户端时 | `network-session.md` |
| `check_tls_clients.js` | 检测可选 TLS 指纹兼容客户端是否可用 | 最终请求前选 TLS 封装时 | `network-session.md` |
| `check_dynamic_resources.js` | 检查已选资源清单与内容哈希；可要求运行时刷新 | 资源会轮换、需证明用了当时获取的材料时 | `fixture-and-trace.md`、`validation.md` |

## 6. 浏览器采集与工具安装

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `check_external_tools.js` | 检测 ruyiPage / RuyiTrace / CloakBrowser / Camoufox 等外部工具状态 | 取证前确认工具链 | `browser-evidence.md` |
| `capture_ruyitrace_log.js` | 确认 RuyiTrace 后自动或协助捕获 NDJSON | 需要浏览器 Trace 时 | `browser-evidence.md`、`fixture-and-trace.md` |
| `import_ruyitrace_log.js` | 导入 NDJSON、生成摘要并标记疑似截断字段 | 已有 Trace 日志要入库时 | `fixture-and-trace.md` |
| `analyze_trace_complexity.js` | 基于 Trace 评估补环境复杂度与优先级（不自动选型运行时） | 理解项目难度、排优先级时 | `workflow.md`、`runtime-frameworks.md` |
| `download_ruyi_tool.js` | 下载 RuyiTrace / ruyiPage Firefox 等工具（可 `--dry-run`） | 本地缺取证二进制时 | `browser-evidence.md` |
| `install_ruyipage_runtime.js` | 规划或执行 ruyiPage 定制 Firefox runtime 安装 | 选用 ruyiPage 且 runtime 未就绪时 | `browser-evidence.md` |
| `generate_hook_templates.js` | 生成可 install/uninstall 的定位 Hook（IIFE return 控制句柄；闭包 WeakSet 记已包装身份，不写 Proxy/函数自有标记；不挂 window）；缺失 API 保持缺失；默认摘要日志、无 debugger | 需要浏览器侧插桩模板时 | `hook-templates.md` |
| `generate_manual_probe.js` | 生成只读浏览器探针脚本（控制台执行回传 JSON） | 自动化取证不可靠、需人工读数时 | `browser-evidence.md` |
| `generate_fingerprint_hook.js` | 生成指纹终端 API 采样 Hook（仅取证，不进正式交付） | 采集 canvas/WebGL 等读数时 | `fingerprint.md`、`hook-templates.md` |

## 7. native 与运行时

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `load_native_addon.js` | 按平台加载随包 `addon.node`，报告导出与缺失 | 选用 addon 前确认二进制可加载 | `addon-api.md`、`runtime-frameworks.md` |
| `check_node_runtime_compat.js` | 检测当前 Node/ABI/nvm 与目标组件声明版本，只给建议不切换 | 加载失败或 ABI 可疑时 | `runtime-frameworks.md` |
| `check_xbs_isolated_vm.js` | 检测随包 xbs isolated-vm 能否在当前平台/ABI 加载并自检 DOM API | 选用 xbs 前；平台矩阵见 `runtime-frameworks.md` | `xbs-isolated-vm-api.md`、`runtime-frameworks.md` |

## 8. 记录、聚合与交付

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `check_environment_closure.js` | 按 `--checks` 聚合多项环境诊断；默认诊断，`--strict` 验收已选项 | 组合回归或交卷前自检 | `validation.md`、`integration-self-check.md` |
| `write_stage_report.js` | 把实验/验证字段整理成阶段报告；不决定任务是否结束 | 需要结构化实验记录时 | `records-and-delivery.md` |
| `check_stage_reports.js` | 查看或要求指定阶段报告存在 | 核对记录是否齐全 | `records-and-delivery.md` |
| `check_change_memory.js` | 记录关键变更的证据与可恢复判断 | 大改前留痕或要求变更说明时 | `records-and-delivery.md` |
| `check_final_artifact.js` | 检查入口与样本复用；`--file`/源码清单纳入扫描；零覆盖不得 passed | 交付前核对入口与产物边界 | `records-and-delivery.md`、`validation.md` |
| `check_code_quality.js` | 启发式代码组织诊断；行长/模块数不代表网站接受 | 需要组织性提示时 | `records-and-delivery.md` |
| `clean_case.js` | 清理 case 内临时/缓存/中间产物；默认保留疑似登录态 | case 收尾或减小体积时 | `records-and-delivery.md` |
| `write_markdown_utf8.js` | 以 UTF-8 写 Markdown，避免 Windows 默认编码把中文写成问号 | 写交付总结或中文文件名时 | `records-and-delivery.md` |

## 9. 内部库与特殊依赖

| 脚本 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `fixture_schema.js` | **无 CLI `--help`**：共享 `normalizeFixture`，供运行/对照脚本解析 `env-fixture/v2` | 被其他脚本 `require`；不要当 CLI | `fixture-and-trace.md` |
| `check_web_verify_patcher.js` | 检查兄弟 skill `web-verify-patcher` 是否已安装并给出指引 | 任务要把验证码/轨迹交给该 skill 前。**依赖兄弟 skill；随其弃用再处理** | （兄弟 skill；本 skill 不扩展其路由） |

## 示例与探针（非 `scripts/`）

| 资产 | 用途 | 何时用 | 相关文档 |
| --- | --- | --- | --- |
| `assets/examples/jsdom-composition.js` | jsEnv + jsdom 正式初始化的最小组合示例 | 有 DOM 需求时的组合方式 | `runtime-frameworks.md` |
| `assets/examples/jsdom-trait-probe.js` | 初始化后只观察 jsdom 自身可检测特征，输出 JSON | 用了 jsdom 后做本地已知差异自检 | `runtime-frameworks.md`（分层原则 / jsdom 自身特征） |

## 测试与依赖

- 安装测试依赖（含精确版本 `jsdom@24.1.3`）：在 skill 目录执行 `npm ci --ignore-scripts`。
- 运行全部测试：`npm test`。
- `node_modules/` 只用于测试与示例（如 jsdom 组合与特征探针），不是正式交付运行时；已在 `.gitignore` 中。
