#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { types } = require('node:util');
const { promiseHooks } = require('node:v8');
const { performance } = require('node:perf_hooks');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { normalizeFixture } = require('./fixture_schema');

function parseArgs(argv) {
  const args = { target: '', entry: '', fixture: '', trace: '', summary: '', output: '', addon: '', timeout: 5000, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = argv[++i] || '';
    else if (a === '--entry') args.entry = argv[++i] || '';
    else if (a === '--fixture') args.fixture = argv[++i] || '';
    else if (a === '--trace') args.trace = argv[++i] || '';
    else if (a === '--summary') args.summary = argv[++i] || '';
    else if (a === '--output') args.output = argv[++i] || '';
    else if (a === '--addon') args.addon = argv[++i] || '';
    else if (a === '--timeout') args.timeout = Number(argv[++i] || '5000');
    else if (a === '--args') args.callArgs = JSON.parse(argv[++i]);
    else if (a === '--strict') args.strict = true;
    else if (a === '--diagnostic') args.strict = false;
    else if (a === '--diagnostic-defaults') args.diagnosticDefaults = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/run_with_trace.js --target case/js/original/app.js --entry window.makeSign --fixture case/fixtures/sample.fixture.json --trace case/tmp/env-trace.jsonl --summary case/tmp/missing-env.json --output case/tmp/node-output.json

说明：该脚本用于探测模式。CLI 在专用 Worker 内使用 Node 的 throw 策略收集未处理拒绝。--strict 对目标失败/超时/证据不足返回 1，工具失败总返回 2；默认诊断模式返回 0 但保留明确 status。--args JSON数组覆盖 fixture 位置参数，--diagnostic-defaults 显式启用并记录假设配置。Promise 结果标记未完成。默认在 vm 探测上下文内定义浏览器桩函数，避免把宿主 require/process/Buffer 以及 Node 自带 navigator/performance/localStorage 等 Web API 兼容层暴露给目标 JS；正式交付不强制只能使用 vm。`;
}

function readJson(p) { return p ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) : {}; }
function ensureParent(p) { if (p) fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true }); }

function errorTransportSource() {
  return `const __traceErrorTransport = (() => {
    const stringify = JSON.stringify, toString = String, create = Object.create;
    const apply = Reflect.apply, slice = String.prototype.slice;
    const text = value => apply(slice, toString(value), [0, 16384]);
    function encode(error) {
      const data = create(null);
      try {
        const object = error !== null && (typeof error === 'object' || typeof error === 'function');
        const name = object ? error.name : undefined;
        const message = object ? error.message : undefined;
        const code = object ? error.code : undefined;
        data.name = name == null ? 'Error' : text(name);
        data.message = message === undefined ? text(error) : text(message);
        if (code != null) data.code = text(code);
      } catch (_) {
        // Do not recursively read an exception thrown by an exception getter.
        data.name = 'Error'; data.message = 'Target exception fields could not be normalized';
        data.normalizationFailed = true;
      }
      return stringify(data);
    }
    function capture(operation) {
      try { return {__proto__:null, ok:true, value:operation()}; }
      catch (error) { return {__proto__:null, ok:false, value:error}; }
    }
    return Object.seal(Object.defineProperties(create(null), {
      raw: {value:undefined, writable:true}, encode: {value:encode}, capture: {value:capture}
    }));
  })(); __traceErrorTransport;`;
}

// Native brand checks and own data descriptors do not traverse target Proxy prototypes
// or invoke accessors. Only use this path for host/tool errors and vm timeout recognition.
function hostErrorData(error) {
  if (error === null || !['object', 'function'].includes(typeof error)) {
    return { name: 'Error', message: String(error) };
  }
  if (!types.isNativeError(error)) return { name: 'Error', message: 'Uninspectable tool exception' };
  const ownText = key => {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
  };
  const name = ownText('name') || (Object.getPrototypeOf(error) === SyntaxError.prototype ? 'SyntaxError' : 'Error');
  return { name, message: ownText('message') ?? 'Tool exception has no readable own message', code: ownText('code') };
}

const vmTimeoutCode = 'ERR_SCRIPT_EXECUTION_TIMEOUT';

function bootstrapSource(fixture) {
  const fixtureText = JSON.stringify(JSON.stringify(fixture || {}));
  return `
'use strict';
const __fixture = JSON.parse(${fixtureText});
Object.defineProperty(globalThis, '__events', { value: [], enumerable: false, configurable: true });
function __safe(v) {
  if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map(__safe);
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (typeof v === 'object') return '[Object ' + ((v.constructor && v.constructor.name) || 'Object') + ']';
  return '[' + typeof v + ']';
}
function __push(e) {
  try {
    e.ts = Date.now();
    __events.push(e);
  } catch (_) {}
}
Object.defineProperty(globalThis, '__push', { value: __push, enumerable: false, configurable: true });

function traceProxy(name, options) {
  options = options || {};
  const target = function traceProxyFunction() {};
  const primitive = options.primitive == null ? '' : options.primitive;
  return new Proxy(target, {
    get(t, prop) {
      __push({ type: 'get', path: name + '.' + String(prop) });
      if (Reflect.has(t, prop)) return Reflect.get(t, prop);
      if (!Reflect.isExtensible(t)) return undefined;
      if (prop === Symbol.toPrimitive) return function(hint) { __push({ type: 'toPrimitive', path: name, hint: hint }); return hint === 'number' ? 0 : primitive; };
      if (prop === Symbol.toStringTag) return options.tag || name.split('.').pop() || 'Object';
      if (prop === 'then') return undefined;
      if (prop === 'toString') return function toString() { __push({ type: 'call', path: name + '.toString', args: [] }); return String(primitive || '[object ' + (options.tag || 'Object') + ']'); };
      if (prop === 'valueOf') return function valueOf() { __push({ type: 'call', path: name + '.valueOf', args: [] }); return primitive || 0; };
      const key = String(prop);
      const value = traceProxy(name + '.' + key);
      Reflect.defineProperty(t, prop, { value, writable: true, enumerable: true, configurable: true });
      return value;
    },
    set(t, prop, value) { const key = String(prop); __push({ type: 'set', path: name + '.' + key, value: __safe(value), valueType: typeof value }); return Reflect.set(t, prop, value); },
    has(t, prop) { __push({ type: 'has', path: name, prop: String(prop) }); return Reflect.has(t, prop); },
    ownKeys(t) { __push({ type: 'ownKeys', path: name }); return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, prop) { __push({ type: 'getOwnPropertyDescriptor', path: name, prop: String(prop) }); return Reflect.getOwnPropertyDescriptor(t, prop); },
    getPrototypeOf(t) { __push({ type: 'getPrototypeOf', path: name }); return Reflect.getPrototypeOf(t); },
    apply(t, thisArg, args) { __push({ type: 'call', path: name, args: Array.from(args).map(v => typeof v) }); return traceProxy(name + '()'); },
    construct(t, args) { __push({ type: 'new', path: name, args: Array.from(args).map(v => typeof v) }); return traceProxy('new ' + name); },
  });
}

function makeStorage(name, initial) {
  const data = new Map(Object.entries(initial || {}).map(([k, v]) => [String(k), String(v)]));
  const storage = {
    get length() { __push({ type: 'get', path: name + '.length' }); return data.size; },
    key(i) { __push({ type: 'call', path: name + '.key', args: ['number'] }); return Array.from(data.keys())[Number(i)] ?? null; },
    getItem(k) { __push({ type: 'call', path: name + '.getItem', args: ['string'] }); k = String(k); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { __push({ type: 'call', path: name + '.setItem', args: ['string', 'string'] }); data.set(String(k), String(v)); },
    removeItem(k) { __push({ type: 'call', path: name + '.removeItem', args: ['string'] }); data.delete(String(k)); },
    clear() { __push({ type: 'call', path: name + '.clear', args: [] }); data.clear(); },
  };
  return storage;
}

function parseLocation(raw) {
  const s = String(raw || 'https://example.com/');
  const m = s.match(/^([a-z][a-z0-9+.-]*:)\\/\\/([^\\/?#]*)([^?#]*)(\\?[^#]*)?(#.*)?$/i);
  if (!m) return { href: s, origin: '', protocol: '', host: '', hostname: '', port: '', pathname: '', search: '', hash: '', toString() { return this.href; } };
  const protocol = m[1], host = m[2], pathname = m[3] || '/', search = m[4] || '', hash = m[5] || '';
  const hp = host.split(':');
  return { href: protocol + '//' + host + pathname + search + hash, origin: protocol + '//' + host, protocol, host, hostname: hp[0], port: hp[1] || '', pathname, search, hash, toString() { return this.href; } };
}

class URLSearchParams {
  constructor(init) {
    this._pairs = [];
    if (typeof init === 'string') {
      const text = init.replace(/^\\?/, '');
      if (text) for (const part of text.split('&')) {
        if (!part) continue;
        const idx = part.indexOf('=');
        const k = idx >= 0 ? part.slice(0, idx) : part;
        const v = idx >= 0 ? part.slice(idx + 1) : '';
        this.append(decodeURIComponent(k.replace(/\\+/g, ' ')), decodeURIComponent(v.replace(/\\+/g, ' ')));
      }
    } else if (init && typeof init === 'object') {
      for (const k of Object.keys(init)) this.append(k, init[k]);
    }
  }
  append(k, v) { this._pairs.push([String(k), String(v)]); }
  set(k, v) { k = String(k); this._pairs = this._pairs.filter(p => p[0] !== k); this.append(k, v); }
  get(k) { k = String(k); const p = this._pairs.find(x => x[0] === k); return p ? p[1] : null; }
  has(k) { k = String(k); return this._pairs.some(x => x[0] === k); }
  toString() { return this._pairs.map(p => encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1])).join('&'); }
}
globalThis.URLSearchParams = URLSearchParams;

class URL {
  constructor(input, base) {
    const loc = parseLocation(input || base || 'https://example.com/');
    Object.assign(this, loc);
    this.searchParams = new URLSearchParams(this.search);
  }
  toString() { return this.href; }
}
globalThis.URL = URL;

class TextEncoder {
  encode(input) {
    const s = unescape(encodeURIComponent(String(input)));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
}
class TextDecoder {
  decode(input) {
    const arr = Array.from(input || []);
    return decodeURIComponent(escape(String.fromCharCode.apply(null, arr)));
  }
}
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

const __b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
function btoa(input) {
  let str = String(input), output = '';
  for (let block = 0, charCode, i = 0, map = __b64chars; str.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
    charCode = str.charCodeAt(i += 3 / 4);
    if (charCode > 0xFF) throw new Error('字符超出 Latin1 范围');
    block = block << 8 | charCode;
  }
  return output;
}
function atob(input) {
  let str = String(input).replace(/=+$/, ''), output = '';
  if (str.length % 4 === 1) throw new Error('无效 base64');
  for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = __b64chars.indexOf(buffer);
  }
  return output;
}
globalThis.atob = atob;
globalThis.btoa = btoa;

const console = {};
for (const name of ['log', 'warn', 'error', 'info', 'debug', 'trace', 'group', 'groupEnd']) {
  console[name] = function() { __push({ type: 'console', path: 'console.' + name, args: Array.from(arguments).map(v => typeof v) }); };
}
globalThis.console = console;

let __timerId = 1;
globalThis.setTimeout = function(fn, delay) { __push({ type: 'call', path: 'setTimeout', args: [typeof fn, typeof delay] }); return __timerId++; };
globalThis.clearTimeout = function(id) { __push({ type: 'call', path: 'clearTimeout', args: [typeof id] }); };
globalThis.setInterval = function(fn, delay) { __push({ type: 'call', path: 'setInterval', args: [typeof fn, typeof delay] }); return __timerId++; };
globalThis.clearInterval = function(id) { __push({ type: 'call', path: 'clearInterval', args: [typeof id] }); };

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
globalThis.parent = globalThis;

const browser = __fixture.browser || {};
const request = __fixture.request || {};
const runtime = __fixture.runtime || {};
globalThis.location = parseLocation(__fixture.pageUrl || __fixture.url || __fixture.apiUrl || 'https://example.com/');
globalThis.screen = Object.assign({}, browser.screen || {});
globalThis.devicePixelRatio = browser.devicePixelRatio ?? undefined;
globalThis.history = traceProxy('history');
const __navigatorData = {
  userAgent: browser.userAgent ?? undefined,
  language: browser.language ?? undefined,
  languages: browser.languages ?? undefined,
  platform: browser.platform ?? undefined,
  hardwareConcurrency: browser.hardwareConcurrency ?? undefined,
  deviceMemory: browser.deviceMemory ?? undefined,
  webdriver: browser.webdriver ?? undefined,
  plugins: traceProxy('navigator.plugins', { tag: 'PluginArray' }),
  mimeTypes: traceProxy('navigator.mimeTypes', { tag: 'MimeTypeArray' }),
};
globalThis.navigator = {};
for (const key of Object.keys(__navigatorData)) {
  Object.defineProperty(globalThis.navigator, key, {
    get() { __push({ type: 'get', path: 'navigator.' + key }); return __navigatorData[key]; },
    enumerable: true,
    configurable: true,
  });
}

class Document {}
class HTMLDocument extends Document {}
globalThis.Document = Document;
globalThis.HTMLDocument = HTMLDocument;
const document = new HTMLDocument();
let cookieText = request.cookies && typeof request.cookies === 'object' ? Object.entries(request.cookies).map(([k, v]) => k + '=' + v).join('; ') : '';
Object.defineProperty(Document.prototype, 'cookie', {
  get() { __push({ type: 'get', path: 'document.cookie' }); return cookieText; },
  set(v) { __push({ type: 'set', path: 'document.cookie', valueType: typeof v }); cookieText = cookieText ? cookieText + '; ' + String(v).split(';')[0] : String(v).split(';')[0]; },
  enumerable: true,
  configurable: true,
});
document.URL = globalThis.location.href;
document.referrer = __fixture.referrer || '';
document.createElement = function(tag) { __push({ type: 'call', path: 'document.createElement', args: ['string'] }); return traceProxy('document.createElement(' + String(tag) + ')', { tag: String(tag).toUpperCase() }); };
document.querySelector = function() { __push({ type: 'call', path: 'document.querySelector', args: ['string'] }); return null; };
document.querySelectorAll = function() { __push({ type: 'call', path: 'document.querySelectorAll', args: ['string'] }); return []; };
Object.defineProperty(document, 'all', { get() { __push({ type: 'get', path: 'document.all' }); return undefined; }, enumerable: false, configurable: true });
globalThis.document = document;

globalThis.localStorage = makeStorage('localStorage', request.localStorage || __fixture.localStorage || {});
globalThis.sessionStorage = makeStorage('sessionStorage', request.sessionStorage || __fixture.sessionStorage || {});

const randomBytes = Array.isArray(runtime.randomBytes) ? runtime.randomBytes : [];
globalThis.crypto = {
  getRandomValues(arr) { __push({ type: 'call', path: 'crypto.getRandomValues', args: [arr && arr.constructor && arr.constructor.name || typeof arr] }); for (let i = 0; i < arr.length; i++) arr[i] = randomBytes[i] ?? 0; return arr; },
  randomUUID() { __push({ type: 'call', path: 'crypto.randomUUID', args: [] }); return runtime.randomUUID || '00000000-0000-4000-8000-000000000000'; },
  subtle: traceProxy('crypto.subtle'),
};
globalThis.performance = {
  now() { __push({ type: 'call', path: 'performance.now', args: [] }); return runtime.performanceNow ?? 0; },
  timeOrigin: runtime.timeOrigin ?? runtime.now ?? Date.now(),
};
globalThis.fetch = function fetchStub() { __push({ type: 'call', path: 'fetch', args: Array.from(arguments).map(v => typeof v) }); return Promise.reject(new Error('补环境探测模式默认不发起真实网络请求')); };
for (const name of ['XMLHttpRequest', 'Image', 'HTMLElement', 'HTMLCanvasElement', 'WebGLRenderingContext', 'Headers', 'Request', 'Response', 'WebSocket', 'Worker', 'MessageChannel']) {
  globalThis[name] = traceProxy(name);
}

if (runtime.now) {
  const RealDate = Date;
  function FixedDate() {
    const args = Array.from(arguments);
    if (!(this instanceof FixedDate)) return new RealDate(args.length ? args[0] : runtime.now).toString();
    return new RealDate(args.length ? args[0] : runtime.now);
  }
  FixedDate.now = function() { return runtime.now; };
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  FixedDate.prototype = RealDate.prototype;
  globalThis.Date = FixedDate;
}

function __resolveEntry(entry) {
  const parts = String(entry || '').split('.').filter(Boolean);
  if (parts[0] === 'globalThis' || parts[0] === 'window') parts.shift();
  let cur = globalThis;
  let receiver = globalThis;
  for (const part of parts) { if (cur == null) return { fn: undefined, receiver }; receiver = cur; cur = cur[part]; }
  return { fn: cur, receiver };
}
function __serialize(v) {
  if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  try { return JSON.parse(JSON.stringify(v)); } catch (_) { return String(v); }
}
Object.defineProperty(globalThis, '__callEntry', { value: function(entry, argsJson) {
  let entryFound = false;
  try {
    const resolved = __resolveEntry(entry);
    const fn = resolved.fn;
    if (typeof fn !== 'function') return JSON.stringify({ entryFound: false });
    entryFound = true;
    const args = JSON.parse(argsJson || '[]');
    const ret = fn.apply(resolved.receiver, args);
    if (ret && typeof ret.then === 'function') {
      Promise.resolve(ret).catch(error => __push({ type: 'async-target-error', ...JSON.parse(__traceErrorTransport.encode(error)) }));
      return JSON.stringify({ entryFound: true, async: true });
    }
    return JSON.stringify({ entryFound: true, output: __serialize(ret), outputType: typeof ret });
  } catch (err) {
    return JSON.stringify({ entryFound, error: JSON.parse(__traceErrorTransport.encode(err)) });
  }
}, enumerable: false, configurable: true });
Object.defineProperty(globalThis, '__dumpEvents', { value: function() { return JSON.stringify(__events); }, enumerable: false, configurable: true });
Object.defineProperty(globalThis, '__leakageCheck', { value: function() {
  let functionProcess = 'error';
  let objectCtorProcess = 'error';
  let arrayCtorProcess = 'error';
  try { functionProcess = Function('return typeof process')(); } catch (err) { functionProcess = 'error:' + err.message; }
  try { objectCtorProcess = ({}).constructor.constructor('return typeof process')(); } catch (err) { objectCtorProcess = 'error:' + err.message; }
  try { arrayCtorProcess = ([]).constructor.constructor('return typeof process')(); } catch (err) { arrayCtorProcess = 'error:' + err.message; }
  const navUserAgent = typeof navigator !== 'undefined' && navigator ? String(navigator.userAgent || '') : 'undefined';
  const perfHas = function(name) { try { return typeof performance !== 'undefined' && performance ? (name in performance) : false; } catch (_) { return false; } };
  return JSON.stringify({
    process: typeof process,
    Buffer: typeof Buffer,
    require: typeof require,
    module: typeof module,
    exports: typeof exports,
    global: typeof global,
    setImmediate: typeof setImmediate,
    clearImmediate: typeof clearImmediate,
    functionProcess,
    objectCtorProcess,
    arrayCtorProcess,
    navigator: typeof navigator,
    navigatorUserAgent: navUserAgent,
    navigatorIsNodeUserAgent: /^Node\\.js\\//.test(navUserAgent),
    navigatorLocks: typeof navigator !== 'undefined' && navigator ? typeof navigator.locks : 'undefined',
    performance: typeof performance,
    performanceNodeTiming: perfHas('nodeTiming') ? 'present' : 'absent',
    performanceEventLoopUtilization: perfHas('eventLoopUtilization') ? 'present' : 'absent',
    performanceTimerify: perfHas('timerify') ? 'present' : 'absent',
    performanceMarkResourceTiming: perfHas('markResourceTiming') ? 'present' : 'absent',
    localStorage: typeof localStorage,
    localStorageConstructor: typeof localStorage !== 'undefined' && localStorage && localStorage.constructor ? localStorage.constructor.name : 'undefined',
    sessionStorage: typeof sessionStorage,
    sessionStorageConstructor: typeof sessionStorage !== 'undefined' && sessionStorage && sessionStorage.constructor ? sessionStorage.constructor.name : 'undefined',
    fetch: typeof fetch,
    webSocket: typeof WebSocket,
    broadcastChannel: typeof BroadcastChannel,
    messageChannel: typeof MessageChannel,
    crypto: typeof crypto,
    cryptoConstructor: typeof crypto !== 'undefined' && crypto && crypto.constructor ? crypto.constructor.name : 'undefined',
    subtleCrypto: typeof crypto !== 'undefined' && crypto && crypto.subtle ? typeof crypto.subtle : 'undefined',
    URL: typeof URL,
    URLConstructor: typeof URL !== 'undefined' && URL ? URL.name : 'undefined',
    URLSearchParams: typeof URLSearchParams,
    TextEncoder: typeof TextEncoder,
    TextDecoder: typeof TextDecoder,
    ReadableStream: typeof ReadableStream,
    EventTarget: typeof EventTarget,
    AbortController: typeof AbortController,
    WebAssembly: typeof WebAssembly,
    queueMicrotask: typeof queueMicrotask,
  });
}, enumerable: false, configurable: true });
`;
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasType = (value, key, type) => Object.hasOwn(value, key) && typeof value[key] === type;
const optionalType = (value, key, type) => !Object.hasOwn(value, key) || hasType(value, key, type);

function isErrorPayload(value) {
  return isRecord(value) && hasType(value, 'name', 'string') && hasType(value, 'message', 'string') &&
    optionalType(value, 'code', 'string') && optionalType(value, 'normalizationFailed', 'boolean');
}

function isEntryPayload(value) {
  if (!isRecord(value) || !hasType(value, 'entryFound', 'boolean')) return false;
  const hasOutput = Object.hasOwn(value, 'output');
  const hasOutputType = Object.hasOwn(value, 'outputType');
  const hasAsync = Object.hasOwn(value, 'async');
  if (Object.hasOwn(value, 'error')) return !hasOutput && !hasOutputType && !hasAsync && isErrorPayload(value.error);
  if (!value.entryFound) return !hasOutput && !hasOutputType && !hasAsync;
  if (hasAsync) return value.async === true && !hasOutput && !hasOutputType;
  if (!hasOutputType) return false;
  switch (value.outputType) {
    case 'undefined': return !hasOutput;
    case 'number': return hasOutput && (value.output === null || typeof value.output === 'number');
    case 'object': return hasOutput; // Objects can serialize to any JSON value.
    case 'boolean': return hasType(value, 'output', 'boolean');
    case 'string': case 'bigint': case 'symbol': case 'function': return hasType(value, 'output', 'string');
    default: return false;
  }
}

// Keep these names in sync with __leakageCheck's result above.
const leakageTextFields = [
  'process', 'Buffer', 'require', 'module', 'exports', 'global', 'setImmediate', 'clearImmediate',
  'functionProcess', 'objectCtorProcess', 'arrayCtorProcess', 'navigator', 'navigatorUserAgent', 'navigatorLocks',
  'performance', 'performanceNodeTiming', 'performanceEventLoopUtilization', 'performanceTimerify',
  'performanceMarkResourceTiming', 'localStorage', 'localStorageConstructor', 'sessionStorage',
  'sessionStorageConstructor', 'fetch', 'webSocket', 'broadcastChannel', 'messageChannel', 'crypto',
  'cryptoConstructor', 'subtleCrypto', 'URL', 'URLConstructor', 'URLSearchParams', 'TextEncoder',
  'TextDecoder', 'ReadableStream', 'EventTarget', 'AbortController', 'WebAssembly', 'queueMicrotask',
];
function isLeakagePayload(value) {
  return isRecord(value) && hasType(value, 'navigatorIsNodeUserAgent', 'boolean') &&
    leakageTextFields.every(key => hasType(value, key, 'string'));
}

function isEventPayload(value) {
  return Array.isArray(value) && value.every(event =>
    isRecord(event) && hasType(event, 'type', 'string') && optionalType(event, 'prop', 'string') &&
    (event.type === 'async-target-error' ? isErrorPayload(event) && optionalType(event, 'path', 'string')
      : hasType(event, 'path', 'string')));
}

function classifyError(data, provenance = { source: 'target', phase: 'entry' }, timeoutEvidence) {
  // Callers supply host-created or JSON-parsed data, never raw target exceptions.
  if (!data || typeof data.name !== 'string' || typeof data.message !== 'string') {
    return { ...provenance, operation: 'error-snapshot', type: 'error-snapshot-failed', name: 'Error', message: 'Invalid normalized exception data', normalizationFailed: true };
  }
  const { name, message } = data;
  const detail = { name, message, ...provenance,
    ...(data.code !== undefined ? { code: data.code } : {}),
    ...(data.normalizationFailed ? { normalizationFailed: true,
      ...(provenance.operation && !provenance.operation.endsWith('-snapshot') ? { failedOperation: provenance.operation } : {}),
      operation: provenance.operation?.endsWith('-snapshot') ? provenance.operation : 'error-snapshot' } : {}) };
  if (timeoutEvidence) return { ...detail, type: 'timeout', timeoutEvidence };
  if (data.normalizationFailed) return { ...detail, type: 'error-snapshot-failed' };
  let m = message.match(/^([A-Za-z_$][\w$]*) is not defined$/);
  if (name === 'ReferenceError' && m) return { ...detail, type: 'missing-global', missing: m[1] };
  m = message.match(/Cannot read (?:properties|property) of undefined \(reading ['"]([^'"]+)['"]\)/);
  if (m) return { ...detail, type: 'missing-property', missing: m[1] };
  m = message.match(/([A-Za-z0-9_$\.]+) is not a function/);
  if (m) return { ...detail, type: 'missing-method', missing: m[1] };
  return { ...detail, type: 'runtime-error' };
}

function summarize(events, errors, addonResult, leakageCheck) {
  const missingGlobals = [], missingMethods = [], missingProperties = [], specialObjects = [], proxyRiskSignals = [];
  for (const e of errors) {
    if (e.type === 'missing-global') missingGlobals.push(e.missing);
    if (e.type === 'missing-method') missingMethods.push(e.missing);
    if (e.type === 'missing-property') missingProperties.push(e.missing);
  }
  for (const e of events) {
    if (e.path === 'document.all' || (e.path && e.path.startsWith('document.all.'))) specialObjects.push('document.all');
    if (['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'toPrimitive'].includes(e.type)) proxyRiskSignals.push(`${e.type}:${e.path || e.prop || ''}`);
    if (e.path && e.path.endsWith('.toString')) proxyRiskSignals.push(`toString:${e.path}`);
  }
  const uniq = a => [...new Set(a)].filter(Boolean);
  return {
    eventCount: events.length,
    missingGlobals: uniq(missingGlobals),
    missingMethods: uniq(missingMethods),
    missingProperties: uniq(missingProperties),
    specialObjects: uniq(specialObjects),
    nativeAddon: { available: !!(addonResult && addonResult.available), path: addonResult && addonResult.path || '', exports: addonResult && addonResult.exports || [] },
    nodeLeakage: leakageCheck || {},
    proxyRiskSignals: uniq(proxyRiskSignals).slice(0, 100),
    runtimeErrors: errors,
  };
}

let traceRunActive = false;
async function run(args) {
  if (traceRunActive) throw new Error('Concurrent Trace runs in one process are unsupported');
  if (!args.target) throw new Error('必须提供 --target');
  const targetFiles = args.target.split(',').map(s => s.trim()).filter(Boolean).map(p => path.resolve(p));
  for (const f of targetFiles) if (!fs.existsSync(f)) throw new Error(`目标 JS 文件不存在：${f}`);
  if (!Number.isInteger(args.timeout) || args.timeout <= 0) throw new TypeError('--timeout must be a positive integer');
  const fixture = readJson(args.fixture);
  const normalized = normalizeFixture(fixture, { ...(args.entry ? { entry: args.entry } : {}), ...(args.callArgs !== undefined ? { args: args.callArgs } : {}) });
  const defaultProvenance = {};
  const browserProvenance = Object.fromEntries(['userAgent','language','languages','platform','hardwareConcurrency','deviceMemory','webdriver','screen','devicePixelRatio'].map(key => [key, fixture.browser?.[key] == null ? 'unknown' : fixture.browserSources?.[key] || 'fixture-unspecified']));
  if (args.diagnosticDefaults) {
    fixture.browser ||= {};
    for (const [key, value] of Object.entries({ language: 'zh-CN', languages: ['zh-CN','zh'], platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8 })) {
      if (fixture.browser[key] == null) { fixture.browser[key] = value; defaultProvenance[key] = 'diagnostic-default'; browserProvenance[key] = 'diagnostic-default'; }
    }
  }
  const addonResult = { available: false, reason: 'Probe uses Realm-local JS fallback; native addon injection unsupported' };
  if (args.addon) throw new TypeError('Trace probe does not accept a host native addon; use a separately audited runtime adapter');
  const context = vm.createContext({}, { microtaskMode: 'afterEvaluate', name: 'web-js-env-patcher' });
  const errors = [];
  let entryResult;
  let entryFound = false;
  let activePhase = 'load';
  const transport = vm.runInContext(errorTransportSource(), context, { timeout: args.timeout });
  const promiseOrigins = new WeakMap();
  const toolErrors = new WeakSet();
  const vmTimeouts = new WeakMap();
  let currentExecution = null;
  function executeTarget(code, operation, filename, guarded = false) {
    const source = guarded ? `__traceErrorTransport.capture(() => (${code}))` : code;
    const script = new vm.Script(source, { filename, displayErrors: false });
    const previous = currentExecution;
    currentExecution = { source: 'target', phase: activePhase, operation };
    // Node's default exception decoration reads .stack outside the execution timeout.
    // Transport raw throws ourselves; never let decoration run a target Proxy/getter.
    const started = performance.now();
    let result;
    try { result = script.runInContext(context, { timeout: args.timeout, displayErrors: false }); }
    catch (error) {
      const data = hostErrorData(error);
      if (data.code === vmTimeoutCode && data.message === `Script execution timed out after ${args.timeout}ms`) {
        if (guarded || operation === 'bootstrap') vmTimeouts.set(error, 'vm-execution-boundary');
        // Loading an original script preserves its top-level bindings across files.
        // Node exposes no separate timeout marker for this unwrapped evaluation.
        else if (performance.now() - started >= args.timeout - 1) vmTimeouts.set(error, 'vm-signature-and-elapsed');
      }
      throw error;
    } finally { currentExecution = previous; }
    if (!guarded) return result;
    if (!result.ok) throw result.value;
    return result.value;
  }
  function ownToolError(message) {
    const error = new Error(message); toolErrors.add(error); return error;
  }
  function readTargetJson(code, operation, validate) {
    const json = executeTarget(code, operation, undefined, true);
    if (typeof json !== 'string') throw ownToolError(`${operation} must return a JSON string`);
    let data;
    try { data = JSON.parse(json); }
    catch (_) { throw ownToolError(`${operation} returned invalid JSON`); }
    if (!validate(data)) throw ownToolError(`${operation} returned an invalid payload`);
    return data;
  }
  function snapshotTargetError(error) {
    transport.raw = error;
    try { return { data: readTargetJson('__traceErrorTransport.encode(__traceErrorTransport.raw)', 'error-snapshot', isErrorPayload) }; }
    catch (snapshotError) {
      const timeoutEvidence = vmTimeouts.get(snapshotError);
      const data = timeoutEvidence ? hostErrorData(snapshotError) : { name: 'Error', message: 'Target exception snapshot failed' };
      return { data: { ...data, normalizationFailed: true }, timeoutEvidence };
    } finally { transport.raw = undefined; }
  }
  function recordError(error, provenance) {
    const own = toolErrors.has(error);
    const timeout = vmTimeouts.get(error);
    const { data, timeoutEvidence } = own || timeout
      ? { data: hostErrorData(error), timeoutEvidence: timeout }
      : snapshotTargetError(error);
    const detail = classifyError(data, own ? { ...provenance, source: 'tool' } : provenance, timeoutEvidence);
    errors.push(detail.source === 'tool' && detail.type !== 'timeout' ? { ...detail, type: 'probe-error' } : detail);
  }
  // Creation-time ownership never inspects the mutable Promise object/prototype.
  // Hooks and listeners exist only for this sequential run and its event checkpoints.
  const onUnhandled = (reason, promise) => {
    const origin = promiseOrigins.get(promise) || { source: 'unknown', phase: activePhase, operation: 'untracked-promise' };
    const { data, timeoutEvidence } = origin.source === 'target' ? snapshotTargetError(reason) : { data: hostErrorData(reason) };
    const detail = classifyError(data, { ...origin, ...(data.normalizationFailed ? { operation: 'rejection-snapshot', failedOperation: origin.operation } : {}) }, timeoutEvidence);
    errors.push(origin.source === 'tool' ? { ...detail, type: 'probe-error' }
      : ['timeout', 'error-snapshot-failed'].includes(detail.type) ? detail : { ...detail, type: 'unhandled-rejection' });
  };
  // V8's init-only hook records identity without enabling Node async-id stacks,
  // which can become unbalanced when vm timeout terminates a Promise callback.
  let stopHook;
  const checkpoint = () => new Promise(resolve => setImmediate(resolve));
  try {
    traceRunActive = true;
    stopHook = promiseHooks.createHook({
      init(promise) { promiseOrigins.set(promise, currentExecution || { source: 'tool', phase: activePhase, operation: 'tool-promise' }); },
    });
    process.on('unhandledRejection', onUnhandled);
    try { executeTarget(bootstrapSource(fixture), 'bootstrap', 'web-js-env-patcher-bootstrap.js'); }
    catch (err) { recordError(err, { source: 'tool', phase: 'bootstrap', operation: 'bootstrap' }); }
    for (const file of targetFiles) {
      let source;
      try { source = fs.readFileSync(file, 'utf8'); }
      catch (err) {
        errors.push({ ...classifyError(hostErrorData(err), { source: 'tool', phase: 'load', operation: 'read-target', file }), type: 'probe-error' });
        continue;
      }
      try {
        executeTarget(source, 'load-target', file);
      } catch (err) { recordError(err, { source: 'target', phase: 'load', operation: 'load-target', file }); }
    }
    await checkpoint();

    activePhase = 'entry';
    const entry = normalized.entry;
    if (entry) {
      try {
        const callCode = `__callEntry(${JSON.stringify(entry)}, ${JSON.stringify(JSON.stringify(normalized.args))})`;
        const callResult = readTargetJson(callCode, 'invoke-entry', isEntryPayload);
        entryFound = callResult.entryFound;
        entryResult = callResult.output;
        if (callResult.error) errors.push(classifyError(callResult.error, { source: 'target', phase: 'entry', operation: 'invoke-entry' }));
        else if (!entryFound) errors.push({ type: 'entry-not-found', name: 'EntryError', message: `入口不是函数或不存在：${entry}`, missing: entry });
        if (callResult.async) errors.push({ type: 'async-incomplete', message: 'Probe does not await Promise completion; use a runtime with a completion deadline' });
      } catch (err) { recordError(err, { source: vmTimeouts.has(err) ? 'target' : 'tool', phase: 'entry', operation: 'invoke-entry' }); }
    }
    await checkpoint();

    activePhase = 'probe';
    let events = [];
    let leakageCheck = {};
    try {
      events = readTargetJson('__dumpEvents()', 'dump-events', isEventPayload);
    } catch (err) { recordError(err, { source: 'tool', phase: 'probe', operation: 'dump-events' }); }
    try { leakageCheck = readTargetJson('__leakageCheck()', 'leakage-check', isLeakagePayload); }
    catch (err) { recordError(err, { source: 'tool', phase: 'probe', operation: 'leakage-check' }); }
    await checkpoint();

    for (const event of events) if (event.type === 'async-target-error') errors.push(classifyError(event));
    if (!entry) errors.push({ type: 'entry-unspecified', message: 'No invocation entry selected; loading alone is not target completion' });
    if (!normalized.argsKnown) errors.push({ type: 'input-unknown', message: 'fixture.input is unknown; fill [] for a no-argument entry' });
    const status = errors.some(e => ['probe-error','native-addon-error'].includes(e.type)) ? 'execution-failed'
      : errors.some(e => e.type === 'timeout') ? 'timed-out'
      : errors.some(e => !['entry-not-found','entry-unspecified','async-incomplete','input-unknown'].includes(e.type)) ? 'target-failed'
      : errors.length ? 'insufficient-evidence' : 'passed';
    const output = { traceProtocolVersion: 'env-trace-cli/v2', mode: args.strict ? 'strict' : 'diagnostic', status, websiteAccepted: null,
      entry, entryFound, output: entryResult, errors, configuration: { browserSources: browserProvenance, diagnosticDefaults: defaultProvenance } };
    const summary = { ...summarize(events, errors, addonResult, leakageCheck), status, websiteAccepted: null };
    if (args.trace) { ensureParent(args.trace); fs.writeFileSync(args.trace, events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''), 'utf8'); }
    if (args.summary) { ensureParent(args.summary); fs.writeFileSync(args.summary, JSON.stringify(summary, null, 2) + '\n', 'utf8'); }
    if (args.output) { ensureParent(args.output); fs.writeFileSync(args.output, JSON.stringify(output, null, 2) + '\n', 'utf8'); }
    return { targetFiles, fixture: args.fixture || '', trace: args.trace || '', summaryFile: args.summary || '', outputFile: args.output || '', output, summary };
  } finally { process.removeListener('unhandledRejection', onUnhandled); stopHook?.(); traceRunActive = false; }
}

function renderMarkdown(result) {
  const lines = [];
  lines.push('# Node.js 缺失环境追踪结果');
  lines.push('');
  lines.push(`- 目标 JS：${result.targetFiles.join(', ')}`);
  lines.push(`- fixture：${result.fixture || '未提供'}`);
  lines.push(`- 入口函数：${result.output.entry || '未指定'}`);
  lines.push(`- 入口是否找到：${result.output.entry ? (result.output.entryFound ? '是' : '否') : '未指定'}`);
  lines.push(`- trace 文件：${result.trace || '未写入'}`);
  lines.push(`- 摘要文件：${result.summaryFile || '未写入'}`);
  lines.push(`- 输出文件：${result.outputFile || '未写入'}`);
  lines.push(`- native addon：${result.summary.nativeAddon.available ? '可用' : '不可用或未启用'}`);
  lines.push(`- trace 事件数量：${result.summary.eventCount}`);
  lines.push(`- 运行状态：${result.output.status}`);
  lines.push(`- 运行错误数量：${result.summary.runtimeErrors.length}`);
  if (result.summary.nodeLeakage && Object.keys(result.summary.nodeLeakage).length) {
    lines.push('');
    lines.push('## Node 泄露自检');
    for (const [k, v] of Object.entries(result.summary.nodeLeakage)) lines.push(`- ${k}：${v}`);
  }
  if (result.summary.runtimeErrors.length) {
    lines.push('');
    lines.push('## 运行错误');
    for (const e of result.summary.runtimeErrors) lines.push(`- ${e.type}：${e.message}`);
  }
  if (result.summary.proxyRiskSignals.length) {
    lines.push('');
    lines.push('## Proxy 检测风险信号');
    for (const e of result.summary.proxyRiskSignals.slice(0, 20)) lines.push(`- ${e}`);
  }
  return lines.join('\n') + '\n';
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    // In Node's strict mode the exception fires before unhandledRejection.
    // Keep the policy local to CLI work and leave the importer's process alone.
    const worker = new Worker(__filename, {
      workerData: { traceCliArgs: args },
      execArgv: ['--unhandled-rejections=throw'],
    });
    worker.once('message', ({ result, error }) => {
      if (error) reject(Object.assign(new Error(error.message), error));
      else resolve(result);
    });
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`Trace worker exited before reporting a result (code ${code})`)));
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    const result = await runCli(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exitCode = result.output.status === 'execution-failed' ? 2 : args.strict && result.output.status !== 'passed' ? 1 : 0;
  } catch (err) {
    const detail = hostErrorData(err);
    const output = { traceProtocolVersion: 'env-trace-cli/v2', status: 'execution-failed', websiteAccepted: null, entryFound: false,
      errors: [{ type: detail.code === 'ERR_FIXTURE' || detail.name === 'SyntaxError' ? 'invalid-fixture' : 'tool-error', ...detail }] };
    const summary = { status: output.status, websiteAccepted: null, runtimeErrors: output.errors };
    for (const [flag, data] of [['--output', output], ['--summary', summary]]) {
      const index = process.argv.lastIndexOf(flag);
      const file = index < 0 ? '' : process.argv[index + 1];
      if (file) {
        try { ensureParent(file); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); } catch {}
      }
    }
    if (process.argv.includes('--json')) console.log(JSON.stringify({ output, summary }));
    console.error(detail.message);
    console.error(usage());
    process.exitCode = 2;
  }
}
if (require.main === module) {
  if (!isMainThread && workerData?.traceCliArgs) {
    run(workerData.traceCliArgs).then(
      result => parentPort.postMessage({ result }),
      error => parentPort.postMessage({ error: hostErrorData(error) }),
    );
  } else {
    main();
  }
}
module.exports = { run };
