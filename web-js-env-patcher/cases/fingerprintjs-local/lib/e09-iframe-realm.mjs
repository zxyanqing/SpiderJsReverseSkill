'use strict';

/**
 * Minimal E09 probes for fingerprintjs-local (page Realm path):
 * - iframe creation observable
 * - child Frame Function AND object/prototype Realm ≠ page Frame ≠ Node host
 * - objectProtoDistinct compares page-Realm vs child-Frame objects (never module-host `{}`)
 * - host globalThis not polluted by page window bindings
 */

function isFunctionRealmDistinct(s) {
  return !!(
    s &&
    s.pageFnDistinctFromChild &&
    s.childFnInChild &&
    !s.childFnInPage &&
    !s.childFnInHost &&
    s.pageFnInPage &&
    !s.pageFnInChild &&
    !s.pageFnInHost
  );
}

/**
 * True only when a page-Realm object's prototype differs from a child-Frame object's.
 * Both objects MUST be created in their respective Realms (window.eval / cw.eval).
 */
export function computeObjectProtoDistinct(pageWindow, childWindow) {
  const pageObj = pageWindow.eval('({})');
  const childObj = childWindow.eval('({})');
  return Object.getPrototypeOf(pageObj) !== Object.getPrototypeOf(childObj);
}

function isObjectRealmDistinct(s) {
  return !!(s && s.objectProtoDistinct === true);
}

/** Sample is fully distinct only when BOTH function and object/prototype realms differ. */
function isFullyDistinctSample(s) {
  return isFunctionRealmDistinct(s) && isObjectRealmDistinct(s);
}

export function snapshotHostGlobals() {
  const hasNavigator = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  let navigatorId = null;
  if (hasNavigator && globalThis.navigator && typeof globalThis.navigator === 'object') {
    // Stable, JSON-safe identity hint (avoid live object refs that break after JSON round-trip).
    navigatorId = `ua:${String(globalThis.navigator.userAgent || '')}|lang:${String(globalThis.navigator.language || '')}`;
  } else if (hasNavigator) {
    navigatorId = `type:${typeof globalThis.navigator}`;
  }
  return {
    hasWindow: Object.prototype.hasOwnProperty.call(globalThis, 'window'),
    hasDocument: Object.prototype.hasOwnProperty.call(globalThis, 'document'),
    hasNavigator,
    navigatorId,
    windowIsObject:
      Object.prototype.hasOwnProperty.call(globalThis, 'window') &&
      globalThis.window != null &&
      typeof globalThis.window === 'object',
  };
}

/**
 * Install createElement / attach hooks; call getReport() after SDK activity.
 * @param {Window} window
 */
export function installIframeRealmProbe(window) {
  const samples = [];
  let createCount = 0;
  const origCreate = window.document.createElement.bind(window.document);

  function capture(el) {
    try {
      const cw = el.contentWindow;
      if (!cw) {
        samples.push({ captured: false, reason: 'no-contentWindow' });
        return;
      }
      const childFn = cw.eval('(function () { return function __e09Child() {} })()');
      const pageFn = window.eval('(function () { return function __e09Page() {} })()');
      samples.push({
        captured: true,
        pageFnDistinctFromChild: window.Function !== cw.Function,
        childFnInChild: childFn instanceof cw.Function,
        childFnInPage: childFn instanceof window.Function,
        childFnInHost: childFn instanceof Function,
        pageFnInPage: pageFn instanceof window.Function,
        pageFnInChild: pageFn instanceof cw.Function,
        pageFnInHost: pageFn instanceof Function,
        // H1: page Realm vs child Frame (never module-host `{}`).
        objectProtoDistinct: computeObjectProtoDistinct(window, cw),
      });
    } catch (err) {
      samples.push({
        captured: false,
        reason: err && err.message ? String(err.message) : String(err),
      });
    }
  }

  function onIframe(el) {
    createCount += 1;
    const tryCapture = () => {
      if (el.contentWindow) capture(el);
    };
    tryCapture();
    const mo = new window.MutationObserver(() => {
      if (el.isConnected) tryCapture();
    });
    try {
      mo.observe(window.document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
    const origSetAttr = el.setAttribute.bind(el);
    el.setAttribute = function setAttribute(name, value) {
      const ret = origSetAttr(name, value);
      tryCapture();
      return ret;
    };
    queueMicrotask(tryCapture);
    setTimeout(() => {
      tryCapture();
      try {
        mo.disconnect();
      } catch {
        /* ignore */
      }
    }, 0);
  }

  window.document.createElement = function createElement(tagName, ...rest) {
    const el = origCreate(tagName, ...rest);
    if (String(tagName).toLowerCase() === 'iframe') onIframe(el);
    return el;
  };

  return {
    getReport() {
      const okSamples = samples.filter((s) => s.captured);
      const functionDistinct = okSamples.filter(isFunctionRealmDistinct);
      const objectDistinct = okSamples.filter(isObjectRealmDistinct);
      const distinct = okSamples.filter(isFullyDistinctSample);
      return {
        iframeCreateCount: createCount,
        sampleCount: samples.length,
        capturedCount: okSamples.length,
        functionDistinctCount: functionDistinct.length,
        objectDistinctCount: objectDistinct.length,
        distinctRealmCount: distinct.length,
        samples: samples.slice(),
        /** @deprecated alias: full (function∧object) distinct */
        childDistinctFromPage: distinct.length > 0,
        functionDistinctFromPage: functionDistinct.length > 0,
        objectDistinctFromPage: objectDistinct.length > 0,
      };
    },
  };
}

/**
 * Evaluate E09 contract for observeConsumer.
 * @param {object} e09
 * @param {object} [host]
 * @param {string} [loadPath]
 */
export function evaluateE09Problems(e09, host, loadPath) {
  const problems = [];
  if (!e09 || typeof e09 !== 'object') {
    problems.push({ code: 'e09-evidence-missing', detail: 'no E09 iframe/realm report' });
    return problems;
  }
  if (!(e09.iframeCreateCount >= 1)) {
    problems.push({
      code: 'e09-iframe-missing',
      detail: `expected iframe creation, got count=${e09.iframeCreateCount}`,
    });
  }

  const functionOk =
    e09.functionDistinctFromPage === true ||
    (e09.functionDistinctCount != null && e09.functionDistinctCount >= 1);
  const objectOk =
    e09.objectDistinctFromPage === true ||
    (e09.objectDistinctCount != null && e09.objectDistinctCount >= 1);
  // Full distinct: prefer explicit flags; fall back to childDistinctFromPage (now AND of both).
  const fullOk =
    e09.childDistinctFromPage === true ||
    (e09.distinctRealmCount != null && e09.distinctRealmCount >= 1);

  if (!functionOk) {
    problems.push({
      code: 'e09-realm-not-distinct',
      detail: 'child Frame Function Realm not distinguished from page/host',
    });
  }
  if (!objectOk) {
    problems.push({
      code: 'e09-object-realm-not-distinct',
      detail: 'child Frame object/prototype Realm not distinguished from page (objectProtoDistinct)',
    });
  }
  // If flags inconsistent (e.g. both function+object ok but full flag false), still fail full.
  if (functionOk && objectOk && !fullOk) {
    problems.push({
      code: 'e09-realm-not-distinct',
      detail: 'function+object samples present but childDistinctFromPage/distinctRealmCount not set',
    });
  }

  if (loadPath === 'page-script' && host && host.after && host.before) {
    const before = host.before;
    const after = host.after;
    if (!before.hasWindow && after.hasWindow) {
      problems.push({
        code: 'e09-host-polluted',
        detail: 'page-script path left globalThis.window after cleanup',
      });
    }
    if (!before.hasDocument && after.hasDocument) {
      problems.push({
        code: 'e09-host-polluted',
        detail: 'page-script path left globalThis.document after cleanup',
      });
    }
    // G3: navigator is a first-class pollution signal (same gate as window/document).
    if (!before.hasNavigator && after.hasNavigator) {
      problems.push({
        code: 'e09-host-polluted',
        detail: 'page-script path left globalThis.navigator after cleanup',
      });
    } else if (
      before.hasNavigator &&
      after.hasNavigator &&
      before.navigatorId != null &&
      after.navigatorId != null &&
      before.navigatorId !== after.navigatorId
    ) {
      problems.push({
        code: 'e09-host-polluted',
        detail: 'page-script path replaced globalThis.navigator binding',
      });
    }
  }
  return problems;
}

/** Failure injection: collapse all realm evidence (functions + objects). */
export function collapseE09Report(e09) {
  return {
    ...e09,
    childDistinctFromPage: false,
    functionDistinctFromPage: false,
    objectDistinctFromPage: false,
    functionDistinctCount: 0,
    objectDistinctCount: 0,
    distinctRealmCount: 0,
    samples: [
      {
        captured: true,
        pageFnDistinctFromChild: false,
        childFnInChild: false,
        childFnInPage: true,
        childFnInHost: false,
        pageFnInPage: true,
        pageFnInChild: true,
        pageFnInHost: false,
        objectProtoDistinct: false,
        injected: 'e09-collapse',
      },
    ],
    collapsed: true,
  };
}

/**
 * Failure injection (G1): function Realm fields all correct, ONLY object/prototype fails.
 * Observer must ok=false via e09-object-realm-not-distinct.
 */
export function collapseE09ObjectOnly(e09) {
  const baseCount = Math.max(1, e09 && e09.iframeCreateCount ? e09.iframeCreateCount : 1);
  return {
    ...e09,
    iframeCreateCount: baseCount,
    childDistinctFromPage: false,
    functionDistinctFromPage: true,
    objectDistinctFromPage: false,
    functionDistinctCount: 1,
    objectDistinctCount: 0,
    distinctRealmCount: 0,
    samples: [
      {
        captured: true,
        pageFnDistinctFromChild: true,
        childFnInChild: true,
        childFnInPage: false,
        childFnInHost: false,
        pageFnInPage: true,
        pageFnInChild: false,
        pageFnInHost: false,
        objectProtoDistinct: false,
        injected: 'e09-object-collapse',
      },
    ],
    objectCollapsed: true,
  };
}

export {
  isFunctionRealmDistinct,
  isObjectRealmDistinct,
  isFullyDistinctSample,
};
