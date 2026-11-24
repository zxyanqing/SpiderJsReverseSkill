#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ALIASES = {
  intake: '需求信息确认', forensics: '取证方案确认', params: '请求样本与可疑参数确认',
  entry: 'JS文件与入口定位', 'pre-env': '补环境前置分析',
  env: '补环境实现记录', validation: '验证与清理记录',
};

function parseArgs(argv) {
  const args = { caseDir: '', requiredStages: [], requireDynamicFields: false, requireCapabilityReport: false, strict: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--dir' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--require-stage') args.requiredStages.push(argv[++i] || '');
    else if (arg === '--require-initial') args.requiredStages.push('需求信息确认');
    else if (arg === '--require-dynamic-fields') args.requireDynamicFields = true;
    else if (arg === '--require-capability-report') args.requireCapabilityReport = true;
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
  node scripts/check_stage_reports.js --case-dir case --json
  node scripts/check_stage_reports.js --case-dir case --require-stage 实验记录 --strict --json

默认查看现有报告；--require-stage 显式要求指定报告存在。旧 --require-dynamic-fields 检查六项实验记录，--require-capability-report 仅作提示。`;
}

function check(args) {
  if (!args.caseDir) throw new Error('需要 --case-dir');
  const caseDir = path.resolve(args.caseDir);
  const stageDir = path.join(caseDir, '阶段报告');
  const names = fs.existsSync(stageDir) ? fs.readdirSync(stageDir).filter(n => n.endsWith('.md')) : [];
  const reports = [];
  const problems = [];
  const warnings = [];
  for (const name of names) {
    const file = path.join(stageDir, name);
    const text = fs.readFileSync(file, 'utf8');
    const item = { file: path.relative(caseDir, file), utf8Readable: !text.includes('\uFFFD'), experimentFieldsMissing: [] };
    if (!item.utf8Readable) problems.push(`编码替换字符：${item.file}`);
    if (args.requireDynamicFields) {
      const fields = ['主要假设', '证据与来源', '改变项与保持项', '原始目标路径结果', '网站反馈', '判断与下一步'];
      item.experimentFieldsMissing = fields.filter(f => !text.includes(f));
      if (item.experimentFieldsMissing.length) problems.push(`实验记录缺少字段：${item.file}：${item.experimentFieldsMissing.join('、')}`);
    }
    reports.push(item);
  }
  for (const raw of args.requiredStages) {
    const stage = ALIASES[raw] || raw;
    if (!names.some(n => n === `${stage}.md` || n.endsWith(`-${stage}.md`))) {
      problems.push(`未找到指定阶段报告：${stage}`);
    }
  }
  if (!names.length) warnings.push('当前没有阶段报告；如实验记录保存在其他位置，可在交付时引用');
  if (args.requireCapabilityReport) warnings.push('能力变更按实际触发的 API 记录，无统一全量章节要求');
  return { schemaVersion: 'stage-reports-check/v2', caseDir, stageDir, clean: problems.length === 0, problems, warnings, reports };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const result = check(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(`# 阶段报告检查\n\n- 结果：${result.clean ? '通过' : '发现差异'}\n- 报告数：${result.reports.length}\n${result.problems.map(p => `- ${p}`).join('\n')}\n`);
      process.exitCode = args.strict && !result.clean ? 1 : 0;
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { check, parseArgs };
