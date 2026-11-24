# Capability matrix（对照原教程 stage 06～09 口径）

本 Skill **自包含**运行时：`tools/deobfuscator`（本仓）。  
下文 `docs/...` / stage 编号仅作**证据与边界出处**说明（源自 AST_Study 教程）；**运行不依赖**外部 `docs/` 目录。  
插件以本仓 `tools/deobfuscator/src/transform.js` 的 `REGISTRY` 为准；教程出处不能代替入库状态。

Status legend:

- **implemented**：在 `REGISTRY` 中 — Skill 可选入 `plugins[]`
- **tutorial-only**：docs 有方法；无 registry 插件 — 记入 `gaps`
- **analyzer-only**：只读分析，不改写 AST
- **stop**：不自动补全；handoff 或残留

契约总原则（docs/06 `01-安全变换契约.md`）：`match → guard → transform → verify`；匹配 ≠ 可改写；证据不足则 skip 并记原因。  
多轮收敛（docs/06 `02-多轮遍历与收敛.md` + `run-until-stable.js`）：以 `changed===0` / 生成文本稳定停；超 `maxRounds` 视为失败关闭。

---

## Implemented plugins（可安全组合）

| Feature id | Evidence hints（识别） | Plugin | Docs 证据锚点 | 安全边界摘要 |
|------------|------------------------|--------|---------------|--------------|
| sequence-normalize | 语句级 `,` / 三元 / `&&`/`\|\|` / void / 无参 IIFE | `normalize-structure` | AD `normalize-structure`；docs/06 `04` | 非列表 return/if、带 continue 的 for update → skip |
| unicode-hex-string | `\u` / `\x` 字符串字面量需可读化 | `literal-string` | docs/06 出门报告默认链；学习计划「表面规范化」 | 只规范化字面量转义，不碰解密调用 |
| constant-expression | `1+2`、`!![]`、十六进制数值运算 | `constant-fold` | docs/06 `03-常量与条件化简进阶.md`；`09` 组合样本 | 跳过 `NaN`/`Infinity`/动态条件；保持求值顺序 |
| const-literal-propagate | `const x = 1; use(x)` 且 Binding 恒定 | `const-propagate` | docs/06 `05-常量传播与别名.md`；练习 C3 / `12-出门考核报告.md` | 再赋值、前向引用、非基础字面量 → skip |
| inline-literals | constant `var`/`let` 字面量；静态数组下标 | `inline-literals` | AD `inline-literals` | LHS/update/delete 不安全目标 → skip；大样本可配方跳过 |
| static-string-array | `arr[i]`，`i` 为 NumericLiteral，数组为静态字符串 | `static-array` | docs/06 `07-直接索引字符串数组.md`；C4 | **无**旋转/解密；动态索引、写操作、越界 → 整表 skip |
| object-map-fold | `obj.key` / `obj['key']` 只读数据对象 | `object-map` | docs/06 `06-对象映射表折叠.md`；C5 | 函数属性/`this`/写入/动态键 → skip（勿当包装器内联） |
| inline-dispatchers | 对象上薄包装 `return x+y` / 字面量属性 | `inline-dispatchers` | AD `inline-dispatchers` | 多语句函数体不内联；仅全部可收集时删声明 |
| dead-branch | `if (true/false)` / `1===1` / 静态布尔三元 | `dead-branch` | docs/06 `08`；AD prune-fake-branches | 字面量比较 + evaluate 布尔；动态条件 skip |
| string-decrypt-chain | 数字数组 Binding → 解码函数 → `dec(NumericLiteral)`（含一层别名） | `string-decrypt-chain` | docs/07 `01`～`05`；`fixtures/c7-decrypt` | **子进程**求值；未知全局/动态实参/非基础类型 → skip；禁止主进程 eval |
| object-ref-state-table | `table()[i][j]`，单元格为对象引用（可循环） | `normalize-object-ref-state` | 晋升自 Geetest/Dd 形态；`fixtures/object-ref-state` | 子进程 WeakMap→稳定 id；非对象单元格 / 拼不出闭包 → skip |
| unused-pure-binding | 无引用且 init 纯净的 const | `unused-binding` | docs/06 `08-不可达代码与无用绑定.md`；C6 | 「无引用」≠「可删」；`eval`/副作用 init → 保留 |
| concat-decoy-shell | `['$_x'].concat(table); a=arr[1]; arr.shift(); b=arr[0]` 且别名不再被调用 | `cleanup-concat-decoy` | 解密后死壳；`fixtures/concat-decoy` | 仍作 CallExpression → 保留；可顺带剥无引用 namespace 引导壳 |
| member-dot | `obj['push']` → `obj.push` | `member-simplify` | docs/06 出门报告「默认链其它」 | 仅静态成员键表面清理 |
| if-chain-to-switch | `if (op===0) … else if (op===1)` | `if-chain-to-switch` | AD `if-chain-to-switch` | 判别式不一致 / <2 case → skip |
| flatten-array-cf-subset | `for (var order=[…];;) switch` 或 nearby order + while | `flatten-array-control-flow` | AD flatten **可证明子集** | 无对象表管道串；过宽逻辑仍 gaps |
| sequential-dispatcher | `while` + `switch(order[cursor++])`；order 为数组字面量或 `'a,b'.split(',')` | `restore-sequential-dispatcher` | docs/08 `01`/`03`/`04`；C8 fixture（含 split） | 严格 guard；显式状态机走另一插件 |
| explicit-state-machine-linear | `while(true)+switch(state)`，无条件线性 goto + 终端 return/throw | `restore-explicit-state-machine` | docs/08 `05`；`fixtures/c8-state` | **仅线性无回边**；条件边/动态 state → skip |
| for-switch-state-linear | `for (; state !== EXIT;) { switch(state) }` + `state=LIT; break` | `restore-for-switch-state` | `fixtures/for-switch-state` | 宜在 object-ref 正规化之后；case 内 if/声明 → skip |
| debugger-strip | `debugger;` | `remove-debugger` | docs/06 出门报告；docs/09 反调试分类（仅表层） | 只删语句；不伪造环境绕过检测 |
| rename-identifiers | `_0x…` / 单字母绑定 | `rename-identifiers` | AD rename | **可选**；不进 `DEFAULT_PLUGINS` |

默认 registry 顺序（`DEFAULT_PLUGINS`，不含 rename）：

`normalize-structure,literal-string,constant-fold,const-propagate,inline-literals,static-array,object-map,inline-dispatchers,dead-branch,string-decrypt-chain,normalize-object-ref-state,unused-binding,cleanup-concat-decoy,member-simplify,if-chain-to-switch,flatten-array-control-flow,restore-sequential-dispatcher,restore-explicit-state-machine,restore-for-switch-state,remove-debugger`

优先按已识别特征选**窄列表**；docs/06 `09` 建议：先 fold/propagate，再 array/object，**解密链在静态索引之后**，object-ref 正规化 → decoy/壳清理 → 展平放在标签尽量字面量之后。

### Stage 6 对照一览（静态可证明）

| Docs 章 | 教什么 | Skill / REGISTRY |
|---------|--------|------------------|
| `01-安全变换契约` | 四步契约、纯度、`this`、求值顺序 | 硬规则 3～4；所有 implemented 的 skip 理由 |
| `02-多轮遍历与收敛` | changed / maxRounds / 幂等 | 外层 Skill round + 内层 `run-until-stable` |
| `03`～`04` | 常量/条件/序列归一化 | `constant-fold` + `normalize-structure` |
| `05` | Binding 字面量传播 | `const-propagate` |
| `06` | 对象映射表 | `object-map` |
| `07` | 直接索引字符串数组 | `static-array`（≠ 第 7 阶段解密链） |
| `08` | 不可达 / 无用绑定 | `unused-binding`（不可达 if 分支若未单独插件 → 依赖 fold 后形态） |
| `12-出门考核报告` | 正反例与跳过原因表 | 写 round report 时的 reasons 用语参考 |

---

## Tutorial-only / unimplemented（gaps）

| Feature id | 是什么 | Docs 证据锚点 | Skill action |
|------------|--------|---------------|--------------|
| string-decrypt-rotator | 大数组 + `push/shift` 旋转后再解密 | docs/07 `06` 旋转只一次 | **仍 gaps**（当前插件未证明旋转初始化） |
| wrapper-multi-decrypt | 多层薄包装 / 多轮别名（>1 层） | docs/07 `08` | 一层别名已由 `string-decrypt-chain` 覆盖；多层 → gaps |
| geetest-like-xor-string | `decodeURI`+XOR / 非数字数组引导表 | 样本专用 `main_ast.js` 形态 | **gaps**（非通用 C7 形状；勿搬 in-process eval） |
| flatten-object-pipe-order | 对象表管道串驱动的数组序 flatten | AD flatten 全量 | **仍 gaps**（`flatten-array-control-flow` 仅静态子集） |
| explicit-state-machine-branching | 条件边 / 回边 / 非线性状态机 | docs/08 `05`/`06` | **gaps** / 半自动；勿强行展开 |
| cfg-terminator-scope-risk | break/label/try/finally/TDZ/case 声明 | docs/08 `07`/`08`/`09` | `stop` 该骨架 |
| env-dependency-matrix | 未绑定全局与属性链盘点 | docs/09 `01`/`02`；C9 `analyze-environment-deps` | analyzer-only：报告矩阵，不改 AST |
| env-minimal-stub | 缺失即失败的最小桩 | docs/09 `04`；禁止万能 Proxy 伪值 | **stop**，除非用户明确跑 stage-9 实验 |
| env-proto-proxy-replay | getter/描述符/Proxy 观测/时间随机回放 | docs/09 `05`～`07` | 实验/handoff；非 AST Pass |
| browser-hook-network | 真页面 Hook 入口/网络/编码边界 | docs/09 `08`/`09` | handoff 浏览器 MCP；非 AST 改写 |

### Stage 7 分流（静态数组 vs 解密链）

| 形态 | Docs | Skill |
|------|------|-------|
| 字符串数组 + 静态整数下标、无旋转 | docs/06 `07` | `static-array` |
| Numeric 数组 + 解码函数 + 常量实参（无旋转） | docs/07 `01`/`04`/`05` | `string-decrypt-chain` |
| 一层 `var wrap = dec` | docs/07 `02`/`08` | `string-decrypt-chain`（别名） |
| 含旋转/洗牌 IIFE | docs/07 `06` | `gaps` |
| 包装/别名多跳 | docs/07 `08` | `gaps` |

### Stage 8 分流（两类骨架）

| 骨架 | Docs 判别 | Skill |
|------|-----------|-------|
| 顺序数组分发器 | `switch (order[cursor++])`，数组字面量或静态 `split` | `restore-sequential-dispatcher` |
| 显式状态机（线性无回边） | `while(true)` + `switch(state)` + `state=LIT; continue` / 终端 | `restore-explicit-state-machine` |
| for-neq 线性状态机 | `for (; state !== EXIT;)` + `state=LIT; break` / 终端 | `restore-for-switch-state`（先 `normalize-object-ref-state` 若标签是对象引用） |
| 对象身份状态表 | `table()[i][j]` 单元格为对象 | `normalize-object-ref-state` |
| 显式状态机（条件边/回边 / case 内声明） | 条件赋值、环、不安全 case 体 | gaps / 半自动 |
| 普通业务 switch | 业务输入决定分支 | **不要**当平坦化处理 |

docs/08 `10-先解密后展平综合实战.md`：先明文化字符串再展平；若解密链仍为 gap，则展平仅处理已是字面量标签的顺序分发器。

### Stage 9 决策顺序（运行位置）

对齐 docs/09 `00`/`01` 与学习计划：

1. `static` — 能静态钉死就改 AST（回 stage 6 插件）
2. `isolated-eval` — 纯计算解密链（stage 7；Skill 默认 gap）
3. `minimal-stub` — 白名单缺失即抛错（不自动编造）
4. `browser-hook` — Node 成本过高则转浏览器
5. `stop` — 证据不足

矩阵字段（写 env 残留时沿用）：`path` / `access` / `purpose` / `evidence` / `strategy` / `status` / `reason`。

---

## Scheme A → Morphology → Scheme B

A 收敛后若 residuals 仍挡目标：先写 `morphology.json`，再按 `references/morphology-to-narrow.md` 决定是否生成样本作用域窄脚本（B）。

| morphology_id（B） | 典型 A gap / feature | B 是否默认可生成 | 说明 |
|--------------------|----------------------|------------------|------|
| `numeric-decrypt-chain` | `string-decrypt-chain` | 否（优先 A） | A 失败时查闭包白名单，很少需要 B |
| `string-array-rotator` | `string-decrypt-rotator` | 是（证据够） | 证明旋转一次 → 子进程求值 → 回写 |
| `encoded-bootstrap-dispatcher` | `geetest-like-xor-string` | 是（证据够） | 引导闭包 + 包装调用字面量化；对齐 A 安全口径 |
| `split-order-dispatcher` | `restore-sequential-dispatcher` | 否 | A 已覆盖 split 顺序表 |
| `linear-explicit-state` | `restore-explicit-state-machine` / `restore-for-switch-state` | 否 | A 已覆盖 while/for 线性子集 |
| `object-ref-state-machine` | `normalize-object-ref-state` (+ for-switch) | 否（优先 A） | 正规化后能展平则 A；含声明/分支的 case 仍 gap |
| `branching-explicit-state` | `explicit-state-machine-branching` | 半自动 | 边表报告；不强行一键拼接 |
| `post-decrypt-dead-shell` | `cleanup-concat-decoy` | 否（优先 A） | concat-decoy + 无引用 namespace 壳 |
| `object-string-map` | `object-map` | 否 | A 即可 |
| `unknown` | — | **禁止** | 证据不足则 stop |

脚手架：`scripts/scaffold-narrow-runner.mjs` → `narrow/<id>/runner.mjs`。  
B **不得**主进程 `eval` 整包样本；优先复用 `src/lib/evaluate-in-child.js`。  
未经用户明确要求，**不要**把 B 晋升进 `REGISTRY`。

---

## Analyzer-only

| Tool | Path | Docs | Skill action |
|------|------|------|--------------|
| 环境依赖矩阵扫描 | `tools/deobfuscator` → `src/lib/analyze-environment-deps.js`；`npm run test:c9` | docs/09 `01`/`02`/`10` | 报告 deps；不发明 stubs |
| 半自动 CFG / 状态图 | 教程手画 / 未来分析器 | docs/08 `02`/`05`/`09` | 输出停止原因与建议边表；不伪自动还原 |
| 主混淆形态分析 | Skill `[M]` + `morphology-to-narrow.md` | A 后 residuals | 写 `morphology.json`；可触发 B 脚手架 |

---

## 写 round 报告时的证据句式（建议）

- **命中 implemented**：`evidence` 写源码形状 + 可选 `doc_anchor`（上表章名）。
- **记入 gaps**：写清「docs 有方法 / REGISTRY 无插件」，引用 stage 7/8/9 对应章。
- **stop**：写清失败关闭原因（动态索引、`this`、动态 state、未绑定全局等），用语可对齐出门报告反例表。

## Tutorial anchors（人读；非每轮必载全文）

- Stage 6：`docs/06-解混淆模式库/` + `docs/06-解混淆模式库-学习计划.md`
- Stage 7：`docs/07-字符串解密链与受控求值/` + `docs/07-字符串解密链与受控求值-学习计划.md`
- Stage 8：`docs/08-控制流平坦化/` + `docs/08-控制流平坦化-学习计划.md`
- Stage 9：`docs/09-运行环境分析与补环境/` + `docs/09-运行环境分析与补环境-学习计划.md`
- 总口径：`docs/学习路线设计与AI交接手册.md`
