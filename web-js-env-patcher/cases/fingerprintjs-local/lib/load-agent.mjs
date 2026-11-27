'use strict';

/**
 * FingerprintJS local harness — SDK must load in the jsdom PAGE Realm
 * (inline <script>), not via Node createRequire + host globals.
 */

import fs from 'node:fs';
import path from 'node:path';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import {
  snapshotHostGlobals,
  installIframeRealmProbe,
  collapseE09Report,
  collapseE09ObjectOnly,
} from './e09-iframe-realm.mjs';

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function installCanvasStub(window) {
  const proto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
  if (!proto) return;
  proto.getContext = function getContext(type) {
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
      return null;
    }
    return {
      canvas: this,
      fillStyle: '',
      fillRect() {},
      fillText() {},
      measureText() {
        return { width: 0 };
      },
      beginPath() {},
      arc() {},
      closePath() {},
      fill() {},
      stroke() {},
      rect() {},
      isPointInPath() {
        return false;
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
      getImageData() {
        return { data: new Uint8ClampedArray(4) };
      },
    };
  };
}

/** Minimal matchMedia for declared media-query component contracts. */
function installMatchMedia(window) {
  window.matchMedia = function matchMedia(query) {
    return {
      matches: false,
      media: String(query),
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
  };
}

function summarizeComponents(components) {
  if (!components || typeof components !== 'object') {
    return { names: null, details: null, errors: [] };
  }
  const names = Object.keys(components).sort();
  const details = {};
  const errors = [];
  for (const name of names) {
    const entry = components[name];
    if (entry && entry.error != null) {
      const err = entry.error;
      const message =
        err && typeof err === 'object' && err.message != null
          ? String(err.message)
          : String(err);
      const errName =
        err && typeof err === 'object' && err.name != null ? String(err.name) : 'Error';
      details[name] = { status: 'error', error: { name: errName, message } };
      errors.push({ component: name, name: errName, message });
    } else {
      details[name] = {
        status: 'ok',
        hasValue: !!(entry && Object.prototype.hasOwnProperty.call(entry, 'value')),
      };
    }
  }
  return { names, details, errors };
}

function realmProbe(fn, window) {
  if (typeof fn !== 'function') {
    return { inPageRealm: false, inHostRealm: false, reason: 'not-a-function' };
  }
  return {
    inPageRealm: fn instanceof window.Function,
    inHostRealm: fn instanceof Function,
    ctorName: fn.constructor && fn.constructor.name,
  };
}

function attachE09(out, iframeProbe, hostBefore, fault) {
  let e09 = iframeProbe ? iframeProbe.getReport() : {
    iframeCreateCount: 0,
    sampleCount: 0,
    capturedCount: 0,
    functionDistinctCount: 0,
    objectDistinctCount: 0,
    distinctRealmCount: 0,
    samples: [],
    childDistinctFromPage: false,
    functionDistinctFromPage: false,
    objectDistinctFromPage: false,
  };
  if (fault === 'e09-collapse' && out.completionReached) {
    e09 = collapseE09Report(e09);
    if (!(e09.iframeCreateCount >= 1) && iframeProbe) {
      e09.iframeCreateCount = Math.max(1, iframeProbe.getReport().iframeCreateCount || 1);
    }
  }
  if (fault === 'e09-object-collapse' && out.completionReached) {
    e09 = collapseE09ObjectOnly(e09);
  }
  out.iframeCreateCount = e09.iframeCreateCount;
  out.e09 = e09;
  out.host = { before: hostBefore, after: snapshotHostGlobals() };
  return out;
}

function resolveScriptPath(opts) {
  if (opts.scriptPath) return opts.scriptPath;
  if (opts.distUmd && fs.existsSync(opts.distUmd)) return opts.distUmd;
  if (opts.distCjs) {
    const umdSibling = opts.distCjs.replace(/fp\.cjs\.js$/, 'fp.umd.js');
    if (umdSibling !== opts.distCjs && fs.existsSync(umdSibling)) return umdSibling;
    // Fake wrong-version dir may only have browser stub name.
    const fakeUmd = path.join(path.dirname(opts.distCjs), 'fp.umd.js');
    if (fs.existsSync(fakeUmd)) return fakeUmd;
  }
  return opts.distCjs;
}

/**
 * @param {object} opts
 * @param {string} [opts.distCjs]
 * @param {string} [opts.distUmd]
 * @param {string} [opts.scriptPath]
 * @param {string} [opts.fakeDistDir]
 * @param {'baseline'|'wrong-prototype'|'wrong-resource-version'|'incomplete-callback'|'missing-matchMedia'|'host-require-realm'|'e09-collapse'|'e09-object-collapse'} [opts.fault]
 * @param {number} [opts.timeoutMs]
 */
export async function runFingerprintCase(opts) {
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const fault = opts.fault || 'baseline';
  const timeoutMs = opts.timeoutMs || 8000;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {
    /* swallow residual not-implemented noise */
  });

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.local/fingerprintjs-case',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    virtualConsole,
  });
  const { window } = dom;

  const cleanup = () => {
    try {
      dom.window.close();
    } catch {
      /* ignore */
    }
  };

  // Page-Realm host shims required by SDK event-loop / media sources.
  window.MessageChannel = NodeMessageChannel;
  installCanvasStub(window);
  if (fault !== 'missing-matchMedia') {
    installMatchMedia(window);
  }

  const hostBefore = snapshotHostGlobals();
  const iframeProbe = installIframeRealmProbe(window);

  if (fault === 'wrong-prototype') {
    const broken = Object.create(null);
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      enumerable: true,
      get() {
        return broken;
      },
    });
  }

  let scriptPath = resolveScriptPath(opts);
  if (fault === 'wrong-resource-version') {
    if (!opts.fakeDistDir) {
      cleanup();
      throw new Error('wrong-resource-version requires fakeDistDir');
    }
    scriptPath = path.join(opts.fakeDistDir, 'fp.umd.js');
  }

  if (fault === 'incomplete-callback') {
    const out = attachE09(
      {
        loadedVersion: null,
        result: null,
        completionReached: false,
        error: null,
        mode: fault,
        websiteAccepted: false,
        loadPath: 'page-script',
        realm: { load: null, get: null },
        componentErrors: [],
      },
      iframeProbe,
      hostBefore,
      fault
    );
    cleanup();
    return out;
  }

  if (!scriptPath || !fs.existsSync(scriptPath)) {
    cleanup();
    throw new Error(`script not found: ${scriptPath}`);
  }

  // Anti-example: deliberately load in Node host Realm (forbidden default path).
  if (fault === 'host-require-realm') {
    const { createRequire } = await import('node:module');
    const cjsPath = opts.distCjs || scriptPath.replace(/fp\.umd\.js$/, 'fp.cjs.js');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
    Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
    try {
      const require = createRequire(cjsPath);
      const resolved = require.resolve(cjsPath);
      delete require.cache[resolved];
      const mod = require(cjsPath);
      const load = mod.load;
      const realmLoad = realmProbe(load, window);
      const agent = await withTimeout(load({ monitoring: false }), timeoutMs, 'FingerprintJS.load');
      const realmGet = realmProbe(agent.get, window);
      const result = await withTimeout(agent.get(), timeoutMs, 'FingerprintJS.get');
      const summary = summarizeComponents(result.components);
      return attachE09(
        {
          loadedVersion: result.version != null ? String(result.version) : null,
          result: {
            visitorId: result.visitorId,
            version: result.version != null ? String(result.version) : null,
            components: summary.names,
            componentDetails: summary.details,
            componentCount: summary.names ? summary.names.length : 0,
          },
          completionReached: true,
          error: null,
          mode: fault,
          websiteAccepted: false,
          loadPath: 'host-require',
          realm: { load: realmLoad, get: realmGet },
          componentErrors: summary.errors,
        },
        iframeProbe,
        hostBefore,
        fault
      );
    } catch (err) {
      return attachE09(
        {
          loadedVersion: null,
          result: null,
          completionReached: false,
          error: err && err.message ? err.message : String(err),
          mode: fault,
          websiteAccepted: false,
          loadPath: 'host-require',
          realm: { load: null, get: null },
          componentErrors: [],
        },
        iframeProbe,
        hostBefore,
        fault
      );
    } finally {
      for (const key of ['window', 'document', 'navigator', 'self']) {
        try {
          delete globalThis[key];
        } catch {
          /* ignore */
        }
      }
      cleanup();
    }
  }

  // Default: page-Realm script load (unique correct path). Also serves e09-collapse.
  let load;
  try {
    const code = fs.readFileSync(scriptPath, 'utf8');
    const script = window.document.createElement('script');
    script.textContent = code;
    window.document.body.appendChild(script);
    const api = window.FingerprintJS;
    load = api && typeof api.load === 'function' ? api.load : null;
    if (!load && api && api.default && typeof api.default.load === 'function') {
      load = api.default.load;
    }
  } catch (err) {
    const out = attachE09(
      {
        loadedVersion: null,
        result: null,
        completionReached: false,
        error: err && err.message ? err.message : String(err),
        mode: fault,
        websiteAccepted: false,
        loadPath: 'page-script',
        realm: { load: null, get: null },
        componentErrors: [],
      },
      iframeProbe,
      hostBefore,
      fault
    );
    cleanup();
    return out;
  }

  if (!load) {
    const out = attachE09(
      {
        loadedVersion: null,
        result: null,
        completionReached: false,
        error: 'FingerprintJS.load missing after page script',
        mode: fault,
        websiteAccepted: false,
        loadPath: 'page-script',
        realm: { load: null, get: null },
        componentErrors: [],
      },
      iframeProbe,
      hostBefore,
      fault
    );
    cleanup();
    return out;
  }

  const realmLoad = realmProbe(load, window);

  try {
    const agent = await withTimeout(load({ monitoring: false }), timeoutMs, 'FingerprintJS.load');
    const realmGet = realmProbe(agent.get, window);
    const result = await withTimeout(agent.get(), timeoutMs, 'FingerprintJS.get');
    const loadedVersion =
      result && result.version != null
        ? String(result.version)
        : agent && agent.version != null
          ? String(agent.version)
          : null;
    const summary = summarizeComponents(result && result.components);
    return attachE09(
      {
        loadedVersion,
        result: {
          visitorId: result && result.visitorId,
          version: loadedVersion,
          components: summary.names,
          componentDetails: summary.details,
          componentCount: summary.names ? summary.names.length : 0,
        },
        completionReached: true,
        error: null,
        mode: fault,
        websiteAccepted: false,
        loadPath: 'page-script',
        realm: { load: realmLoad, get: realmGet },
        componentErrors: summary.errors,
      },
      iframeProbe,
      hostBefore,
      fault
    );
  } catch (err) {
    return attachE09(
      {
        loadedVersion: null,
        result: null,
        completionReached: false,
        error: err && err.message ? err.message : String(err),
        mode: fault,
        websiteAccepted: false,
        loadPath: 'page-script',
        realm: { load: realmLoad, get: null },
        componentErrors: [],
      },
      iframeProbe,
      hostBefore,
      fault
    );
  } finally {
    cleanup();
  }
}

/** Browser-global stub (page script) with wrong version — also writes cjs twin. */
export function writeFakeWrongVersionDist(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const umd = `(function (root, factory) {
  root.FingerprintJS = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  return {
    load: async function load() {
      return {
        version: '9.9.9',
        get: async function get() {
          return { visitorId: 'fake', version: '9.9.9', components: { x: { value: 1 } } };
        }
      };
    }
  };
});
`;
  fs.writeFileSync(path.join(dir, 'fp.umd.js'), umd);
  const cjs = `'use strict';
exports.load = async function load() {
  return {
    version: '9.9.9',
    get: async function get() {
      return { visitorId: 'fake', version: '9.9.9', components: { x: { value: 1 } } };
    }
  };
};
`;
  fs.writeFileSync(path.join(dir, 'fp.cjs.js'), cjs);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'fake-fp', version: '9.9.9' }, null, 2)}\n`
  );
  return path.join(dir, 'fp.umd.js');
}
