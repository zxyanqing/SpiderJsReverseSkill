'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'check_final_artifact.js');

function withCase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* ignore */ }
  return { code: r.status, data, stdout: r.stdout, stderr: r.stderr };
}

test('T-G8: root --file entry with sample reuse is detected (not passed)', () => withCase((dir) => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.mkdirSync(path.join(dir, 'requests'));
  fs.writeFileSync(path.join(dir, 'requests', 'sample.json'), JSON.stringify({ sign: 'abcd1234SAMPLEVALUE999' }));
  fs.writeFileSync(path.join(dir, 'result', 'helper.js'), 'console.log(1)\n');
  const entry = path.join(dir, 'run.js');
  fs.writeFileSync(entry, 'const sign = "abcd1234SAMPLEVALUE999";\n');
  const result = run(['--case-dir', dir, '--file', entry, '--json']);
  assert.ok(result.data);
  assert.equal(result.data.entryExists, true);
  assert.equal(result.data.entryContentChecked, true);
  assert.ok(result.data.scannedFiles.some((f) => f === 'run.js' || f.endsWith('run.js')));
  assert.ok(result.data.reusedCryptoCheck.reused.some((r) => r.file === 'run.js' || r.file.endsWith('run.js')));
  assert.equal(result.data.clean, false);
  assert.notEqual(result.data.status, 'passed');
}));

test('T-G8: nested explicit entry with sample reuse is detected', () => withCase((dir) => {
  fs.mkdirSync(path.join(dir, 'result', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), JSON.stringify({ sign: 'nestedSIGNVALUE001' }));
  const entry = path.join(dir, 'result', 'deep', 'run.mjs');
  fs.writeFileSync(entry, 'export const sign = "nestedSIGNVALUE001";\n');
  const result = run(['--case-dir', dir, '--file', entry, '--json']);
  assert.equal(result.data.entryContentChecked, true);
  assert.ok(result.data.reusedCryptoCheck.reused.length >= 1);
  assert.equal(result.data.clean, false);
  assert.notEqual(result.data.status, 'passed');
}));

test('T-G8: --strict exits non-zero on reuse anti-example', () => withCase((dir) => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.mkdirSync(path.join(dir, 'fixtures'));
  const entry = path.join(dir, 'result', 'run.mjs');
  fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), JSON.stringify({ sign: 'strictSIGNVALUE002' }));
  fs.writeFileSync(entry, 'export const sign = "strictSIGNVALUE002";\n');
  const result = run(['--case-dir', dir, '--file', entry, '--strict', '--json']);
  assert.notEqual(result.code, 0);
  assert.equal(result.data.clean, false);
}));

test('T-G8: zero source coverage is insufficient-evidence, not passed', () => withCase((dir) => {
  fs.mkdirSync(path.join(dir, 'result'));
  // no source files at all; no --file
  const result = run(['--case-dir', dir, '--json']);
  assert.ok(result.data);
  assert.equal(result.data.status, 'insufficient-evidence');
  assert.notEqual(result.data.status, 'passed');
  assert.equal(result.data.clean, false);
  assert.deepEqual(result.data.scannedFiles, []);
}));

test('T-G8: report distinguishes entry existence vs content checked', () => withCase((dir) => {
  fs.mkdirSync(path.join(dir, 'result'));
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'sample.json'), JSON.stringify({ sign: 'existSIGNVALUE003' }));
  const entry = path.join(dir, 'entry.js');
  fs.writeFileSync(entry, 'export const sign = "existSIGNVALUE003";\n');
  const result = run(['--case-dir', dir, '--file', entry, '--json']);
  assert.equal(result.data.entryExists, true);
  assert.equal(result.data.entryContentChecked, true);
  assert.ok(Array.isArray(result.data.scannedFiles));
  assert.ok(result.data.scannedFiles.length >= 1);
}));
