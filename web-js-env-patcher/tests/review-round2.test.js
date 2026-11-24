'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createVmRuntime } = require('../assets/runtime-frameworks/vm-runtime');
const root = path.resolve(__dirname, '..');

function temp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-review-round2-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function cli(script, args) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8', timeout: 2500 });
  assert.equal(r.signal, null, r.stderr);
  return { code: r.status, data: JSON.parse(r.stdout), stderr: r.stderr };
}
function trace(dir, source, extra = []) {
  const target = path.join(dir, 'target.js');
  fs.writeFileSync(target, source);
  return cli('run_with_trace.js', ['--target', target, '--entry', 'run', '--strict', '--json', ...extra]);
}

test('R01 global prototype methods and accessors cannot expose host functions', async () => {
  for (const proto of [{ helper() {} }, Object.defineProperty(Object.create(null), 'helper', { get() { return process; } })]) {
    const r = createVmRuntime({ installEnv(scope) { Object.setPrototypeOf(scope, proto); } });
    try { await assert.rejects(r.initialize(), /host (object|function|prototype)/); }
    finally { await r.dispose(); }
  }
  const r = createVmRuntime({ envModules: ['base-env', 'storage-env', 'document-env'] });
  try {
    await r.initialize();
    assert.equal(await r.load('window instanceof Window && Object.getPrototypeOf(window) === Window.prototype'), true);
    assert.equal(await r.load('localStorage.getItem.constructor("return typeof process")()'), 'undefined');
  } finally { await r.dispose(); }
});

test('R02 result adoption, serialization and rejection getters stay within vm budget', () => {
  const expressions = [
    `let reads=0; ({get then(){if(++reads>=2){while(true){}} return undefined;}})`,
    `({get value(){while(true){}}})`,
    `Promise.resolve({toJSON(){while(true){}}})`,
    `Promise.reject({get message(){while(true){}}})`,
    `throw new Proxy(new Error('known proxy error'),{getPrototypeOf(){while(true){}}})`,
  ];
  for (const expression of expressions) {
    const child = `const {createVmRuntime}=require(${JSON.stringify(path.join(root, 'assets/runtime-frameworks/vm-runtime'))});
      (async()=>{const r=createVmRuntime({timeoutMs:35});await r.initialize();
      try {await r.load(${JSON.stringify(expression)});console.log('completed');}
      catch(e){console.log(e.code||e.message);}finally{await r.dispose();}
      console.log('continued');})().catch(e=>{console.error(e);process.exitCode=1});`;
    const result = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', timeout: 1200 });
    assert.equal(result.signal, null, expression);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ERR_SCRIPT_EXECUTION_TIMEOUT|ERR_RUNTIME_TIMEOUT|known proxy error/);
    assert.match(result.stdout, /continued/);
  }
});

test('R02 snapshots preserve data and primitives; handles preserve identity without target callbacks', async () => {
  const r = createVmRuntime({ timeoutMs: 100 });
  const other = createVmRuntime();
  try {
    assert.equal(await r.initialize(), undefined);
    await other.initialize();
    assert.deepEqual(await r.load(`({nested:[0,false,'',null],get value(){return 42}})`), { nested: [0, false, '', null], value: 42 });
    for (const [source, expected] of [['undefined', undefined], ['null', null], ['42n', 42n], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-0', -0]]) {
      assert.ok(Object.is(await r.load(source), expected), source);
    }
    assert.deepEqual(await r.load(`Promise.resolve({ok:true})`), { ok: true });
    assert.equal(await r.load(`({then(resolve){resolve(42)}})`), 42);
    await r.load(`globalThis.shared={value:1};globalThis.fn=()=>shared; void 0`);
    const snapshot = await r.load('shared'); snapshot.value = 9;
    assert.equal(await r.load('shared.value'), 1);
    const handle = await r.loadHandle('shared');
    assert.equal(await r.loadHandle('shared'), handle);
    assert.equal(handle.type, 'object'); assert.equal(Object.getPrototypeOf(handle), null);
    assert.equal(Object.isFrozen(handle), true); assert.equal(handle.then, undefined);
    const fn = await r.load('fn'); assert.equal(fn.type, 'function');
    assert.equal(await r.loadHandle('fn'), fn); assert.equal(typeof fn, 'object');
    assert.notEqual(await other.loadHandle('({})'), handle);
    assert.deepEqual(await r.call('fn'), { value: 1 });
    await assert.rejects(r.load(`Promise.reject(new TypeError('known rejection'))`), { name: 'TypeError', message: 'known rejection' });
    assert.equal(r.state, 'failed');
  } finally { await r.dispose(); await other.dispose(); }
});

test('R03 background load/entry rejections fail saved results before comparison', () => temp(dir => {
  const output = path.join(dir, 'output.json'), fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ expected: 42 }));
  for (const source of [
    `Promise.reject(new Error('background load failed')); globalThis.run=()=>42;`,
    `globalThis.run=()=>{ Promise.reject(new Error('background entry failed')); return 42; };`,
  ]) {
    const r = trace(dir, source, ['--output', output]);
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.data.output.status, 'target-failed');
    assert.ok(r.data.output.errors.some(e => /background .* failed/.test(e.message)));
    const error = r.data.output.errors.find(e => e.type === 'unhandled-rejection');
    assert.equal(error.source, 'target');
    assert.equal(error.phase, source.startsWith('Promise') ? 'load' : 'entry');
    assert.deepEqual(JSON.parse(fs.readFileSync(output)), r.data.output);
    const comparison = cli('compare_fixture.js', ['--fixture', fixture, '--actual', output, '--json']);
    assert.equal(comparison.code, 1); assert.equal(comparison.data.pass, false);
    assert.doesNotMatch(r.stderr, /UnhandledPromiseRejection|node:internal\/process\/promises/);
  }
  for (const source of [
    `Promise.reject(new Error('handled')).catch(()=>{}); globalThis.run=()=>42;`,
    `globalThis.run=()=>{ const p=Promise.reject(new Error('handled')); Promise.resolve().then(()=>p.catch(()=>{}));return 42; };`,
    `globalThis.run=()=>42;`,
  ]) {
    const r = trace(dir, source);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.data.output.status, 'passed');
    assert.deepEqual(r.data.output.errors, []);
  }
  const diagnostic = trace(dir, `Promise.reject(new Error('background diagnostic failed'));globalThis.run=()=>42;`, ['--diagnostic']);
  assert.equal(diagnostic.code, 0); assert.equal(diagnostic.data.output.status, 'target-failed');
}));

test('R04 error provenance separates target-owned Proxy from damaged probe', () => temp(dir => {
  const target = trace(dir, `globalThis.run=()=>Reflect.ownKeys(new Proxy(function own(){},{ownKeys(){return []}}));`);
  assert.equal(target.code, 1); assert.equal(target.data.output.status, 'target-failed');
  assert.equal(target.data.output.errors[0].name, 'TypeError');
  assert.match(target.data.output.errors[0].message, /trap result did not/);
  const probe = trace(dir, `Object.defineProperty(globalThis,'__dumpEvents',{value:()=>{throw new TypeError('damaged probe')}});globalThis.run=()=>42;`);
  assert.equal(probe.code, 2); assert.equal(probe.data.output.status, 'execution-failed');
  assert.ok(probe.data.output.errors.some(e => e.type === 'probe-error' && e.message === 'damaged probe'));
}));

test('R05 languages values agree with sources for unknown, sampled and diagnostic inputs', () => temp(dir => {
  const fixture = path.join(dir, 'fixture.json');
  const source = `globalThis.run=()=>({unknown:navigator.languages===undefined,languages:navigator.languages,language:navigator.language});`;
  for (const browser of [{}, { language: 'fr-FR' }]) {
    fs.writeFileSync(fixture, JSON.stringify({ browser }));
    const r = trace(dir, source, ['--fixture', fixture]);
    assert.equal(r.code, 0); assert.equal(r.data.output.output.unknown, true);
    assert.equal(r.data.output.configuration.browserSources.languages, 'unknown');
  }
  fs.writeFileSync(fixture, JSON.stringify({ browser: { languages: ['fr-FR', 'en'] }, browserSources: { languages: 'observed' } }));
  const sampled = trace(dir, source, ['--fixture', fixture]);
  assert.deepEqual(sampled.data.output.output.languages, ['fr-FR', 'en']);
  assert.equal(sampled.data.output.configuration.browserSources.languages, 'observed');
  const defaults = trace(dir, source, ['--diagnostic-defaults']);
  assert.deepEqual(defaults.data.output.output.languages, ['zh-CN', 'zh']);
  assert.equal(defaults.data.output.configuration.browserSources.languages, 'diagnostic-default');
}));

test('R06 jsdom initializes all request Cookie pairs and preserves other pairs on update', async () => {
  const { createJsdomExample } = require('../assets/examples/jsdom-composition');
  const r = createJsdomExample();
  try {
    await r.initialize({ pageUrl: 'https://example.test/nested/page', request: { cookie: 'first=1; second=2; token=a=b', localStorage: { seed: 'yes' } } });
    await r.load(`globalThis.read=()=>({cookie:document.cookie,seed:localStorage.getItem('seed'),identity:window instanceof Window});
      globalThis.change=()=>{document.cookie='first=updated; Path=/';return document.cookie;};`);
    const initial = await r.call('read');
    assert.deepEqual(initial.cookie.split('; ').sort(), ['first=1', 'second=2', 'token=a=b']);
    assert.equal(initial.seed, 'yes'); assert.equal(initial.identity, true);
    assert.deepEqual((await r.call('change')).split('; ').sort(), ['first=updated', 'second=2', 'token=a=b']);
  } finally { await r.dispose(); }
});

test('R06 Set-Cookie list preserves path, HttpOnly and Secure attributes; invalid header input fails', async () => {
  const { createJsdomExample } = require('../assets/examples/jsdom-composition');
  const r = createJsdomExample();
  try {
    await r.initialize({ pageUrl: 'https://example.test/nested/page', request: {
      cookie: 'plain=ok', setCookies: ['nested=visible; Path=/nested; Secure', 'elsewhere=hidden; Path=/other', 'private=secret; Path=/; HttpOnly'],
    } });
    await r.load(`globalThis.read=()=>document.cookie;`);
    assert.deepEqual((await r.call('read')).split('; ').sort(), ['nested=visible', 'plain=ok']);
  } finally { await r.dispose(); }
  for (const request of [{ cookie: [] }, { cookie: 'first=1; broken' }, { cookie: 'first=1\r\nsecond=2' }, { setCookies: 'a=1; Path=/' }]) {
    const bad = createJsdomExample();
    try { await assert.rejects(bad.initialize({ request }), /Cookie|cookie/); }
    finally { await bad.dispose(); }
  }
});
