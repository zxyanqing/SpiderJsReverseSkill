# 浏览器 Hook 模板

什么时候读本文件：需要 Hook 采集代码，定位参数生成路径、调用栈或状态变化时。

权威生成器：`scripts/generate_hook_templates.js`。本文件说明使用规则与改变面；示例以生成器输出为准，勿再手写旧版「无条件覆盖 `window.fetch` / 打印原值 / 默认 debugger」模板。

## 使用规则

- 记录目标 API、参数名、页面 URL、会话和采集阶段。
- **仅包装安装时已存在且可安全包装的方法/访问器**；缺失属性（含 `fetch`）保持缺失，不伪造。
- 默认日志为**摘要**（属性名、操作种类、类型、长度），**不**打印 Cookie、令牌、请求体等原值。
- 默认**不**插入 `debugger`；需要时对生成器加 `--debugger`。
- 生成脚本为 IIFE，**`return` 控制句柄** `{ install, uninstall }`；宿主用 `const control = window.eval(code)` / `vm.runInContext` 接收并持有。**禁止**把控制对象挂到被测 `window`/`globalThis` 的调试自有字段（含 `__webJsEnvHookControl`）。
- 卸载前若页面已再次改写同一方法/访问器，**保留页面新版本**，不盖回 Hook 前旧实现。
- **已包装身份**记在生成代码闭包内的 **WeakSet**（无 WeakSet 时用数组回退）；**禁止**给包装目标 / Proxy 写 `Symbol` 或 `__webJsEnvHookWrapped__` 自有属性（会污染原始 Function/WebSocket，导致 uninstall 后重装静默跳过）。诊断细节另用 WeakMap。
- **不**在被测对象上添加 `__reverse_*` 或控制句柄自有字段；window 仍无调试控制字段。
- 不可安全包装的 descriptor **跳过**并保留原状态；同一 control 重复 install 不得叠加包装。
- **正式验收关闭** Hook：宿主调用 `control.uninstall()` 后再跑消费方验收；卸载后 `window` 上仍不应出现上述控制字段。Hook 不要求完全透明。
- 带钩样本须按 `references/browser-evidence.md`「取证上下文与生命周期身份」标注 Frame／世界／导航世代与 Hook 状态；不得把诊断会话证据直接当正式未插桩基线。可用 `scripts/evidence_lifecycle.js` 的 `annotateEvidenceSample`／`realmStateFromHookControl`／`afterCleanup` 与真实 `control.uninstall()` 对齐（清理**只**影响本句柄 Realm）。

### 多份生成代码 / 多 control（本轮边界）

闭包 WeakSet **不跨**多次 `eval` 的生成代码共享。同一 `window` 上再执行第二份生成代码时，第二句柄可能 `patches.length === 0` 或叠出新包装；`uninstall` **只**恢复**本句柄**安装的补丁。

**宿主须复用并保留首个有效 control**，不要用「最新返回值」覆盖旧句柄后指望它清掉已有 Hook。跨生成代码的共享身份注册**不是**本 Skill 默认交付，也不在本轮合成验收范围内；需要时由项目宿主显式传入/持有外部注册表。

```bash
node scripts/generate_hook_templates.js --param sign --api-pattern /api/ --types fetch,xhr,cookie,storage --out case/hooks/hooks.js
node scripts/generate_hook_templates.js --debugger --types cookie --out case/hooks/cookie-debug.js
```

合成回归：`tests/hook-templates-safety.test.js`（T-G6）。

## 改变面与限制

| 会改变 | 覆盖不了 |
| --- | --- |
| 已存在 API 的调用路径上增加摘要日志 | 不可配置描述符、跨 Realm、安装后页面再改写的语义 |
| 可卸载的包装层 | 异步竞态与完整浏览器等价 |

## 证据输出要求

命中后至少记录：命中的 API 或参数名、调用栈、所在脚本位置、是否可复现；敏感值只记长度/类型摘要。
