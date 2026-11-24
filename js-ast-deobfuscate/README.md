# js-ast-deobfuscate

独立的 Cursor Skill：先用内置 REGISTRY（**方案 A**）证据驱动多轮解混淆；A 卡住后**自主分析主混淆形态**，再生成样本作用域窄脚本（**方案 B**），安全口径对齐 A（子进程求值、失败关闭）。

## 仓库结构

```text
js-ast-deobfuscate/
├── SKILL.md                           # Cursor Skill 入口（A → M → B）
├── scripts/
│   ├── run-round.mjs                  # 方案 A：选插件 → runUntilStable → 报告
│   ├── scaffold-narrow-runner.mjs     # 方案 B：窄脚本脚手架
│   └── templates/narrow-runner.mjs.template
├── references/
│   ├── capability-matrix.md           # 能力矩阵 + A/B 形态映射
│   ├── morphology-to-narrow.md        # 形态分析 → 窄脚本手册
│   └── commands.md
├── evals/evals.json
└── tools/deobfuscator/                # 运行时（REGISTRY / 插件 / 回归 fixture）
```

不含教程草稿、浏览器演示页或 `node_modules`（克隆后自行安装）。

## 工作流（摘要）

1. **A**：从矩阵选 implemented 插件，多轮到收敛 / maxRounds  
2. **M**：对 residuals 写 `morphology.json`（dominant morphology + evidence）  
3. **B**（可选）：`scaffold-narrow-runner.mjs` → 填 `narrow/<id>/runner.mjs` → 跑通后得到 `best.js`  

旋转数组、Geetest 式 **XOR 字符串引导表**、含声明/分支的状态机 case：**A 仍 gaps**；证据够时走 **B**（例如 `encoded-bootstrap-dispatcher` 字符串回写），不要把 gist 的主进程 `eval` 搬进 REGISTRY。

已入库通用扩展（A）：

- `dead-branch`：静态真/假 if 与三元死分支  
- `restore-sequential-dispatcher`：支持 `'0,1,2'.split(',')` 顺序表  
- `string-decrypt-chain` / `restore-explicit-state-machine`：stage7/8 通用子集  
- `normalize-object-ref-state`：对象身份状态表 → 稳定数字 id（子进程）  
- `cleanup-concat-decoy`：解密后 concat-decoy / 无引用 namespace 引导壳清理  
- `restore-for-switch-state`：`for (; state !== EXIT;)` 线性展平  
- 回归：`npm run test:extras`（含 `test:a-promote`）

## 安装

```bash
cd tools/deobfuscator
npm install
```

需要 Node.js（ESM）。

## 快速跑一轮（A）

```bash
node scripts/run-round.mjs \
  --in path/to/input.js \
  --out path/to/out.js \
  --plugins literal-string,constant-fold,static-array \
  --report path/to/round1.report.json
```

也可用 CLI：

```bash
cd tools/deobfuscator
node src/index.js ../path/input.js -o ../path/out.js --plugins constant-fold
```

## 脚手架窄脚本（B）

```bash
node scripts/scaffold-narrow-runner.mjs \
  --id my-sample \
  --morphology encoded-bootstrap-dispatcher \
  --out-dir narrow/my-sample
```

然后按 `references/morphology-to-narrow.md` 填 guards，再：

```bash
node narrow/my-sample/runner.mjs --in after-a.js --out best.js --report narrow/my-sample/b.report.json
```

## Cursor 使用

权威目录：`/Users/zhangxiaoyong/DDTJ_work/js-ast-deobfuscate`。  
Cursor 安装可用软链指向本仓（便于实况编辑），例如 `~/.cursor/skills/js-ast-deobfuscate` → 本仓。GitHub 发布请用完整拷贝，不要依赖软链。

触发描述见 `SKILL.md` frontmatter。

## 合规

仅处理自建、明确授权或公开练习靶样本。未授权第三方生产脚本一律停止。

## 与 AST_Study 教程的关系

能力边界与证据口径对照原教程第 6～9 阶段；矩阵正文已写入 `references/capability-matrix.md`，本仓**不依赖**外部 `docs/` 路径即可运行。
