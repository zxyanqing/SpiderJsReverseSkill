# Morphology → Narrow runner（A 之后的 B）

在 **scheme A（REGISTRY）** 收敛后使用。目标：用证据钉死**主混淆形态**，再生成**仅服务该样本**的窄脚本，安全口径对齐 A（子进程求值、失败关闭）。

## 何时进入 B

| 条件 | 动作 |
|------|------|
| A 后无重要 residuals | 停止；报告成功 |
| residuals 存在但证据不足 | `recommend: stop`；列出缺什么证据 |
| residuals 存在且 `morphology_id` 可映射 | `recommend: generate-narrow` |
| 用户明确只要 A | 不做 B |

## 与 F1 家族层衔接

在 M 之后（或路径/hint 已知时）跑：

```bash
node scripts/detect-family.mjs <best-or-input.js> [hint] family.json
```

- `family.json.selected.a_plugins`：可用来重跑更贴家族的 A（仍是 REGISTRY，非站点 pass）
- `b_scaffold_hints`：生成 B 时优先对照；**不**自动执行 AD 站点 `*-pass.js`
- 家族文档：`references/families/*.md`

若 F1 命中且 hints 与 `morphology_id` 冲突，以**样本证据**为准，家族文档只作参考。

## 分析清单（写进 morphology.json）

对 **原始输入 + A 的 best-so-far** 做只读扫描（`rg` / 有界 AST 抽样），记录：

1. 入口壳：IIFE / `Program.body` 前几段是否含 `decodeURI`、XOR、`fromCharCode`、大字符串表  
2. 字符串：`$_fn(数字)` 调用密度；是否 NumericLiteral 数组解码（A 已覆盖）  
3. 控制流：`while(true)+switch(order[cursor++])` vs `for(;state;)+switch(state)`；case 标签是否字面量  
4. 对象映射 / 成员字符串键是否仍被包装调用挡住  
5. 环境：未绑定 `window`/`document`（B 默认不补桩）

每条形态必须有 **可引用证据**（行号或短代码切片）。

## morphology_id 表（可扩展）

| morphology_id | 识别线索 | A 对应 | B 窄脚本职责 |
|---------------|----------|--------|--------------|
| `numeric-decrypt-chain` | 数字数组 + 解码函数 + 常量调用 | `string-decrypt-chain` | 通常不必 B；A 失败时查闭包白名单 |
| `string-array-rotator` | 数组 + `push/shift` 旋转后再解码 | gap | 证明旋转只一次 → 拼入闭包 → 子进程求值 → 回写调用点 |
| `encoded-bootstrap-dispatcher` | 前几段引导表 + 包装函数 + 海量 `fn(n)`；常伴 `for+switch(state)` | `geetest-like-xor-string` gap | 抽取引导闭包（子进程）→ 替换包装调用为字面量 → 再视情况线性/半自动展平 |
| `split-order-dispatcher` | `'a,b'.split(',')` + while/switch | `restore-sequential-dispatcher` | 通常不必 B |
| `linear-explicit-state` | `state=LIT; continue` 或 for-neq+break 线性 | `restore-explicit-state-machine` / `restore-for-switch-state` | 通常不必 B |
| `object-ref-state-machine` | `table()[i][j]` 对象身份当 state | `normalize-object-ref-state` | 通常不必 B；正规化后交给 A 展平 |
| `post-decrypt-dead-shell` | concat-decoy / 死引导壳 | `cleanup-concat-decoy` | 通常不必 B |
| `branching-explicit-state` | 条件赋 state / 回边 / 不安全 case 体 | gap | 默认半自动报告边表；**不**强行一键拼接 |
| `object-string-map` | 静态对象映射被常量键访问 | `object-map` | A 即可 |
| `unknown` | 无法归类 | — | 禁止瞎生成 B |

一次 B 迭代只打 **一个** `dominant.morphology_id`。

## B 脚本必须遵守

1. 路径：`narrow/<sample_id>/runner.mjs` + `notes.md` + 可选 `morphology.json` 副本  
2. CLI：`--in` `--out`（可选 `--report`）  
3. 复用 `tools/deobfuscator/src/lib/evaluate-in-child.js`（或同等 spawn 协议）  
4. 禁止：主进程 `eval` / `new Function` 执行样本整包；万能 Proxy 环境  
5. Guard 失败：保留原节点或整体退出，并写 reason  
6. 成功后：用 A 的静态插件再跑一轮收尾（`dead-branch` / `member-simplify` 等）更稳  

## 与「理想 out」对照时

允许用理想文件做**行为/导出符号**对照，但不得为了字节级相似而放松 guard。报告中区分：

- B 已证明关闭的形态  
- 仍 gap 的形态  

## 晋升 REGISTRY（可选）

仅当用户要求「把该窄形态通用化」时：抽公共 guard → 新插件 + fixture + 矩阵行。默认 B 保持样本作用域。
