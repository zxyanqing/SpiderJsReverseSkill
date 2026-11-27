#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeFixture } = require('./fixture_schema');

function parseArgs(argv) {
  const args = { caseDir: '', target: '', entry: '', param: '', api: '', force: false, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--dir' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--target') args.target = argv[++i] || '';
    else if (arg === '--entry') args.entry = argv[++i] || '';
    else if (arg === '--param') args.param = argv[++i] || '';
    else if (arg === '--api') args.api = argv[++i] || '';
    else if (arg === '--force') args.force = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return args;
}

function usage() {
  return `用法：
  node scripts/init_env_case.js --case-dir case [--target app.js] [--entry window.run] [--param sign] [--api URL] [--json]

建立中性项目状态。已有文件默认保留；--force 会覆盖本工具生成的模板文件。`;
}

function put(file, content, force, actions) {
  if (fs.existsSync(file) && !force) {
    actions.push({ action: 'keep-file', path: file });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const action = fs.existsSync(file) ? 'write-file' : 'create-file';
  fs.writeFileSync(file, content, 'utf8');
  actions.push({ action, path: file });
}

function initCase(args) {
  if (!args.caseDir) throw new Error('需要 --case-dir');
  const caseDir = path.resolve(args.caseDir);
  const root = path.parse(caseDir).root;
  if (caseDir === root || caseDir.length <= root.length + 2) throw new Error(`不适合初始化的目录：${caseDir}`);
  const actions = [];
  for (const dir of ['js/original', 'fixtures', 'notes', 'env', 'result', 'tmp']) {
    const full = path.join(caseDir, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      actions.push({ action: 'create-dir', path: full });
    }
  }
  const fixture = {
    schemaVersion: 'env-fixture/v2',
    source: null,
    pageUrl: null,
    apiUrl: args.api || null,
    targetCode: args.target || null,
    entry: args.entry || null,
    output: args.param || null,
    browser: { userAgent: null, language: null, timezone: null, screen: null },
    browserSources: {},
    input: null,
    observedOutput: null,
    websiteResponse: null,
  };
  normalizeFixture(fixture);
  put(path.join(caseDir, 'fixtures', 'sample.fixture.json'), JSON.stringify(fixture, null, 2) + '\n', args.force, actions);
  const task = `# 当前任务状态

- 总目标：本地运行原始目标 JS，产生实际消费方接受的结果
- 原始 JS / 资源：${args.target || '待观察'}
- 本地触发入口：${args.entry || '待定位'}
- 目标产物：${args.param || '待定位'}
- 消费方 / API：${args.api || '待观察'}
- 网站接受条件：待观察
- 当前网站反馈：尚未验收

## 当前事实与来源

| 事实 | 来源与阶段 | 配置/会话 | 仍需验证 |
| --- | --- | --- | --- |

## 候选解释与未验证前提

- 假设：
- 依据：
- 未验证前提（入口/分支/产物边界/完成条件等）：
- 其他相关解释：
- 可区分的下一实验：
- 预期观察如何支持或削弱解释：

## 本轮行动与总体目标

- 当前子任务及对总目标的贡献：
- 实现进展：
- 定位进展（哪些解释被支持或削弱）：
- 消费方实际反馈与证据：
- 自主选择的下一动作与理由：

## 当前路径

- 目标执行命令：
- 输出边界：
- 稳定配置：
- 单次动态状态：
- 当前阻碍：

历史实验见 \`notes/experiments.md\`。事实、解释和推荐动作分开；新证据可以修订旧判断。
轮内自主选择观察、修复和本地/在线验证，子任务完成后继续推进总目标。用户采用逐轮授权时，下一轮只需启动授权，不转交常规技术选路。
`;
  put(path.join(caseDir, 'notes', 'env-task.md'), task, args.force, actions);
  const experiments = `# 实验记录

## 实验 001

- 总目标 / 本动作的贡献：
- 主要假设：
- 证据及来源：
- 未验证前提 / 替代解释：
- 改变项 / 保持项：
- 预期观察及判别意义：
- 原始目标路径结果：
- 组合行为与相关回归：
- 实现进展 / 定位进展：
- 网站反馈 / 尚未验收原因：
- 判断更新 / 自主下一步及理由：
`;
  put(path.join(caseDir, 'notes', 'experiments.md'), experiments, args.force, actions);
  put(path.join(caseDir, 'notes', 'env-checks.json'), JSON.stringify({ schemaVersion: 'env-checks/v1', checks: {} }, null, 2) + '\n', args.force, actions);
  const memory = `# 代码变更记录

记录关键源码变更的证据、影响路径、验证结果及可恢复方式。历史决定可由新证据修订。

| 时间 | 文件 / 模块 | 假设与证据 | 变更 | 目标路径结果 | 网站反馈 | 当前判断 |
| --- | --- | --- | --- | --- | --- | --- |
`;
  put(path.join(caseDir, 'notes', '代码变更记忆.md'), memory, args.force, actions);
  // Y04: optional multi-identity resource manifest (fields may stay null; old cases omit entirely).
  const resourceManifest = {
    schemaVersion: 'resource-manifest/v1',
    identity: {
      runtime: null,
      fixture: null,
      patchRevision: null,
      config: null,
      notes: '多身份分开记录：脚本/WASM 内容哈希 ≠ runtime/fixture ≠ 环境补丁修订 ≠ 配置；见 references/records-and-delivery.md「复现身份关联」。',
    },
    resources: [],
  };
  put(
    path.join(caseDir, 'notes', 'resource-manifest.json'),
    JSON.stringify(resourceManifest, null, 2) + '\n',
    args.force,
    actions
  );
  return { schemaVersion: 'env-case-init/v2', caseDir, actions };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const result = initCase(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else process.stdout.write(result.actions.map(a => `${a.action}: ${a.path}`).join('\n') + '\n');
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { initCase, parseArgs };
