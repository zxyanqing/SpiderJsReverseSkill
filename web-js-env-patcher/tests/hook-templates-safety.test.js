'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { build } = require('../scripts/generate_hook_templates');

const CONTROL_NAME = '__webJsEnvHookControl';
const DEBUG_PREFIX = '__webJsEnv';

function gen(types, opts = {}) {
  return build({
    param: 'sign',
    apiPattern: '/api/',
    types: Array.isArray(types) ? types.join(',') : types,
    debugger: !!opts.debugger,
  });
}

function debugOwnNames(window) {
  return Object.getOwnPropertyNames(window).filter(
    (n) => n === CONTROL_NAME || n.startsWith(DEBUG_PREFIX)
  );
}

function countHits(infos, kindSubstr) {
  return infos.filter((row) => JSON.stringify(row).includes(kindSubstr)).length;
}

function snapshotKeys(fn) {
  return Reflect.ownKeys(fn).map(String).sort();
}

function loadHooks(code, { withFetch = false } = {}) {
  const html = '<!doctype html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const infos = [];
  window.console.info = (...args) => { infos.push(args); };
  window.console.log = (...args) => { infos.push(['log', ...args]); };
  if (withFetch) {
    window.fetch = async () => ({ ok: true });
  }
  const control = window.eval(code);
  return { window, dom, infos, control };
}

test('T-G6: missing fetch stays missing after install', () => {
  const code = gen('fetch,cookie');
  const { window, dom, control } = loadHooks(code, { withFetch: false });
  assert.equal(typeof control.uninstall, 'function');
  assert.equal(typeof window.fetch, 'undefined');
  assert.equal('fetch' in window, false);
  assert.equal(CONTROL_NAME in window, false);
  assert.deepEqual(debugOwnNames(window), []);
  dom.window.close();
});

test('T-G6: existing fetch is wrapped; default logs have no raw secrets', () => {
  const code = gen('fetch,cookie,xhr,storage,postmessage');
  assert.equal(/\bdebugger;/.test(code), false);
  const { window, dom, infos, control } = loadHooks(code, { withFetch: true });
  assert.equal(typeof window.fetch, 'function');
  assert.equal(CONTROL_NAME in window, false);
  return window.fetch('/api/x?sign=1', { body: 'token=SECRET_RAW_VALUE_XYZ' }).then(() => {
    window.document.cookie = 'sign=SECRET_COOKIE_VALUE_ABC; path=/';
    const blob = JSON.stringify(infos);
    assert.equal(blob.includes('SECRET_RAW_VALUE_XYZ'), false);
    assert.equal(blob.includes('SECRET_COOKIE_VALUE_ABC'), false);
    assert.ok(infos.length >= 1, 'expected summary hits');
    for (const row of infos) {
      const text = JSON.stringify(row);
      assert.equal(/SECRET_/.test(text), false);
    }
    const own = Object.getOwnPropertyNames(window.document).filter((n) => n.startsWith('__reverse_'));
    assert.deepEqual(own, []);
    control.uninstall();
    assert.equal(CONTROL_NAME in window, false);
    assert.deepEqual(debugOwnNames(window), []);
    dom.window.close();
  });
});

test('T-G6: uninstall keeps page rewrite after hook install', () => {
  const code = gen('fetch');
  const { window, dom, control } = loadHooks(code, { withFetch: true });
  const pageFn = function pageFetch() { return 'page'; };
  window.fetch = pageFn;
  control.uninstall();
  assert.equal(window.fetch, pageFn);
  assert.equal(CONTROL_NAME in window, false);
  assert.deepEqual(debugOwnNames(window), []);
  dom.window.close();
});

test('T-G6: no __reverse_* own fields on XHR after hooks', () => {
  const code = gen('xhr');
  const { window, dom, control } = loadHooks(code, { withFetch: false });
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', '/api/sign');
  const own = Object.getOwnPropertyNames(xhr).filter((n) => n.startsWith('__reverse_'));
  assert.deepEqual(own, []);
  control.uninstall();
  assert.equal(CONTROL_NAME in window, false);
  dom.window.close();
});

test('T-G6: non-configurable descriptor is skipped', () => {
  const code = gen('fetch');
  const html = '<!doctype html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const raw = function lockedFetch() { return 1; };
  Object.defineProperty(window, 'fetch', {
    configurable: false,
    writable: false,
    enumerable: true,
    value: raw,
  });
  const control = window.eval(code);
  assert.equal(window.fetch, raw);
  assert.equal(CONTROL_NAME in window, false);
  assert.equal(typeof control.uninstall, 'function');
  dom.window.close();
});

test('T-G6: repeated install does not double-wrap (raw + diagnostic once)', () => {
  const code = gen('fetch');
  const html = '<!doctype html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const infos = [];
  window.console.info = (...args) => { infos.push(args); };
  let rawCalls = 0;
  window.fetch = async function rawFetch() {
    rawCalls += 1;
    return { ok: true };
  };
  const control = window.eval(code);
  assert.equal(CONTROL_NAME in window, false);

  return window.fetch('/api/x').then(() => {
    assert.equal(rawCalls, 1);
    assert.equal(countHits(infos, '"kind":"fetch"'), 1);
    control.install();
    control.install();
    infos.length = 0;
    return window.fetch('/api/y').then(() => {
      assert.equal(rawCalls, 2, 'one raw call per fetch');
      assert.equal(countHits(infos, '"kind":"fetch"'), 1, 'one diagnostic hit per fetch');
      control.uninstall();
      assert.deepEqual(debugOwnNames(window), []);
      dom.window.close();
    });
  });
});

test('T-G6: window has no control field after install or uninstall', () => {
  const code = gen('fetch,cookie');
  assert.equal(code.includes('__webJsEnvHookControl'), false);
  const { window, dom, control } = loadHooks(code, { withFetch: true });
  assert.equal(CONTROL_NAME in window, false);
  assert.deepEqual(debugOwnNames(window), []);
  control.uninstall();
  assert.equal(CONTROL_NAME in window, false);
  assert.deepEqual(debugOwnNames(window), []);
  dom.window.close();
});

test('T-G6: C2-G6-1 Function/WebSocket leave no mark; same control reinstalls', () => {
  const code = gen('dynamic-code,websocket');
  assert.equal(code.includes('Symbol.for("webJsEnvHook.wrapped")'), false);
  assert.equal(code.includes('__webJsEnvHookWrapped__'), false);

  const html = '<!doctype html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const infos = [];
  window.console.info = (...args) => { infos.push(args); };

  const OriginalFunction = window.Function;
  let rawWsCalls = 0;
  function SynthWS(url) {
    rawWsCalls += 1;
    this.url = String(url || '');
  }
  window.WebSocket = SynthWS;

  const keysFnBefore = snapshotKeys(window.Function);
  const keysWsBefore = snapshotKeys(window.WebSocket);
  const descFnBefore = Object.getOwnPropertyDescriptor(window, 'Function');
  const descWsBefore = Object.getOwnPropertyDescriptor(window, 'WebSocket');

  const control = window.eval(code);
  assert.equal(CONTROL_NAME in window, false);

  infos.length = 0;
  const fn1 = window.Function('return 42');
  assert.equal(fn1(), 42);
  assert.equal(countHits(infos, '"kind":"Function"'), 1);
  infos.length = 0;
  // eslint-disable-next-line no-new
  new window.WebSocket('ws://example.test/synth');
  assert.equal(rawWsCalls, 1);
  assert.equal(countHits(infos, '"kind":"WebSocket"'), 1);

  control.uninstall();

  const keysFnAfter = snapshotKeys(window.Function);
  const keysWsAfter = snapshotKeys(window.WebSocket);
  assert.deepEqual(keysFnAfter, keysFnBefore, 'Function ownKeys must match pre-install');
  assert.deepEqual(keysWsAfter, keysWsBefore, 'WebSocket ownKeys must match pre-install');
  assert.equal(
    Object.getOwnPropertyDescriptor(window, 'Function').value,
    descFnBefore.value
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(window, 'WebSocket').value,
    descWsBefore.value
  );
  assert.ok(
    !keysFnAfter.some((k) => k.includes('webJsEnvHook')),
    'no diagnostic mark on Function'
  );
  assert.ok(
    !keysWsAfter.some((k) => k.includes('webJsEnvHook')),
    'no diagnostic mark on WebSocket'
  );

  // Same control: reinstall must wrap again
  control.install();
  infos.length = 0;
  rawWsCalls = 0;
  const fn2 = window.Function('return 42');
  assert.equal(fn2(), 42);
  assert.equal(countHits(infos, '"kind":"Function"'), 1, 'Function diagnostic after reinstall');
  infos.length = 0;
  // eslint-disable-next-line no-new
  new window.WebSocket('ws://example.test/synth2');
  assert.equal(rawWsCalls, 1, 'WebSocket raw ctor once after reinstall');
  assert.equal(countHits(infos, '"kind":"WebSocket"'), 1, 'WebSocket diagnostic after reinstall');

  // Double install without stacking: one raw + one hit
  control.install();
  control.install();
  infos.length = 0;
  rawWsCalls = 0;
  // eslint-disable-next-line no-new
  new window.WebSocket('ws://example.test/synth3');
  assert.equal(rawWsCalls, 1);
  assert.equal(countHits(infos, '"kind":"WebSocket"'), 1);

  control.uninstall();
  assert.deepEqual(snapshotKeys(window.Function), keysFnBefore);
  assert.deepEqual(snapshotKeys(window.WebSocket), keysWsBefore);
  assert.equal(OriginalFunction, window.Function);
  dom.window.close();
});

test('T-G6: --debugger emits debugger; default does not', () => {
  const off = gen('cookie');
  const on = gen('cookie', { debugger: true });
  assert.equal(/\bdebugger;/.test(off), false);
  assert.equal(/\bdebugger;/.test(on), true);
});
