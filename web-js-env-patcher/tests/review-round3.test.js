'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runner = path.resolve(__dirname, '../scripts/run_with_trace.js');

function temp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-review-round3-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function trace(dir, source) {
  const target = path.join(dir, 'target.js'), output = path.join(dir, 'output.json');
  fs.writeFileSync(target, source); fs.rmSync(output, { force: true });
  const r = spawnSync(process.execPath, [runner, '--target', target, '--entry', 'run', '--strict', '--json', '--timeout', '35', '--output', output], { encoding: 'utf8', timeout: 1500 });
  assert.equal(r.signal, null, source);
  const data = JSON.parse(r.stdout).output;
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), data);
  return { code: r.status, data, stderr: r.stderr };
}

test('R07 exception getters and conversions remain bounded across load, entry, rejection and probe', () => temp(dir => {
  const cases = [
    `throw {get message(){while(true){}}};`,
    `throw {get name(){while(true){}}};`,
    `throw {get code(){while(true){}}};`,
    `throw new Proxy({}, {get(){while(true){}}});`,
    `throw {[Symbol.toPrimitive](){while(true){}}};`,
    `globalThis.run=()=>{throw {get message(){while(true){}}}};`,
    `globalThis.run=()=>Promise.reject({get message(){while(true){}}});`,
    `globalThis.run=()=>Promise.resolve().then(()=>{while(true){}});`,
    `globalThis.run=()=>Promise.resolve().then(function loop(){Promise.resolve().then(loop)});`,
    `Object.defineProperty(globalThis,'__dumpEvents',{value(){throw {get name(){while(true){}}}}});globalThis.run=()=>42;`,
  ];
  for (const source of cases) {
    const r = trace(dir, source);
    assert.equal(r.code, 1, r.stderr); assert.equal(r.data.status, 'timed-out', source);
    assert.ok(r.data.errors.some(e => e.type === 'timeout'));
  }
}));

test('R07 snapshot failures stay structured without fabricating environment gaps', () => temp(dir => {
  for (const source of [
    `throw {get message(){throw new Error('conversion failed')}};`,
    `globalThis.run=()=>{throw {message:{toString(){throw 42}}}};`,
    `Promise.reject({get code(){throw 'broken code'}});globalThis.run=()=>42;`,
  ]) {
    const r = trace(dir, source);
    assert.equal(r.code, 1); assert.equal(r.data.status, 'target-failed');
    assert.ok(r.data.errors.some(e => e.normalizationFailed === true));
    assert.match(r.data.errors.find(e => e.normalizationFailed).operation, /snapshot/);
    assert.ok(r.data.errors.every(e => !['missing-global', 'missing-property', 'missing-method'].includes(e.type)));
  }
  const normal = trace(dir, `throw new Error('ordinary load failed');`);
  assert.equal(normal.data.errors[0].message, 'ordinary load failed');
  assert.equal(normal.data.errors[0].source, 'target'); assert.equal(normal.data.errors[0].phase, 'load');
  const stack = trace(dir, `throw {name:'CustomError',message:'safe message',get stack(){while(true){}}};`);
  assert.equal(stack.data.status, 'target-failed'); assert.equal(stack.data.errors[0].message, 'safe message');
}));

test('R08 Promise creation ownership survives null, unrelated and trapping prototypes', () => temp(dir => {
  for (const proto of ['null', '{}', `new Proxy(Promise.prototype,{getPrototypeOf(){while(true){}}})`]) {
    const r = trace(dir, `globalThis.run=()=>{const p=Promise.reject(new Error('target rejection'));Object.setPrototypeOf(p,${proto});return 42;};`);
    assert.equal(r.code, 1); assert.equal(r.data.status, 'target-failed');
    const error = r.data.errors.find(e => e.message === 'target rejection');
    assert.ok(error); assert.equal(error.source, 'target'); assert.equal(error.phase, 'entry');
    assert.equal(r.stderr, '');
  }
}));

test('R08 sequential runs restore listeners and identify actual host/tool rejections', () => temp(dir => {
  const target = path.join(dir, 'target.js');
  fs.writeFileSync(target, 'globalThis.run=()=>42');
  const script = `const assert=require('node:assert/strict');const fs=require('node:fs');const {run}=require(${JSON.stringify(runner)});
    (async()=>{
      const before=process.listenerCount('unhandledRejection');
      const args={target:${JSON.stringify(target)},entry:'run',timeout:100,strict:true};
      for(let i=0;i<3;i++){
        const result=await run(args);assert.equal(result.output.status,'passed');
        assert.equal(process.listenerCount('unhandledRejection'),before);
      }
      const first=run(args);await assert.rejects(run(args),/Concurrent Trace/);await first;
      await assert.rejects(run({...args,output:${JSON.stringify(dir)}}),/EISDIR/);
      assert.equal(process.listenerCount('unhandledRejection'),before);
      const read=fs.readFileSync;let injected=false;
      fs.readFileSync=function(file,...args){if(file===${JSON.stringify(target)}&&!injected){injected=true;Promise.reject(new Error('real host tool failure'));}return read.call(this,file,...args)};
      try{
        const result=await run(args);assert.equal(result.output.status,'execution-failed');
        assert.ok(result.output.errors.some(e=>e.source==='tool'&&e.message==='real host tool failure'));
      }finally{fs.readFileSync=read;}
      assert.equal(process.listenerCount('unhandledRejection'),before);console.log('verified');
    })().catch(e=>{console.error(e);process.exitCode=1});`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 2000 });
  assert.equal(r.signal, null); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /verified/);
}));

test('R07 vm template also bypasses Node decoration of thrown Proxy stack access', () => {
  const vmRuntime = path.resolve(__dirname, '../assets/runtime-frameworks/vm-runtime');
  const source = `const assert=require('node:assert/strict');const {createVmRuntime}=require(${JSON.stringify(vmRuntime)});
    (async()=>{const r=createVmRuntime({timeoutMs:35});await r.initialize();
      try{await assert.rejects(r.load('throw new Proxy({}, {get(){while(true){}}})'),e=>/TIMEOUT/.test(e.code));
      assert.equal(r.state,'failed');}finally{await r.dispose();}console.log('continued');
    })().catch(e=>{console.error(e);process.exitCode=1});`;
  const r = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 1500 });
  assert.equal(r.signal, null); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /continued/);
});

test('R09 error fields preserve nonstrings, empty messages and primitive throws', () => temp(dir => {
  for (const [value, name, message] of [
    [`{name:'CustomError',message:42}`, 'CustomError', '42'],
    [`{name:'CustomError',message:''}`, 'CustomError', ''],
    [`{name:'CustomError',message:null}`, 'CustomError', 'null'],
    [`{name:'CustomError',message:false}`, 'CustomError', 'false'],
    [`{name:7,message:0}`, '7', '0'],
    [`'primitive error'`, 'Error', 'primitive error'], ['42', 'Error', '42'],
    ['null', 'Error', 'null'], ['undefined', 'Error', 'undefined'],
  ]) {
    const r = trace(dir, `globalThis.run=()=>{throw ${value}};`);
    assert.equal(r.code, 1); assert.equal(r.data.status, 'target-failed');
    const error = r.data.errors[0];
    assert.equal(error.name, name); assert.equal(error.message, message);
    assert.equal(error.source, 'target'); assert.equal(error.phase, 'entry');
    assert.equal(error.type, 'runtime-error'); assert.equal(error.missing, undefined);
  }
  const reference = trace(dir, `globalThis.run=()=>unknownGlobalForReview();`);
  assert.equal(reference.data.errors[0].type, 'missing-global');
  assert.equal(reference.data.errors[0].missing, 'unknownGlobalForReview');
}));

test('R07 invalid probe transport never coerces target objects on the host', () => temp(dir => {
  const r = trace(dir, `Object.defineProperty(globalThis,'__dumpEvents',{value:()=>({toString(){while(true){}}})});globalThis.run=()=>42;`);
  assert.equal(r.code, 2); assert.equal(r.data.status, 'execution-failed');
  assert.ok(r.data.errors.some(e => e.type === 'probe-error'));
}));
