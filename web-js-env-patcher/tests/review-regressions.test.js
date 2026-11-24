'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { createVmRuntime } = require('../assets/runtime-frameworks/vm-runtime');
const { installBaseEnv } = require('../assets/env-modules/base-env');
const { installStorage } = require('../assets/env-modules/storage-env');
const { installDocumentEnv } = require('../assets/env-modules/document-env');
function temp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-review-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function cli(name, args) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name), ...args], { encoding: 'utf8', timeout: 4000 });
  assert.equal(r.signal, null, r.stderr);
  return { code: r.status, data: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
function makeRuntime(extra = {}) {
  return createVmRuntime({ timeoutMs: 80, installEnv(scope, fixture) {
    installBaseEnv(scope, fixture);
    installStorage(scope, fixture);
    installDocumentEnv(scope, fixture);
  }, ...extra });
}

test('W01 cleanup preserves external targets, links, profiles and dry-run state', () => temp(dir => {
  const caseDir = path.join(dir, 'case');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(path.join(caseDir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(caseDir, 'profile'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'tmp', 'proof.txt'), 'external');
  fs.writeFileSync(path.join(caseDir, 'tmp', 'ordinary.txt'), 'remove');
  fs.writeFileSync(path.join(caseDir, 'profile', 'debug-kept.txt'), 'profile');
  fs.symlinkSync(outside, path.join(caseDir, 'linked'));
  fs.symlinkSync(path.join(outside, 'tmp', 'proof.txt'), path.join(caseDir, 'debug-link.txt'));
  fs.symlinkSync(caseDir, path.join(caseDir, 'ancestor'));
  fs.symlinkSync('missing', path.join(caseDir, 'broken'));
  const dry = cli('clean_case.js', ['--case-dir', caseDir, '--dry-run', '--json']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(fs.readFileSync(path.join(caseDir, 'tmp', 'ordinary.txt'), 'utf8'), 'remove');
  const real = cli('clean_case.js', ['--case-dir', caseDir, '--force', '--json']);
  assert.equal(real.code, 0, real.stderr);
  assert.equal(fs.readFileSync(path.join(outside, 'tmp', 'proof.txt'), 'utf8'), 'external');
  assert.equal(fs.existsSync(path.join(caseDir, 'tmp')), false);
  assert.equal(fs.readFileSync(path.join(caseDir, 'profile', 'debug-kept.txt'), 'utf8'), 'profile');
  assert.equal(fs.lstatSync(path.join(caseDir, 'debug-link.txt')).isSymbolicLink(), true);
  const linkedRoot = path.join(dir, 'root-link'); fs.symlinkSync(caseDir, linkedRoot);
  assert.notEqual(cli('clean_case.js', ['--case-dir', linkedRoot, '--force', '--json']).code, 0);
}));

test('W02 installed methods, getters, constructors, returned objects and errors belong to target Realm', async () => {
  const runtime = makeRuntime();
  try {
    await runtime.initialize({ pageUrl: 'https://example.test/p', browser: { language: 'en-US', languages: ['en-US'] } });
    const result = await runtime.load(`(() => {
      const get = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language').get;
      let error; try { new Storage(); } catch(e) { error = e; }
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      const values = [localStorage.getItem, get, Storage, Window, document.createElement,
        navigator.languages, document.createElement('div'), error, cookie.get, cookie.set,
        Object.getOwnPropertyDescriptor(Location.prototype, 'href').get];
      return values.map(v => [v.constructor.constructor('return typeof process')(),
        v.constructor.constructor('return typeof require')(), v.constructor.constructor('return typeof Buffer')()]);
    })()`);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), Array.from({ length: 11 }, () => ['undefined', 'undefined', 'undefined']));
    assert.equal(await runtime.load(`localStorage.getItem instanceof Function &&
      Object.getOwnPropertyDescriptor(Navigator.prototype, 'language').get instanceof Function &&
      (() => { try { new Storage(); } catch (e) { return e instanceof TypeError; } })()`), true);
    assert.equal(await runtime.load(`Function('return 6 * 7')()`), 42);
  } finally { await runtime.dispose(); }
});

test('W11/W13 multiple runtimes preserve host prototypes and parent Window identity', async () => {
  const before = [Function.prototype.toString, Object.prototype.toString];
  const parent = makeRuntime(); const child = makeRuntime();
  try {
    await parent.initialize();
    const fn = await parent.load('Storage.prototype.getItem');
    await child.initialize();
    await child.load('Storage.prototype.getItem = function childOnly() {}; Window.prototype.childMark = 1');
    assert.equal(await parent.load('Storage.prototype.getItem'), fn);
    assert.equal(await parent.load('window === globalThis && window === self && window === top && parent === window && window instanceof Window && Object.getPrototypeOf(window) === Window.prototype'), true);
    assert.equal(await child.load('window instanceof Window'), true);
    assert.equal(await parent.load('Window.prototype.childMark'), undefined);
    assert.equal(await parent.load('Function.prototype.toString.call(Storage.prototype.getItem)'), 'function getItem() { [native code] }');
    await child.dispose();
    assert.equal(await parent.load('window instanceof Window'), true);
    assert.deepEqual([Function.prototype.toString, Object.prototype.toString], before);
  } finally { await parent.dispose(); await child.dispose(); }
  assert.deepEqual([Function.prototype.toString, Object.prototype.toString], before);
});

test('W12 Storage private state, brand checks and independent stores', async () => {
  const runtime = makeRuntime();
  try {
    await runtime.initialize({ request: { localStorage: { a: '1' } } });
    assert.equal(await runtime.load(`Reflect.ownKeys(localStorage).includes('__data')`), false);
    assert.equal(await runtime.load(`(() => { try { Storage.prototype.getItem.call({__data:new Map([['a','forged']])}, 'a'); return false; } catch(e) { return e instanceof TypeError; } })()`), true);
    assert.equal(await runtime.load(`localStorage.setItem('b', 0); sessionStorage.setItem('b', 2); localStorage.removeItem('a'); localStorage.length + ':' + localStorage.key(0) + ':' + localStorage.getItem('b') + ':' + sessionStorage.getItem('b')`), '1:b:0:2');
    assert.equal(await runtime.load(`localStorage.clear(); localStorage.length + ':' + sessionStorage.length`), '0:1');
  } finally { await runtime.dispose(); }
});

test('W03 initializer -> v2 fixture input -> Trace -> comparison without field renaming', () => temp(dir => {
  assert.equal(cli('init_env_case.js', ['--case-dir', dir, '--entry', 'window.run', '--param', 'sign', '--json']).code, 0);
  const f = path.join(dir, 'fixtures', 'sample.fixture.json');
  const fixture = JSON.parse(fs.readFileSync(f)); fixture.input = ['abc']; fixture.observedOutput = { sign: 'abc' };
  fs.writeFileSync(f, JSON.stringify(fixture));
  const target = path.join(dir, 'target.js'); const output = path.join(dir, 'output.json');
  fs.writeFileSync(target, 'globalThis.run = value => ({ sign: value })');
  const run = cli('run_with_trace.js', ['--target', target, '--fixture', f, '--output', output, '--json']);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.data.output.output.sign, 'abc');
  const compare = () => cli('compare_fixture.js', ['--fixture', f, '--actual', output, '--json']);
  assert.equal(compare().data.pass, true);
  fixture.observedOutput.sign = 'wrong'; fs.writeFileSync(f, JSON.stringify(fixture));
  assert.equal(compare().data.status, 'differences');
  fixture.observedOutput = null; fs.writeFileSync(f, JSON.stringify(fixture));
  assert.equal(compare().data.status, 'insufficient-evidence');
  fixture.input = { invalid: 'positional args must be array' }; fs.writeFileSync(f, JSON.stringify(fixture));
  assert.notEqual(cli('run_with_trace.js', ['--target', target, '--fixture', f, '--json']).code, 0);
}));

test('W04 entry loop, infinite Promise and microtask loop are bounded in a child process', () => {
  for (const expression of ['while(true){}', 'return new Promise(() => {})', 'return Promise.resolve().then(() => { while(true){} })', 'return Promise.resolve().then(function loop(){ Promise.resolve().then(loop) })']) {
    const source = `const {createVmRuntime}=require(${JSON.stringify(path.join(root, 'assets/runtime-frameworks/vm-runtime'))});
      (async()=>{const r=createVmRuntime({timeoutMs:30}); await r.initialize();
      await r.load('globalThis.spin=function(){${expression}}');
      try{await r.call('spin'); process.exitCode=3;}catch(e){console.log(e.code);}
      await r.dispose(); console.log('continued');})().catch(e=>{console.error(e);process.exitCode=1});`;
    const r = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 1300 });
    assert.equal(r.signal, null, expression);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ERR_SCRIPT_EXECUTION_TIMEOUT|ERR_RUNTIME_TIMEOUT/);
    assert.match(r.stdout, /continued/);
  }
});

test('W05 Trace Proxy obeys reflection and falsy writes', () => temp(dir => {
  const target = path.join(dir, 'target.js');
  fs.writeFileSync(target, `globalThis.run = () => {
    const keys = Reflect.ownKeys(Worker);
    const d = Object.getOwnPropertyDescriptor(Worker, 'prototype');
    Worker.zero = 0; Worker.no = false; Worker.empty = '';
    const sym = Symbol('s'); Worker[sym] = false;
    const instance = new Worker('test');
    const called = Worker('test');
    Object.preventExtensions(Worker);
    return { prototype: keys.includes('prototype'), descriptor: d.configurable,
      values: [Worker.zero,Worker.no,Worker.empty,Worker[sym]],
      proto: Object.getPrototypeOf(Worker) === Function.prototype,
      constructed: typeof instance, called: typeof called, keysAfter: Reflect.ownKeys(Worker).length };
  }`);
  const r = cli('run_with_trace.js', ['--target', target, '--entry', 'run', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.data.output.errors, []);
  assert.equal(r.data.output.output.prototype, true);
  assert.equal(r.data.output.output.descriptor, false);
  assert.deepEqual(r.data.output.output.values, [0, false, '', false]);
  assert.equal(r.data.output.output.proto, true);
  assert.equal(r.data.output.output.constructed, 'function');
  assert.equal(r.data.output.output.called, 'function');
}));

test('W06 Trace distinguishes target failure, probe failure, missing evidence and timeout', () => temp(dir => {
  const target = path.join(dir, 'target.js');
  const run = (src, extra = []) => { fs.writeFileSync(target, src); return cli('run_with_trace.js', ['--target', target, '--entry', 'run', '--strict', '--json', ...extra]); };
  assert.equal(run('globalThis.run=()=>42').data.output.status, 'passed');
  const missing = run('globalThis.other=()=>42'); assert.equal(missing.code, 1); assert.equal(missing.data.output.status, 'insufficient-evidence');
  const thrown = run('globalThis.run=()=>{throw new TypeError("actual target failure")}');
  assert.equal(thrown.code, 1); assert.equal(thrown.data.output.status, 'target-failed');
  assert.equal(thrown.data.output.errors[0].message, 'actual target failure');
  const timeout = run('globalThis.run=()=>{while(true){}}', ['--timeout','25']);
  assert.equal(timeout.code, 1); assert.equal(timeout.data.output.status, 'timed-out');
  const tool = run('Object.defineProperty(globalThis,"__dumpEvents",{value:() => { throw new Error("probe broken") }}); globalThis.run=()=>42');
  assert.equal(tool.code, 2); assert.equal(tool.data.output.status, 'execution-failed');
  const async = run('globalThis.run=()=>Promise.resolve(3)');
  assert.equal(async.code, 1); assert.equal(async.data.output.status, 'insufficient-evidence');
  const f = path.join(dir, 'invalid.json'); fs.writeFileSync(f, '{bad');
  const invalid = run('globalThis.run=()=>42', ['--fixture',f]); assert.equal(invalid.code, 2); assert.equal(invalid.data.output.status, 'execution-failed');
  const diagnostic = run('globalThis.run=()=>{throw new Error("failure")}', ['--diagnostic']);
  assert.equal(diagnostic.code, 0); assert.equal(diagnostic.data.output.status, 'target-failed');
}));

test('W10 unknown browser fields stay unknown and diagnostic defaults have provenance', async () => {
  const runtime = makeRuntime();
  try {
    await runtime.initialize({ browser: { language: 'fr-FR', hardwareConcurrency: 0 } });
    assert.equal(await runtime.load('navigator.language'), 'fr-FR');
    assert.equal(await runtime.load('navigator.platform'), undefined);
    assert.equal(await runtime.load('navigator.hardwareConcurrency'), 0);
  } finally { await runtime.dispose(); }
});

test('W03 schema compatibility, explicit overrides, version/type/conflict failures and deep equality', () => temp(dir => {
  const target = path.join(dir, 'target.js'); const f = path.join(dir, 'fixture.json'); const out = path.join(dir, 'out.json');
  fs.writeFileSync(target, `globalThis.old = value => ({ sign: value }); globalThis.override = value => ({ sign: value + '!' });`);
  const run = fixture => { fs.writeFileSync(f, JSON.stringify(fixture)); return cli('run_with_trace.js', ['--target',target,'--fixture',f,'--output',out,'--strict','--json']); };
  assert.equal(run({ entry:'old', args:['legacy'], param:'sign', expected:{sign:'legacy'} }).data.output.output.sign, 'legacy');
  assert.equal(cli('compare_fixture.js', ['--fixture',f,'--actual',out,'--json']).data.pass, true);
  const override = cli('run_with_trace.js', ['--target',target,'--fixture',f,'--entry','override','--args','["cli"]','--strict','--json']);
  assert.equal(override.data.output.output.sign, 'cli!');
  for (const invalid of [
    {schemaVersion:'env-fixture/v999'}, {input:{x:1}}, {input:[],args:[1]},
    {output:'a',param:'b'}, {expected:{sign:1},expectedValue:2,param:'sign'}, {entry:9}, {browser:'not-a-map'},
  ]) {
    const r = run(invalid); assert.equal(r.code, 2, JSON.stringify(invalid));
    assert.equal(r.data.output.status, 'execution-failed'); assert.match(r.data.output.errors[0].message, /fixture/);
    assert.equal(JSON.parse(fs.readFileSync(out)).status, 'execution-failed');
  }
  assert.equal(run({schemaVersion:'env-fixture/v2',entry:'old',input:null}).data.output.status, 'insufficient-evidence');
  fs.writeFileSync(f, JSON.stringify({param:'sign',expectedValue:{a:1,b:2}}));
  fs.writeFileSync(out, JSON.stringify({output:{sign:{b:2,a:1}}}));
  assert.equal(cli('compare_fixture.js',['--fixture',f,'--actual',out,'--json']).data.pass,true);
  const explicitMissing = cli('compare_fixture.js',['--fixture',f,'--actual',out,'--expected-path','absent','--json']);
  assert.equal(explicitMissing.data.status,'insufficient-evidence');
  fs.writeFileSync(f, JSON.stringify({expected:null})); fs.writeFileSync(out, JSON.stringify({output:null}));
  assert.equal(cli('compare_fixture.js',['--fixture',f,'--actual',out,'--json']).data.pass,true);
}));

test('W04 synchronous and Promise completion, receiver and data transfer, lifecycle after timeout', async () => {
  const r = createVmRuntime({timeoutMs:40});
  await r.initialize();
  assert.equal(await r.load(`globalThis.obj={n:5, run(x){return this.n+x.value}}; 7`),7);
  assert.equal(await r.call('obj.run',[{value:2}]),7);
  await r.load(`globalThis.asyncRun=async x => { await Promise.resolve(); return x + 1; }; void 0`);
  assert.equal(await r.call('asyncRun',[8]),9);
  await assert.rejects(r.initialize(),/single-use/);
  assert.equal(r.state,'ready');
  await assert.rejects(r.call('asyncRun',[() => {}]),/JSON/);
  await r.load(`globalThis.never=()=>new Promise(()=>{}); void 0`);
  await assert.rejects(r.call('never'), {code:'ERR_RUNTIME_TIMEOUT'});
  assert.equal(r.state,'failed');
  await assert.rejects(r.load('42'),/failed/);
  await r.dispose(); await r.dispose(); assert.equal(r.state,'disposed'); assert.equal(r.context,null);
  const next=createVmRuntime(); await next.initialize(); assert.equal(await next.load('21*2'),42); await next.dispose();
});

test('W02/W11 host installation does not patch prototypes and custom host injections fail', async () => {
  const before=[Function.prototype.toString,Object.prototype.toString];
  const scope={};
  installBaseEnv(scope,{}, {addon:{available:false}}); installStorage(scope,{}, {addon:{available:false}});
  assert.deepEqual([Function.prototype.toString,Object.prototype.toString],before);
  const r=createVmRuntime({installEnv(scope){scope.bad=function hostMethod(){};}});
  await assert.rejects(r.initialize(),/host function/); await r.dispose();
  const withObject=createVmRuntime({installEnv(scope){scope.bad={inHost:true};}});
  await assert.rejects(withObject.initialize(),/host object/); await withObject.dispose();
  const nativeRequested=createVmRuntime({installEnv(scope){installStorage(scope,{}, {addon:{createNativeFunction(){}}});}});
  await assert.rejects(nativeRequested.initialize(),/Native addon/); await nativeRequested.dispose();
  const worker=createVmRuntime(); await worker.initialize(); assert.equal(await worker.load('typeof window'), 'undefined'); await worker.dispose();
});

test('W10 diagnostic assumptions are explicit, provenance retained and fixtures unchanged', () => temp(dir => {
  const { navigator, provenance } = installBaseEnv({}, {browser:{language:'fr-FR',webdriver:false},browserSources:{language:'observed'}}, {addon:{available:false},diagnosticDefaults:true});
  assert.equal(navigator.language,'fr-FR'); assert.equal(provenance.language,'observed');
  assert.equal(navigator.platform,'Win32'); assert.equal(provenance.platform,'diagnostic-default');
  assert.equal(provenance.pageUrl,'template-placeholder');
  const target=path.join(dir,'target.js'); const fixture=path.join(dir,'fixture.json');
  fs.writeFileSync(target,`globalThis.run=()=>({language:navigator.language,platform:navigator.platform,cpu:navigator.hardwareConcurrency})`);
  const original=JSON.stringify({entry:'run',browser:{language:'fr-FR',hardwareConcurrency:0},browserSources:{language:'observed'}});
  fs.writeFileSync(fixture,original);
  const run=extra=>cli('run_with_trace.js',['--target',target,'--fixture',fixture,'--json',...extra]);
  const unknown=run([]); assert.equal(unknown.data.output.output.platform,undefined); assert.equal(unknown.data.output.configuration.browserSources.platform,'unknown');
  const defaults=run(['--diagnostic-defaults']); assert.equal(defaults.data.output.output.platform,'Win32'); assert.equal(defaults.data.output.output.language,'fr-FR'); assert.equal(defaults.data.output.output.cpu,0);
  assert.equal(defaults.data.output.configuration.browserSources.language,'observed'); assert.equal(defaults.data.output.configuration.browserSources.platform,'diagnostic-default');
  assert.equal(fs.readFileSync(fixture,'utf8'),original);
}));

test('W07 jsdom formal initialization parses, queries and links edits, cookies and Storage', async () => {
  const {createJsdomExample}=require('../assets/examples/jsdom-composition');
  const r=createJsdomExample();
  try {
    await r.initialize({pageUrl:'https://example.test/path',html:'<main><p id="value" data-count="1">parsed</p></main>',request:{localStorage:{seed:'a'}}});
    await r.load(`globalThis.before = () => {const n=document.getElementById('value'); return {same:n===document.querySelector('#value'),text:n.textContent,count:n.dataset.count,realm:window instanceof Window};};
    globalThis.write=value=>{const n=document.querySelector('#value'); n.textContent=value;n.dataset.count='2';n.id='changed';document.cookie='phase=written; Path=/';localStorage.setItem('value',value);};
    globalThis.read=()=>({old:document.getElementById('value'),text:document.getElementById('changed').textContent,
      count:document.querySelector('#changed').getAttribute('data-count'),cookie:document.cookie,seed:localStorage.getItem('seed'),stored:localStorage.getItem('value')});`);
    assert.deepEqual(await r.call('before'),{same:true,text:'parsed',count:'1',realm:true});
    await r.call('write',['updated']);
    assert.deepEqual(await r.call('read'),{old:null,text:'updated',count:'2',cookie:'phase=written',seed:'a',stored:'updated'});
  } finally {await r.dispose();}
});

test('W01 direct nested candidates cannot traverse ancestor symlinks; parent cleanup only unlinks children', () => temp(dir => {
  const c=path.join(dir,'case'), outside=path.join(dir,'outside');
  fs.mkdirSync(path.join(c,'tmp'),{recursive:true}); fs.mkdirSync(path.join(outside,'tmp'),{recursive:true});
  fs.writeFileSync(path.join(outside,'tmp','debug-proof.txt'),'outside');
  fs.symlinkSync(outside,path.join(c,'logs'));
  fs.symlinkSync(outside,path.join(c,'tmp','inside-link'));
  const r=cli('clean_case.js',['--case-dir',c,'--force','--json']); assert.equal(r.code,0,r.stderr);
  assert.equal(fs.readFileSync(path.join(outside,'tmp','debug-proof.txt'),'utf8'),'outside');
  assert.equal(fs.lstatSync(path.join(c,'logs')).isSymbolicLink(),true);
  assert.equal(fs.existsSync(path.join(c,'tmp')),false);
}));

test('W05 fixed descriptors retain invariants and real target TypeErrors are preserved', () => temp(dir => {
  const f=path.join(dir,'target.js');
  fs.writeFileSync(f,`globalThis.run=()=>{
    Object.defineProperty(Worker,'fixed',{value:0,configurable:false,writable:false});
    Object.defineProperty(Worker,'noGetter',{get:undefined,configurable:false});
    const write=Reflect.set(Worker,'fixed',9); Object.freeze(Worker);
    return {fixed:Worker.fixed,write,noGetter:Worker.noGetter===undefined,keys:Reflect.ownKeys(Worker).includes('fixed'),configurable:Object.getOwnPropertyDescriptor(Worker,'fixed').configurable};
  }`);
  const r=cli('run_with_trace.js',['--target',f,'--entry','run','--strict','--json']); assert.equal(r.code,0,r.stderr);
  assert.deepEqual(r.data.output.output,{fixed:0,write:false,noGetter:true,keys:true,configurable:false});
  fs.writeFileSync(f,`globalThis.run=()=>{ 'use strict'; Object.defineProperty(Worker,'fixed',{value:0,writable:false}); Worker.fixed=3; }`);
  const thrown=cli('run_with_trace.js',['--target',f,'--entry','run','--strict','--json']);
  assert.equal(thrown.code,1); assert.equal(thrown.data.output.status,'target-failed'); assert.equal(thrown.data.output.errors[0].name,'TypeError');
}));

test('W11 explicit native protection restores only its own patches', () => {
  const r=spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict');
    const p=require(${JSON.stringify(path.join(root,'assets/env-modules/native-protect'))});
    const before=Function.prototype.toString;
    p.markNativeFunction(function one(){},'one'); assert.equal(Function.prototype.toString,before);
    p.enableNativeProtection(); const owned=Function.prototype.toString; assert.notEqual(owned,before);
    const later=function later(){}; Function.prototype.toString=later;
    p.disposeNativeProtection(); assert.equal(Function.prototype.toString,later);
    Function.prototype.toString=before;
    p.enableNativeProtection(); p.disposeNativeProtection(); assert.equal(Function.prototype.toString,before);
    console.log('verified');
  `],{encoding:'utf8',timeout:2000});
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/verified/);
});

test('W02/W11/W12 available native host combination has explicit non-vm scope', t => {
  const result=require('../scripts/load_native_addon').loadNativeAddon();
  if (!result.available) {t.skip('native addon unavailable on this platform/ABI; not verified');return;}
  const r=spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict');
    const addon=require(${JSON.stringify(result.path)});
    const {installBaseEnv}=require(${JSON.stringify(path.join(root,'assets/env-modules/base-env'))});
    const {installStorage}=require(${JSON.stringify(path.join(root,'assets/env-modules/storage-env'))});
    const {installDocumentEnv}=require(${JSON.stringify(path.join(root,'assets/env-modules/document-env'))});
    const scope={}; const before=[Function.prototype.toString,Object.prototype.toString];
    installBaseEnv(scope,{browser:{language:'en-US'}},{addon});
    installStorage(scope,{localStorage:{a:'1'}},{addon});
    const doc=installDocumentEnv(scope,{pageUrl:'https://example.test/'},{addon});
    scope.localStorage.setItem('b',2); assert.equal(scope.localStorage.getItem('b'),'2'); assert.equal(scope.localStorage.length,2);
    assert.equal(scope.navigator.language,'en-US'); assert.equal(Reflect.ownKeys(scope.localStorage).includes('__data'),false);
    assert.throws(()=>scope.Storage.prototype.getItem.call({__data:new Map()},'a'),TypeError);
    assert.deepEqual([Function.prototype.toString,Object.prototype.toString],before);
    console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,documentAllExact:doc.allStatus.exact}));
  `],{encoding:'utf8',timeout:3000});
  assert.equal(r.status,0,r.stderr); t.diagnostic(r.stdout.trim());
});

test('W06 rejected Promises remain structured target failures and nested entries keep their receiver', () => temp(dir => {
  const f=path.join(dir,'target.js');
  fs.writeFileSync(f,`globalThis.run=()=>Promise.reject(new Error('async target failure'))`);
  const r=cli('run_with_trace.js',['--target',f,'--entry','run','--strict','--json']);
  assert.equal(r.code,1,r.stderr); assert.equal(r.data.output.status,'target-failed');
  assert.ok(r.data.output.errors.some(e=>e.message==='async target failure'));
  fs.writeFileSync(f,`globalThis.sdk={n:3,run(){return this.n}}`);
  const nested=cli('run_with_trace.js',['--target',f,'--entry','window.sdk.run','--strict','--json']);
  assert.equal(nested.code,0,nested.stderr); assert.equal(nested.data.output.output,3);
}));

test('W03/W06 matching stale values never erase an upstream failure', () => temp(dir => {
  const fixture=path.join(dir,'fixture.json'),actual=path.join(dir,'actual.json');
  fs.writeFileSync(fixture,JSON.stringify({param:'sign',expectedValue:'same'}));
  for (const status of ['target-failed','timed-out','insufficient-evidence','execution-failed']) {
    fs.writeFileSync(actual,JSON.stringify({status,output:{sign:'same'}}));
    const r=cli('compare_fixture.js',['--fixture',fixture,'--actual',actual,'--json']);
    assert.equal(r.data.pass,false); assert.equal(r.data.status,status); assert.equal(r.code,status==='execution-failed'?2:1);
  }
}));
