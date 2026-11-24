#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKS = Object.freeze({
  trace: { script: 'check_trace_runtime_conformance.js', flags: [] },
  shape: { script: 'check_object_shape_audit.js', flags: ['--require'] },
  webapi: { script: 'check_webapi_env_detection_matrix.js', flags: ['--require'] },
  'code-quality': { script: 'check_code_quality.js', flags: [] },
  addon: { script: 'check_webapi_addon_coverage.js', flags: [] },
  'network-semantics': { script: 'check_xhr_fetch_semantics.js', flags: ['--require', '--require-no-send'] },
  'session-bridge': { script: 'check_xhr_fetch_session_bridge.js', flags: [] },
});

function parseArgs(argv) {
  const args = {
    caseDir: '', config: '', checks: '', strict: false, requireLive: false,
    tlsClient: '', beforeRealRequest: false, strictP2: false,
    json: false, markdown: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--case' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--config') args.config = argv[++i] || '';
    else if (arg === '--checks') args.checks = argv[++i] || '';
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--require-live') args.requireLive = true;
    else if (arg === '--tls-client') args.tlsClient = argv[++i] || '';
    else if (arg === '--before-real-request') args.beforeRealRequest = true;
    else if (arg === '--strict-p2') args.strictP2 = true;
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
  node scripts/check_environment_closure.js --case-dir case --checks trace,shape --json
  node scripts/check_environment_closure.js --case-dir case --config case/notes/env-checks.json --strict --json

可选检查：${Object.keys(CHECKS).join(', ')}
--checks 显式选择当前路径相关项；也可在 notes/env-checks.json 中逐项设置 selected 或 not-applicable（后者需 reason）。
--strict 使已选检查差异或证据不足返回 1；解析/执行错误始终返回 2。默认仅诊断并返回 0。
--before-real-request 只记录验证情境，不自动选择检查或证明网站接受。
--require-live 只对已选择的 session-bridge 检查生效；外部 HTTP 编排不等于目标 JS 内部 XHR/fetch。 `;
}

function loadSelection(args, caseDir) {
  const file = args.config
    ? path.resolve(args.config)
    : path.join(caseDir, 'notes', 'env-checks.json');
  const selection = new Map();
  if (args.config && !fs.existsSync(file)) throw new Error(`检查配置不存在：${file}`);
  if (fs.existsSync(file)) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (config.schemaVersion !== 'env-checks/v1' || !config.checks || typeof config.checks !== 'object' || Array.isArray(config.checks)) {
      throw new Error(`无效检查配置：${file}，需要 schemaVersion=env-checks/v1 和 checks 对象`);
    }
    for (const [name, item] of Object.entries(config.checks)) {
      if (!CHECKS[name]) throw new Error(`未知检查项：${name}`);
      if (!item || typeof item !== 'object' || !['selected', 'not-applicable'].includes(item.state)) {
        throw new Error(`无效检查状态：${name}`);
      }
      if (item.state === 'not-applicable' && !String(item.reason || '').trim()) {
        throw new Error(`不适用项需要 reason：${name}`);
      }
      selection.set(name, { state: item.state, reason: String(item.reason || '').trim(), source: file });
    }
  }
  if (args.checks) {
    for (const name of args.checks.split(',').map(s => s.trim())) {
      if (!CHECKS[name]) throw new Error(`未知检查项：${name}`);
      selection.set(name, { state: 'selected', reason: '', source: '--checks' });
    }
  }
  return { selection, configFile: fs.existsSync(file) ? file : '' };
}

function runSelected(name, args, caseDir) {
  const definition = CHECKS[name];
  const flags = ['--case-dir', caseDir, ...definition.flags];
  if (name === 'trace' && args.strictP2) flags.push('--strict-p2');
  if (name === 'session-bridge') {
    if (args.requireLive) flags.push('--require-live');
    if (args.tlsClient) flags.push('--tls-client', args.tlsClient);
  }
  const ret = spawnSync(process.execPath, [path.join(__dirname, definition.script), ...flags, '--json'], {
    encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
  let data;
  try { data = JSON.parse(String(ret.stdout || '').trim()); } catch {}
  const executionFailed = !!ret.error || ret.signal !== null || ret.status === null || ret.status > 1 || !data || typeof data !== 'object'
    || data.executionFailed === true || data.status === 'execution-failed';
  const passed = !executionFailed && data.status === 'passed'
    && ret.status === 0 && data.clean !== false && data.passed !== false && data.ok !== false;
  const missingEvidence = !executionFailed && (
    data.status === 'insufficient-evidence'
    || (name === 'trace' && (!fs.existsSync(data.contractPath || '') || !fs.existsSync(data.auditPath || '')))
    || (name === 'shape' && (data.browser?.exists === false || data.nodeAudit?.exists === false))
    || (name === 'webapi' && (data.browser?.exists === false || data.nodeAudit?.exists === false))
    || (name === 'network-semantics' && (!fs.existsSync(data.browserPath || '') || !fs.existsSync(data.nodePath || '')))
    || (name === 'code-quality' && data.filesChecked === 0)
    || (name === 'session-bridge' && data.filesChecked === 0)
  );
  const status = executionFailed ? 'execution-failed' : passed ? 'passed' : missingEvidence ? 'insufficient-evidence' : 'differences';
  return {
    name, script: definition.script, status, clean: passed, exitCode: ret.status,
    data: data || null, stderr: String(ret.stderr || ret.error?.message || '').trim().slice(0, 2000),
    source: 'selected',
  };
}

function check(args) {
  const caseDir = path.resolve(args.caseDir || '.');
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) {
    throw new Error(`case 目录不存在：${caseDir}`);
  }
  const { selection, configFile } = loadSelection(args, caseDir);
  const components = [];
  for (const name of Object.keys(CHECKS)) {
    const item = selection.get(name);
    if (!item) continue;
    if (item.state === 'not-applicable') {
      components.push({ name, status: 'not-applicable', clean: false, reason: item.reason, source: item.source });
    } else {
      const result = runSelected(name, args, caseDir);
      result.source = item.source;
      components.push(result);
    }
  }
  const selected = components.filter(c => c.status !== 'not-applicable');
  const executionFailed = selected.some(c => c.status === 'execution-failed');
  const problems = selected.filter(c => c.status !== 'passed').map(c => {
    const detail = Array.isArray(c.data?.problems) ? c.data.problems.slice(0, 10).join('；') : c.stderr;
    return `${c.name}: ${c.status}${detail ? `：${detail}` : ''}`;
  });
  const status = executionFailed ? 'execution-failed'
    : !selected.length ? 'insufficient-evidence'
      : selected.some(c => c.status === 'differences') ? 'differences'
        : selected.some(c => c.status === 'insufficient-evidence') ? 'insufficient-evidence' : 'passed';
  if (!selected.length) problems.push('没有选择当前路径的检查；未检查不代表通过');
  return {
    schemaVersion: 'environment-closure/v4', generatedBy: 'check_environment_closure.js',
    caseDir, configFile, strict: !!args.strict, beforeRealRequest: !!args.beforeRealRequest,
    requireLive: !!args.requireLive, tlsClient: args.tlsClient || '',
    status, clean: status === 'passed', selectedChecks: selected.map(c => c.name),
    components, problems, websiteAccepted: null,
  };
}

function renderMarkdown(result) {
  const lines = [
    '# 当前范围环境检查', '',
    `- case：${result.caseDir}`,
    `- 模式：${result.strict ? '严格验收' : '诊断'}`,
    `- 情境：${result.beforeRealRequest ? '真实请求前' : '常规'}`,
    `- 结果：${result.status}`,
    '- 网站接受：未由本工具判断', '',
    '## 已配置检查',
  ];
  if (!result.components.length) lines.push('- 无');
  for (const c of result.components) {
    lines.push(`- ${c.name}：${c.status}${c.reason ? `（${c.reason}）` : ''}`);
  }
  if (result.problems.length) lines.push('', '## 待处理', ...result.problems.map(p => `- ${p}`));
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
    } else {
      const result = check(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(renderMarkdown(result));
      process.exitCode = result.status === 'execution-failed' ? 2 : args.strict && !result.clean ? 1 : 0;
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { check, parseArgs, loadSelection, CHECKS };
