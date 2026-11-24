'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runner = path.resolve(__dirname, '../scripts/run_with_trace.js');

function runTrace(source, { nodeArgs = [], nodeOptions, toolFailure = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-review-round4-'));
  try {
    const target = path.join(dir, 'target.js'), output = path.join(dir, 'output.json');
    const summary = path.join(dir, 'summary.json'), trace = path.join(dir, 'trace.jsonl');
    if (toolFailure) fs.mkdirSync(target); else fs.writeFileSync(target, source);
    const env = { ...process.env };
    if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
    const child = spawnSync(process.execPath, [...nodeArgs, runner, '--target', target, '--entry', 'run',
      '--strict', '--json', '--timeout', '75', '--output', output, '--summary', summary, '--trace', trace],
    { encoding: 'utf8', timeout: 2000, env });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.ok(child.stdout, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(output)), result.output);
    assert.deepEqual(JSON.parse(fs.readFileSync(summary)), result.summary);
    assert.equal(result.output.status, result.summary.status);
    const events = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(result.summary.eventCount, events.length);
    return { ...result, code: child.status, events };
  } finally { fs.rmSync(dir, { force: true, recursive: true }); }
}

function expectStatus(result, status, code) {
  assert.equal(result.output.status, status);
  assert.equal(result.code, code);
}

test('R10 Node strict via argv or NODE_OPTIONS preserves target and tool results', () => {
  const rejection = "globalThis.run=()=>{Promise.reject(new Error('background failed'));return 42}";
  const handled = "globalThis.run=()=>{Promise.reject(new Error('handled')).catch(()=>{});return 42}";
  for (const options of [{}, { nodeArgs: ['--unhandled-rejections=strict'] },
    { nodeOptions: '--unhandled-rejections=strict' }]) {
    const rejected = runTrace(rejection, options);
    expectStatus(rejected, 'target-failed', 1);
    assert.equal(rejected.output.output, 42);
    assert.ok(rejected.output.errors.some(e => e.type === 'unhandled-rejection' && e.source === 'target' &&
      e.phase === 'entry' && e.message === 'background failed'));
  }
  for (const options of [{}, { nodeArgs: ['--unhandled-rejections=strict'] },
    { nodeOptions: '--unhandled-rejections=strict' }]) {
    const ok = runTrace(handled, options);
    expectStatus(ok, 'passed', 0);
    assert.equal(ok.output.output, 42);
    const broken = runTrace('', { ...options, toolFailure: true });
    expectStatus(broken, 'execution-failed', 2);
    assert.ok(broken.output.errors.some(e => e.source === 'tool' && e.operation === 'read-target' && e.code === 'EISDIR'));
  }
});

test('R10 importing Trace leaves strict rejection handling with the host', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-review-round4-import-'));
  try {
    const target = path.join(dir, 'target.js');
    fs.writeFileSync(target, "globalThis.run=()=>{Promise.reject(new Error('host strict sentinel'));return 42}");
    const program = 'require(' + JSON.stringify(runner) + ').run(' + JSON.stringify({ target, entry: 'run', timeout: 75 }) +
      ').then(()=>console.log("run unexpectedly returned"));';
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', program], { encoding: 'utf8', timeout: 2000 });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.match(child.stderr, /host strict sentinel/);
  } finally { fs.rmSync(dir, { force: true, recursive: true }); }
});

test('R11 timeout-like target codes remain error details across load, entry and rejections', () => {
  const upstream = "Object.assign(new Error('upstream operation failed'),{code:'ERR_SCRIPT_EXECUTION_TIMEOUT'})";
  const alike = "Object.assign(new Error('Script execution timed out after 75ms'),{code:'ERR_SCRIPT_EXECUTION_TIMEOUT'})";
  for (const [source, phase, type, message] of [
    ['throw ' + upstream, 'load', 'runtime-error', 'upstream operation failed'],
    ['throw ' + alike, 'load', 'runtime-error', 'Script execution timed out after 75ms'],
    ['globalThis.run=()=>{throw ' + alike + '}', 'entry', 'runtime-error', 'Script execution timed out after 75ms'],
    ['globalThis.run=()=>{Promise.reject(' + upstream + ');return 42}', 'entry', 'unhandled-rejection', 'upstream operation failed'],
    ['globalThis.run=()=>Promise.reject(' + upstream + ')', 'entry', 'runtime-error', 'upstream operation failed'],
  ]) {
    const result = runTrace(source);
    expectStatus(result, 'target-failed', 1);
    const detail = result.output.errors.find(e => e.type === type && e.phase === phase && e.source === 'target');
    assert.equal(detail?.code, 'ERR_SCRIPT_EXECUTION_TIMEOUT');
    assert.equal(detail?.message, message);
    assert.equal(detail?.timeoutEvidence, undefined);
  }
});

test('R11 actual load, synchronous and microtask timeouts still produce timed-out', () => {
  for (const [source, phase, evidence] of [
    ['while(true){}', 'load', 'vm-signature-and-elapsed'],
    ['globalThis.run=()=>{while(true){}}', 'entry', 'vm-execution-boundary'],
    ['globalThis.run=()=>Promise.resolve().then(()=>{while(true){}})', 'entry', 'vm-execution-boundary'],
  ]) {
    const result = runTrace(source);
    expectStatus(result, 'timed-out', 1);
    const detail = result.output.errors.find(e => e.type === 'timeout' && e.phase === phase);
    assert.equal(detail?.code, 'ERR_SCRIPT_EXECUTION_TIMEOUT');
    assert.equal(detail?.timeoutEvidence, evidence);
  }
});

test('R12 parsed payloads with invalid probe fields fail at the responsible operation', () => {
  for (const [probe, payload, operation] of [
    ['__callEntry', '{}', 'invoke-entry'],
    ['__callEntry', '{"entryFound":"false","output":42}', 'invoke-entry'],
    ['__callEntry', '{"entryFound":true}', 'invoke-entry'],
    ['__callEntry', '{"entryFound":true,"outputType":"number","output":"42"}', 'invoke-entry'],
    ['__callEntry', '{"entryFound":true,"async":true,"output":42}', 'invoke-entry'],
    ['__callEntry', '{"entryFound":true,"error":{"name":"Error","message":4}}', 'invoke-entry'],
    ['__leakageCheck', 'null', 'leakage-check'],
    ['__leakageCheck', '{"process":"undefined"}', 'leakage-check'],
    ['__dumpEvents', '[null]', 'dump-events'],
    ['__dumpEvents', '[{"type":42,"path":"document.all"}]', 'dump-events'],
    ['__dumpEvents', '[{"type":"get","path":42}]', 'dump-events'],
    ['__dumpEvents', '[{"type":"has","path":"history","prop":42}]', 'dump-events'],
    ['__dumpEvents', '[{"type":"async-target-error","name":"Error"}]', 'dump-events'],
  ]) {
    const source = 'Object.defineProperty(globalThis,' + JSON.stringify(probe) + ',{value:()=>'+
      JSON.stringify(payload) + '});globalThis.run=()=>42';
    const result = runTrace(source);
    expectStatus(result, 'execution-failed', 2);
    assert.ok(result.output.errors.some(e => e.type === 'probe-error' && e.source === 'tool' && e.operation === operation), payload);
    if (probe === '__dumpEvents') assert.deepEqual(result.events, []);
  }
});

test('R12 valid missing, synchronous, async and throwing entry branches retain their classifications', () => {
  const missing = runTrace('');
  expectStatus(missing, 'insufficient-evidence', 1);
  assert.equal(missing.output.entryFound, false);
  assert.equal(missing.output.errors[0].type, 'entry-not-found');

  const normal = runTrace('globalThis.run=()=>{document.all;return 42}');
  expectStatus(normal, 'passed', 0);
  assert.equal(normal.output.output, 42);
  assert.equal(normal.summary.nodeLeakage.process, 'undefined');
  assert.deepEqual(normal.summary.specialObjects, ['document.all']);
  assert.ok(normal.events.some(e => e.type === 'get' && e.path === 'document.all'));

  for (const expression of ['undefined', 'null', 'false', '0', 'NaN', 'Symbol("sample")', '({toJSON:()=>7})']) {
    expectStatus(runTrace('globalThis.run=()=>(' + expression + ')'), 'passed', 0);
  }
  const asyncOutput = runTrace('globalThis.run=()=>Promise.resolve(42)');
  expectStatus(asyncOutput, 'insufficient-evidence', 1);
  assert.equal(asyncOutput.output.errors[0].type, 'async-incomplete');

  const throwing = runTrace("Object.defineProperty(globalThis,'run',{get(){throw new Error('entry getter failed')}})");
  expectStatus(throwing, 'target-failed', 1);
  assert.equal(throwing.output.entryFound, false);
  assert.ok(throwing.output.errors.some(e => e.source === 'target' && e.message === 'entry getter failed'));
});
