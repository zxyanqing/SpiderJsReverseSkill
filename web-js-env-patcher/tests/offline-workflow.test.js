'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = path.resolve(__dirname, '..', 'scripts');

function run(name, args, input) {
  const result = spawnSync(process.execPath, [path.join(scripts, name), ...args], {
    input, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.signal, null, result.stderr);
  return { code: result.status, output: result.stdout, error: result.stderr, data: result.stdout ? JSON.parse(result.stdout) : null };
}

function withCase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-env-skill-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('URL-only and JS-only intake both expose useful next actions', () => {
  const url = run('check_intake.js', ['--json'], '目标页面：https://example.test/page\n');
  assert.equal(url.code, 0);
  assert.equal(url.data.canStart, true);
  assert.ok(url.data.nextActions.some(x => x.includes('观察目标页面')));
  assert.ok(url.data.unknown.includes('请求样本'));

  const js = run('check_intake.js', ['--json'], '目标 JS 文件：./bundle.mjs\n');
  assert.equal(js.code, 0);
  assert.equal(js.data.canStart, true);
  assert.ok(js.data.nextActions.some(x => x.includes('本地试跑')));
});

test('initializer keeps measurements unknown and existing files intact', () => withCase(dir => {
  const first = run('init_env_case.js', ['--case-dir', dir, '--target', 'bundle.js', '--json']);
  assert.equal(first.code, 0, first.error);
  const fixture = path.join(dir, 'fixtures', 'sample.fixture.json');
  const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  assert.equal(data.browser.language, null);
  assert.equal(data.browser.timezone, null);
  assert.equal(data.browser.screen, null);
  assert.equal(data.websiteResponse, null);
  fs.writeFileSync(fixture, '{"user":"kept"}\n');
  const second = run('init_env_case.js', ['--case-dir', dir, '--json']);
  assert.equal(second.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture, 'utf8')), { user: 'kept' });
  const notes = fs.readFileSync(path.join(dir, 'notes', 'env-task.md'), 'utf8');
  assert.doesNotMatch(notes, /addon-first|禁止回退|用户已确认/);
}));

test('historical keywords do not select checks or imply passing', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, '阶段报告'));
  fs.writeFileSync(path.join(dir, '阶段报告', '旧记录.md'), '没有 XHR/fetch，也没有 Worker。\n');
  const diagnostic = run('check_environment_closure.js', ['--case-dir', dir, '--before-real-request', '--json']);
  assert.equal(diagnostic.code, 0);
  assert.equal(diagnostic.data.status, 'insufficient-evidence');
  assert.deepEqual(diagnostic.data.selectedChecks, []);
  assert.equal(diagnostic.data.clean, false);
  const strict = run('check_environment_closure.js', ['--case-dir', dir, '--strict', '--json']);
  assert.equal(strict.code, 1);
  assert.equal(strict.data.websiteAccepted, null);
}));

test('explicit selection runs a check and not-applicable needs a reason', () => withCase(dir => {
  const config = path.join(dir, 'checks.json');
  fs.writeFileSync(config, JSON.stringify({
    schemaVersion: 'env-checks/v1',
    checks: { shape: { state: 'selected' }, 'session-bridge': { state: 'not-applicable', reason: '目标 JS 无网络调用' } },
  }));
  const diagnostic = run('check_environment_closure.js', ['--case-dir', dir, '--config', config, '--json']);
  assert.equal(diagnostic.code, 0, diagnostic.error);
  assert.equal(diagnostic.data.components.find(x => x.name === 'session-bridge').status, 'not-applicable');
  const shape = diagnostic.data.components.find(x => x.name === 'shape');
  assert.equal(shape.script, 'check_object_shape_audit.js');
  assert.equal(shape.status, 'insufficient-evidence');
  const strict = run('check_environment_closure.js', ['--case-dir', dir, '--config', config, '--strict', '--json']);
  assert.equal(strict.code, 1, strict.error);
  fs.writeFileSync(config, JSON.stringify({
    schemaVersion: 'env-checks/v1', checks: { shape: { state: 'not-applicable' } },
  }));
  const invalid = run('check_environment_closure.js', ['--case-dir', dir, '--config', config, '--json']);
  assert.equal(invalid.code, 2);
}));

test('malformed selected Trace evidence is an execution failure', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.mkdirSync(path.join(dir, 'tmp'));
  fs.writeFileSync(path.join(dir, 'notes', 'trace-runtime-contract.json'), '{bad json');
  fs.writeFileSync(path.join(dir, 'tmp', 'node-trace-runtime-audit.json'), '{}');
  const result = run('check_environment_closure.js', ['--case-dir', dir, '--checks', 'trace', '--json']);
  assert.equal(result.code, 2, result.error);
  assert.equal(result.data.status, 'execution-failed');
}));

test('code style is advisory while damaged text fails strict validation', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.writeFileSync(path.join(dir, 'result', 'env.js'), 'function install() { return {}; }\nmodule.exports = install;\n');
  const diagnostic = run('check_environment_closure.js', ['--case-dir', dir, '--checks', 'code-quality', '--json']);
  assert.equal(diagnostic.code, 0);
  assert.equal(diagnostic.data.status, 'passed');
  const strict = run('check_environment_closure.js', ['--case-dir', dir, '--checks', 'code-quality', '--strict', '--json']);
  assert.equal(strict.code, 0);
  fs.writeFileSync(path.join(dir, 'result', 'env.js'), 'const broken = "\uFFFD";\n');
  const damaged = run('check_environment_closure.js', ['--case-dir', dir, '--checks', 'code-quality', '--strict', '--json']);
  assert.equal(damaged.code, 1);
  assert.equal(damaged.data.status, 'differences');
}));

test('a passing selected check remains passing without a fixed task note', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.writeFileSync(path.join(dir, 'result', 'run.js'), 'module.exports = function run(value) { return value; };\n');
  const result = run('check_environment_closure.js', ['--case-dir', dir, '--checks', 'addon', '--strict', '--json']);
  assert.equal(result.code, 0, result.error);
  assert.equal(result.data.status, 'passed');
  assert.equal(result.data.components[0].status, 'passed');
  assert.equal(fs.existsSync(path.join(dir, 'notes', 'env-task.md')), false);
}));

test('resource hash mismatch fails even in diagnostic mode', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'actual content');
  fs.writeFileSync(path.join(dir, 'notes', 'resource-manifest.json'), JSON.stringify({
    resources: [{ url: 'https://example.test/bundle.js', file: 'bundle.js', sha256: '0'.repeat(64), dynamic: false, use: 'static' }],
  }));
  const result = run('check_dynamic_resources.js', ['--case-dir', dir, '--json']);
  assert.equal(result.code, 2, result.error);
  assert.equal(result.data.status, 'execution-failed');
  assert.ok(result.data.problems.some(p => p.includes('哈希')));
}));

test('resource snapshots without a manifest are insufficient evidence', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'js', 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js', 'snapshots', 'bundle.js'), 'snapshot');
  const result = run('check_dynamic_resources.js', ['--case-dir', dir, '--strict', '--json']);
  assert.equal(result.code, 1);
  assert.equal(result.data.status, 'insufficient-evidence');
  assert.equal(result.data.ok, false);
}));

test('malformed resource manifest is an execution failure', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'notes', 'resource-manifest.json'), '{"resources":{}}');
  const result = run('check_dynamic_resources.js', ['--case-dir', dir, '--json']);
  assert.equal(result.code, 2);
  assert.equal(result.data.status, 'execution-failed');
}));

test('request context alone does not select network checks', () => withCase(dir => {
  const result = run('check_environment_closure.js', ['--case-dir', dir, '--require-live', '--tls-client', 'curl_cffi', '--json']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.data.components, []);
}));

test('final artifact accepts an explicit local entry and detects sample reuse', () => withCase(dir => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.mkdirSync(path.join(dir, 'fixtures'));
  const entry = path.join(dir, 'result', 'run.mjs');
  fs.writeFileSync(entry, 'export function run(input) { return input; }\n');
  fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), JSON.stringify({ sign: '1234567890abcdef' }));
  const good = run('check_final_artifact.js', ['--case-dir', dir, '--file', entry, '--strict', '--json']);
  assert.equal(good.code, 0, good.error);
  assert.equal(good.data.websiteAccepted, null);
  fs.writeFileSync(entry, 'export const sign = "1234567890abcdef";\n');
  const bad = run('check_final_artifact.js', ['--case-dir', dir, '--file', entry, '--strict', '--json']);
  assert.equal(bad.code, 1);
  assert.equal(bad.data.reusedCryptoCheck.reused.length, 1);
}));

test('stage writer records experiment without requiring unrelated audit chapters', () => withCase(dir => {
  const dataFile = path.join(dir, 'experiment.json');
  fs.writeFileSync(dataFile, JSON.stringify({ hypothesis: '返回对象状态影响结果', targetResult: '目标路径继续执行', websiteFeedback: '尚未验收' }));
  const written = run('write_stage_report.js', ['--case-dir', dir, '--stage', '实验记录', '--data', dataFile, '--json']);
  assert.equal(written.code, 0, written.error);
  const content = fs.readFileSync(written.data.out, 'utf8');
  assert.match(content, /返回对象状态影响结果/);
  assert.doesNotMatch(content, /addon-first|Session Bridge/);
  const checked = run('check_stage_reports.js', ['--case-dir', dir, '--require-stage', '实验记录', '--require-dynamic-fields', '--strict', '--json']);
  assert.equal(checked.code, 0, checked.error);
}));

test('stage writer preserves causal uncertainty, next reason and old aliases', () => withCase(dir => {
  const dataFile = path.join(dir, 'experiment.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    target: 'consumer accepts local output',
    subtaskContribution: 'verify state crossing the consumer boundary',
    assumptions: ['chosen phase is consumed'],
    alternatives: ['session mismatch', 'state mismatch'],
    predictions: { accepted: 'supports phase selection', rejected: 'remains unresolved' },
    implementationProgress: 'public interface repaired',
    diagnosticProgress: 'rejection cause remains unknown',
    unresolved: ['consumer relation'],
    next: 'compare consumption snapshots',
    nextReason: 'distinguish state timing from value semantics',
    acceptance: 'not accepted',
    extraEvidence: { token: 'private-fixture-value' },
  }));
  const written = run('write_stage_report.js', ['--case-dir', dir, '--stage', 'validation', '--data', dataFile, '--json']);
  assert.equal(written.code, 0, written.error);
  const content = fs.readFileSync(written.data.out, 'utf8');
  for (const value of ['consumer accepts local output', 'public interface repaired',
    'rejection cause remains unknown', 'compare consumption snapshots',
    'distinguish state timing from value semantics', 'not accepted']) {
    assert.ok(content.includes(value), value);
  }
  assert.ok(content.includes('session mismatch'));
  assert.ok(content.includes('remains unresolved'));
  assert.equal(content.includes('private-fixture-value'), false);
  assert.ok(content.includes('[redacted]'));
  const first = content;
  const appended = run('write_stage_report.js', ['--case-dir', dir, '--stage', 'validation', '--data', dataFile, '--append', '--json']);
  assert.equal(appended.code, 0, appended.error);
  assert.equal(fs.readFileSync(written.data.out, 'utf8'), first + '\n' + first);
}));
