# Commands

所有路径默认相对 **本 Skill 仓库根目录**（含 `SKILL.md` 与 `tools/deobfuscator`）。

可选覆盖：

```bash
export DEOBFUSCATOR_ROOT=/abs/path/to/tools/deobfuscator
```

## Locate deobfuscator

```bash
cd tools/deobfuscator
npm install   # 首次
```

## List plugins

```bash
cd tools/deobfuscator
node -e "import { listPlugins, listDefaultPlugins, listOptionalPlugins } from './src/transform.js'; console.log('all', listPlugins().join(',')); console.log('default', listDefaultPlugins().join(',')); console.log('optional', listOptionalPlugins().join(','))"
```

## Single transform (CLI)

```bash
node src/index.js path/to/input.js -o path/to/output.js --plugins literal-string,constant-fold,static-array
```

- Omit `-o` → print to stdout
- Prefer **explicit** `--plugins` from the round plan
- `rename-identifiers` 仅在显式列入时运行

## Skill round helper (preferred for reports)

从 Skill 根目录：

```bash
node scripts/run-round.mjs \
  --in /abs/or/rel/input.js \
  --out /abs/or/rel/output.js \
  --plugins literal-string,constant-fold \
  --report /abs/or/rel/round1.report.json \
  --max-inner 6 \
  --timeout-ms 120000 \
  --reparse
```

Uses `runUntilStable` on the selected plugin factories so each Skill outer round can still converge internally.  
`--timeout-ms` / `--reparse` / 报告内 `elapsedMs` 为 Phase 3 工程化选项。

## F1 family detect

```bash
node scripts/detect-family.mjs path/to/input.js [hint] family.json
```

## Residue metrics / compare

```bash
node scripts/collect-residue-metrics.mjs path/to/best.js metrics.json
node scripts/compare-with-reference.mjs path/to/best.js path/to/reference.js diff.json caseId
```

## Scheme B narrow scaffold

A 收敛后若 `morphology.json` 建议 `generate-narrow`：

```bash
node scripts/scaffold-narrow-runner.mjs \
  --id <sample_id> \
  --morphology <morphology_id> \
  --out-dir narrow/<sample_id>
```

填完 guards 后：

```bash
node narrow/<sample_id>/runner.mjs \
  --in after-a.js \
  --out best.js \
  --report narrow/<sample_id>/b.report.json
```

Playbook：`references/morphology-to-narrow.md`。脚手架默认 exit 2，直到去掉 “scaffold only” 实现。

## Regression smoke (optional)

```bash
cd tools/deobfuscator
npm test
npm run test:c8
npm run test:stage78   # c7-decrypt + c8-state + c8
npm run test:phase1    # AD 迁入通用插件
npm run test:extras
```

Do not treat test suite success as proof the user’s sample is fully restored.

## Evidence docs

能力与安全边界见 `references/capability-matrix.md`（已对照原 AST_Study 教程 06～09 写入；运行不依赖外部 `docs/`）。
