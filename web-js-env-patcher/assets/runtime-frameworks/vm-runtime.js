// Node vm: choose from target evidence. This is not a security boundary for hostile code.
// Public environment modules are evaluated in the target Realm, never installed as host closures.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const { registerRealm, unregisterRealm } = require('../env-modules/realm-install');

function jsonData(value, label) {
  const seen = new Set();
  function check(v) {
    if (v === null || ['string', 'boolean'].includes(typeof v)) return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError(`${label} must contain finite JSON data only`);
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
      throw new TypeError(`${label} must contain plain JSON objects only`);
    }
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !('value' in d)) throw new TypeError(`${label} cannot contain accessors or symbols`);
      check(d.value);
    }
    seen.delete(v);
  }
  check(value);
  return JSON.stringify(value);
}

function createVmRuntime(options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
  if (options.addon && options.addon.available !== false) throw new TypeError('vm template supports Realm-local JS fallback only; native addon installation requires a separately audited adapter');
  let sandbox = Object.create(null);
  let context = vm.createContext(sandbox, {
    name: options.name || 'web-js-env-patcher-context',
    microtaskMode: 'afterEvaluate',
    codeGeneration: options.codeGeneration || { strings: true, wasm: false },
  });
  let phase = 'created';
  let busy = false;
  const moduleNames = ['native-protect', 'base-env', 'storage-env', 'document-env'];
  const sources = Object.fromEntries(moduleNames.map(name => [name,
    fs.readFileSync(path.join(__dirname, '..', 'env-modules', name + '.js'), 'utf8')]));
  // CommonJS-shaped source runs with a target-local, allowlisted loader. No Node require bridge.
  const loaders = Object.entries(sources).map(([name, source]) =>
    `${JSON.stringify(name)}: function(module, exports, require) {\n${source}\n}`).join(',\n');
  const state = vm.runInContext(`(() => {
    const stringify = JSON.stringify;
    const identities = new WeakMap();
    let nextIdentity = 1;
    const loaders = {${loaders}};
    const cache = Object.create(null);
    function localRequire(name) {
      if (name.startsWith('./')) name = name.slice(2);
      if (name === 'realm-install') return { installInRealm() { return { handled: false }; } };
      if (!Object.hasOwn(loaders, name)) throw new Error('Unavailable Realm module: ' + name);
      if (!cache[name]) {
        const module = { exports: {} }; cache[name] = module;
        loaders[name](module, module.exports, localRequire);
      }
      return cache[name].exports;
    }
    return {
      localRequire, input: undefined, result: undefined, error: undefined, done: false,
      adopt() {
        this.done = false; this.rejected = false; this.error = undefined; this.result = undefined;
        Promise.resolve(this.input).then(value => { this.result = value; this.done = true; },
          error => { this.rejected = true; this.error = error; this.done = true; });
      },
      exportResult(asHandle) {
        const value = this.result;
        const type = typeof value;
        if (type === 'function' || (asHandle && value !== null && type === 'object')) {
          if (!identities.has(value)) identities.set(value, nextIdentity++);
          return stringify({ kind: 'handle', id: identities.get(value), type });
        }
        if (type === 'undefined') return stringify({ kind: 'undefined' });
        if (type === 'bigint') return stringify({ kind: 'bigint', value: String(value) });
        if (type === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
          return stringify({ kind: 'number', value: Object.is(value, -0) ? '-0' : String(value) });
        }
        if (type === 'symbol') throw new TypeError('Symbol results are unsupported; inspect them inside the Realm');
        // All getters/toJSON/proxy traps execute here, under the remaining vm budget.
        const json = stringify(value);
        return stringify(json === undefined ? { kind: 'undefined' } : { kind: 'json', json });
      },
      exportError() {
        const error = this.error;
        return stringify({ name: String(error?.name || 'Error'), message: String(error?.message || error),
          code: error?.code == null ? undefined : String(error.code) });
      },
      release() { localRequire('native-protect').disposeNativeProtection(); this.input = this.result = this.error = undefined; }
    };
  })()`, context, { timeout: timeoutMs });
  // Lexical tooling state contains only Realm-local objects/functions; no host bridge.
  sandbox.__vmRuntimeState = state;
  vm.runInContext('const __vmState = __vmRuntimeState; delete globalThis.__vmRuntimeState;', context, { timeout: timeoutMs });

  let executionDeadline = Infinity;
  function execute(code, filename = 'runtime.js') {
    const remaining = Math.min(timeoutMs, executionDeadline - Date.now());
    if (remaining <= 0) { const error = new Error('Runtime completion deadline exceeded'); error.code = 'ERR_RUNTIME_TIMEOUT'; throw error; }
    return new vm.Script(code, { filename, displayErrors: false }).runInContext(context, { timeout: Math.max(1, remaining), displayErrors: false });
  }
  function install(moduleName, fixture = {}, moduleOptions = {}) {
    if (moduleOptions.addon && moduleOptions.addon.available !== false) throw new TypeError('Native addon is not supported by this vm Realm adapter');
    const data = JSON.parse(jsonData(fixture, 'fixture'));
    if (moduleName === 'base-env' || moduleName === 'document-env') {
      const url = new URL(data.pageUrl || data.apiUrl || 'https://example.com/');
      data.__parsedLocation = Object.fromEntries(['href','origin','protocol','host','hostname','port','pathname','search','hash'].map(k => [k, url[k]]));
    }
    const opts = { diagnosticDefaults: moduleOptions.diagnosticDefaults === true, addon: { available: false } };
    const entry = { 'base-env': 'installBaseEnv', 'storage-env': 'installStorage', 'document-env': 'installDocumentEnv' }[moduleName];
    if (!entry) throw new TypeError(`Unsupported environment module: ${moduleName}`);
    return execute(`__vmState.localRequire(${JSON.stringify(moduleName)}).${entry}(globalThis, JSON.parse(${JSON.stringify(JSON.stringify(data))}), JSON.parse(${JSON.stringify(JSON.stringify(opts))}))`);
  }
  registerRealm(sandbox, install);
  const realmFunction = execute('Function');
  const resultHandles = new Map();
  // Trusted installer callbacks may orchestrate modules, but must not expose host functions/data.
  function auditInstalledValues() {
    const seen = new Set();
    const targetGlobal = execute('globalThis');
    function visit(value) {
      if (value === null || !['function', 'object'].includes(typeof value) || value === sandbox || value === targetGlobal || seen.has(value)) return;
      seen.add(value);
      if (typeof value === 'function' && value !== realmFunction.prototype && !(value instanceof realmFunction)) throw new TypeError('installEnv exposed a host function; evaluate its implementation inside the target Realm');
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === Function.prototype || proto === Array.prototype) throw new TypeError('installEnv exposed a host object; pass JSON data through the Realm adapter');
      if (proto) visit(proto);
      for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if ('value' in d) visit(d.value); else { visit(d.get); visit(d.set); }
      }
    }
    for (const root of [sandbox, targetGlobal]) {
      for (const key of Reflect.ownKeys(root)) {
        const d = Object.getOwnPropertyDescriptor(root, key);
        if ('value' in d) visit(d.value); else { visit(d.get); visit(d.set); }
      }
      // Contextified globals can inherit from either root. Aliases must not skip these edges.
      visit(Object.getPrototypeOf(root));
    }
  }
  function fail(error) { phase = 'failed'; return error; }
  const hostErrors = new WeakSet();
  function hostError(data) {
    const error = new Error(data.message); error.name = data.name;
    if (data.code !== undefined) error.code = data.code;
    hostErrors.add(error);
    return error;
  }
  function timeoutCode(error) {
    // instanceof and property reads on an arbitrary thrown Proxy can run target code.
    if (!types.isNativeError(error)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code = descriptor && descriptor.value;
    return ['ERR_SCRIPT_EXECUTION_TIMEOUT', 'ERR_RUNTIME_TIMEOUT'].includes(code) ? code : undefined;
  }
  function snapshotError(error) {
    if (hostErrors.has(error)) return error;
    const code = timeoutCode(error);
    if (code) return hostError({ name: 'Error', message: `Runtime execution/completion exceeded ${timeoutMs}ms`, code });
    state.error = error;
    try { return hostError(JSON.parse(execute('__vmState.exportError()'))); }
    catch (exportError) {
      const timeout = timeoutCode(exportError);
      return hostError({ name: 'Error', message: timeout ? 'Target error snapshot exceeded runtime budget' : 'Cannot snapshot target error', ...(timeout ? { code: timeout } : {}) });
    }
  }
  function decodeResult(data) {
    if (data.kind === 'undefined') return undefined;
    if (data.kind === 'bigint') return BigInt(data.value);
    if (data.kind === 'number') return data.value === '-0' ? -0 : Number(data.value);
    if (data.kind === 'json') return JSON.parse(data.json);
    if (data.kind === 'handle') {
      if (!resultHandles.has(data.id)) resultHandles.set(data.id,
        Object.freeze(Object.assign(Object.create(null), { id: data.id, type: data.type })));
      return resultHandles.get(data.id);
    }
    throw new Error('Unsupported runtime result transport');
  }
  async function evaluate(code, filename, asHandle = false) {
    if (phase !== 'ready') throw new Error(`Runtime is ${phase}; initialize once, dispose after failure`);
    if (busy) throw new Error('Concurrent operations on one runtime are unsupported');
    busy = true;
    const deadline = Date.now() + timeoutMs;
    executionDeadline = deadline;
    try {
      state.input = execute(code, filename);
      execute('__vmState.adopt()');
      while (!state.done) {
        if (Date.now() >= deadline) {
          const error = new Error(`Runtime completion exceeded ${timeoutMs}ms`); error.code = 'ERR_RUNTIME_TIMEOUT'; throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1));
        if (phase !== 'ready') throw new Error(`Runtime is ${phase}`);
        try { execute('void 0'); } // drain only this context's microtasks within the vm timeout
        catch (error) {
          if (timeoutCode(error) !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw error;
          const timeout = new Error(`Runtime completion exceeded ${timeoutMs}ms`);
          timeout.code = 'ERR_RUNTIME_TIMEOUT'; throw timeout;
        }
      }
      if (state.rejected) throw hostError(JSON.parse(execute('__vmState.exportError()')));
      return decodeResult(JSON.parse(execute(`__vmState.exportResult(${asHandle})`)));
    } catch (error) {
      // Never let target error getters escape the controlled execution boundary either.
      throw fail(snapshotError(error));
    }
    finally { state.input = state.result = state.error = undefined; executionDeadline = Infinity; busy = false; }
  }
  const runtime = {
    name: 'vm',
    capabilities: { realmLocalModules: true, nativeAddon: false, resultTransport: 'JSON snapshots; opaque identity handles for functions or loadHandle', asyncCompletion: 'Promise; no timers or I/O backend', windowIdentity: 'single Window, no WindowProxy/frames' },
    get context() { return context; },
    get sandbox() { return sandbox; },
    get state() { return phase; },
    async initialize(fixture = {}) {
      if (phase !== 'created') throw new Error(`Runtime is ${phase}; initialize is single-use`);
      try {
        execute("__vmState.localRequire('native-protect').enableNativeProtection()");
        if (options.installEnv) await options.installEnv(sandbox, fixture, options);
        for (const name of options.envModules || []) install(name, fixture, options);
        auditInstalledValues();
        phase = 'ready';
      } catch (error) { throw fail(error); }
    },
    async load(sourceCode, meta = {}) { return evaluate(String(sourceCode), meta.filename || 'target.js'); },
    async loadHandle(sourceCode, meta = {}) { return evaluate(String(sourceCode), meta.filename || 'target.js', true); },
    async call(entry, args = []) {
      if (typeof entry !== 'string' || !entry.split('.').every(x => /^[A-Za-z_$][\w$]*$/.test(x))) throw new TypeError('entry must be a dotted identifier path');
      if (!Array.isArray(args)) throw new TypeError('args must be an array');
      const parts = entry.split('.');
      if (['window','globalThis','self'].includes(parts[0])) parts.shift();
      return evaluate(`(() => {
        const parts = ${JSON.stringify(parts)}; let receiver = globalThis;
        for (const key of parts.slice(0, -1)) receiver = receiver?.[key];
        const fn = receiver?.[parts[parts.length - 1]];
        if (typeof fn !== 'function') throw new TypeError('Entry not found: ' + ${JSON.stringify(entry)});
        return Reflect.apply(fn, receiver, JSON.parse(${JSON.stringify(jsonData(args, 'args'))}));
      })()`, 'runtime-entry.js');
    },
    async dispose() {
      if (phase === 'disposed') return;
      phase = 'disposed'; unregisterRealm(sandbox);
      try { execute('__vmState.release()'); } finally { resultHandles.clear(); context = null; sandbox = null; }
    },
  };
  return runtime;
}
module.exports = { createVmRuntime, jsonData };
