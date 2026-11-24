#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STAGES = {
  intake: '需求信息确认', forensics: '取证方案确认', params: '请求样本与可疑参数确认',
  entry: 'JS文件与入口定位', 'pre-env': '补环境前置分析',
  env: '补环境实现记录', validation: '验证与清理记录',
};
const INDICES = {
  需求信息确认: '01', 取证方案确认: '02', 请求样本与可疑参数确认: '03',
  JS文件与入口定位: '04', 补环境前置分析: '05',
  补环境实现记录: '06', 验证与清理记录: '07',
};

function parseArgs(argv) {
  const args = { caseDir: '', stage: '', index: '', template: '', input: '', data: '', out: '', append: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--dir' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--stage' || arg === '-s') args.stage = argv[++i] || '';
    else if (arg === '--index') args.index = argv[++i] || '';
    else if (arg === '--template') args.template = argv[++i] || '';
    else if (arg === '--input' || arg === '-i') args.input = argv[++i] || '';
    else if (arg === '--data') args.data = argv[++i] || '';
    else if (arg === '--out' || arg === '-o') args.out = argv[++i] || '';
    else if (arg === '--append') args.append = true;
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
  node scripts/write_stage_report.js --case-dir case --stage 实验记录 --data experiment.json --json
  node scripts/write_stage_report.js --case-dir case --stage 验证记录 --input draft.md --append

--data 接收当前实验字段；旧阶段别名和 --template 保留以兼容调用。`;
}

function safe(value) {
  if (value === undefined || value === null || value === '') return '未记录';
  if (typeof value === 'object') {
    const redacted = JSON.stringify(value, (key, item) =>
      /^(authorization|cookie|password|token|secret)$/i.test(key) ? '[redacted]' : item);
    return redacted || '未记录';
  }
  return String(value).replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s;]+/ig, '$1: [redacted]');
}

function renderData(stage, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('--data 需要 JSON 对象');
  const pick = (...keys) => {
    for (const key of keys) if (data[key] !== undefined) return safe(data[key]);
    return '未记录';
  };
  const lines = [
    `# ${stage}`, '',
    `- 当前目标：${pick('goal', 'target', 'summary')}`,
    `- 本动作对目标的贡献：${pick('subtaskContribution')}`,
    `- 网站反馈：${pick('websiteFeedback', 'siteResponse', 'acceptance')}`, '',
    '## 主要假设', '',
    pick('hypothesis'), '',
    `- 未验证前提：${pick('assumptions')}`,
    `- 候选解释：${pick('alternatives')}`,
    `- 预期观察与判别意义：${pick('predictions')}`, '',
    '## 证据与来源', '',
    pick('evidence', 'observations'), '',
    '## 改变项与保持项', '',
    `- 改变：${pick('change', 'changedFiles', 'files')}`,
    `- 保持：${pick('heldConstant', 'scope')}`, '',
    '## 原始目标路径结果', '',
    pick('targetResult', 'runtimeResult', 'tests'), '',
    '## 进展与剩余不确定性', '',
    `- 实现进展：${pick('implementationProgress')}`,
    `- 定位进展：${pick('diagnosticProgress')}`,
    `- 未决事项：${pick('unresolved')}`, '',
    '## 判断与下一步', '',
    `- 当前判断：${pick('conclusion', 'decision')}`,
    `- 下一步：${pick('nextSteps', 'next')}`,
    `- 选择理由：${pick('nextReason')}`, '',
  ];
  const consumed = new Set([
    'goal', 'target', 'summary', 'websiteFeedback', 'siteResponse', 'acceptance',
    'hypothesis', 'evidence', 'observations', 'change', 'changedFiles', 'files',
    'heldConstant', 'scope', 'targetResult', 'runtimeResult', 'tests',
    'conclusion', 'decision', 'nextSteps', 'next', 'subtaskContribution',
    'assumptions', 'alternatives', 'predictions', 'implementationProgress',
    'diagnosticProgress', 'unresolved', 'nextReason',
  ]);
  const extra = Object.entries(data).filter(([key]) => !consumed.has(key));
  if (extra.length) lines.push('## 其他输入记录', '', ...extra.map(([key, value]) => `- ${key}：${safe(value)}`), '');
  return lines.join('\n');
}

function writeReport(args) {
  if (!args.caseDir || !args.stage) throw new Error('需要 --case-dir 与 --stage');
  const stage = STAGES[args.stage] || args.stage;
  if (/[\\/]/.test(stage)) throw new Error('阶段名称不能包含路径分隔符');
  if (args.index && !/^\d{1,3}$/.test(args.index)) throw new Error('--index 需要 1 到 3 位数字');
  const index = args.index ? args.index.padStart(2, '0') : INDICES[stage] || '';
  const file = args.out
    ? path.resolve(args.out)
    : path.join(path.resolve(args.caseDir), '阶段报告', `${index ? `${index}-` : ''}${stage}.md`);
  const piped = !args.input && !args.data && !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';
  const content = args.input ? fs.readFileSync(args.input, 'utf8')
    : args.data ? renderData(stage, JSON.parse(fs.readFileSync(args.data, 'utf8')))
      : piped.trim() ? piped : renderData(stage, {});
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, args.append && fs.existsSync(file) ? '\n' + content : content, {
    encoding: 'utf8', flag: args.append && fs.existsSync(file) ? 'a' : 'w',
  });
  return { schemaVersion: 'stage-report/v2', ok: true, stage, index, out: file, bytes: Buffer.byteLength(content, 'utf8') };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const result = writeReport(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(`已写入：${result.out}\n`);
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { writeReport, renderData, parseArgs };
