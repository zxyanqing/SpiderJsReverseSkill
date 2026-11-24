#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { caseDir: 'case', changed: [], init: false, requireEntry: false, strict: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--dir' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--changed' || arg === '--file') args.changed.push(argv[++i] || '');
    else if (arg === '--init') args.init = true;
    else if (arg === '--require-entry') args.requireEntry = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_change_memory.js --case-dir case --init --json
  node scripts/check_change_memory.js --case-dir case --changed result/env.js --require-entry --strict --json

记录关键变更的证据和可恢复判断；历史建议可由新证据修订。`;
}

function check(args) {
  const caseDir = path.resolve(args.caseDir || 'case');
  const file = path.join(caseDir, 'notes', '代码变更记忆.md');
  const actions = [];
  if (args.init && !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# 代码变更记录\n\n| 时间 | 文件 | 假设与证据 | 变更 | 目标结果 | 网站反馈 | 判断 |\n| --- | --- | --- | --- | --- | --- | --- |\n', 'utf8');
    actions.push({ action: 'created', path: file });
  }
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : '';
  const problems = [];
  const warnings = [];
  const hasEntry = /^##\s+变更\b/m.test(text) || /^\|\s*\S[^\n]*\|\s*\S[^\n]*\|/m.test(text.split('\n').slice(3).join('\n'));
  if (!exists) warnings.push('尚无代码变更记录');
  if (args.requireEntry && !hasEntry) problems.push('要求变更记录，但尚未发现实际条目');
  const matchedChanged = args.changed.filter(Boolean).map(fileName => ({
    file: fileName, matched: text.replace(/\\/g, '/').includes(fileName.replace(/\\/g, '/')) || text.includes(path.basename(fileName)),
  }));
  for (const item of matchedChanged) if (!item.matched) {
    (args.requireEntry ? problems : warnings).push(`记录未提到文件：${item.file}`);
  }
  return {
    schemaVersion: 'change-memory-check/v2', caseDir, memoryFile: file, exists,
    hasEntry, actions, changed: args.changed, matchedChanged,
    clean: problems.length === 0, problems, warnings,
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const result = check(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(`# 变更记录检查\n\n- 结果：${result.clean ? '通过' : '发现差异'}\n${result.problems.map(p => `- ${p}`).join('\n')}\n`);
      process.exitCode = args.strict && !result.clean ? 1 : 0;
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { check, parseArgs };
