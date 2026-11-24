'use strict';
/**
 * Observe jsdom-specific traits after a formal jsEnv initialization.
 * Does not modify the target environment. Output is JSON trait records.
 * Trait list matches references/runtime-frameworks.md「jsdom 自身特征」(jsdom@24.1.3).
 * T11 may print jsdom's "Not implemented: HTMLCanvasElement.prototype.getContext" to stderr; that is expected observation noise, not an environment mutation.
 */
const { createJsdomExample } = require('./jsdom-composition');

const DEFAULT_HTML = '<!doctype html><html><body><div id="probe-el" style="width:100px">x</div><canvas id="probe-canvas"></canvas></body></html>';

/** Source evaluated inside the target Realm; must only read. */
const PROBE_SOURCE = `(() => {
  const traits = [];
  const note = (id, detected, observed) => {
    traits.push({ id, detected: !!detected, observed });
  };

  const createElementSrc = Function.prototype.toString.call(document.createElement);
  note(
    'T1_toString_method',
    !/\\[native code\\]/.test(createElementSrc) && /createElement/.test(createElementSrc),
    createElementSrc.slice(0, 160)
  );

  const cookieGet = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')?.get;
  const cookieSrc = cookieGet ? Function.prototype.toString.call(cookieGet) : '';
  note(
    'T2_toString_accessor',
    !/\\[native code\\]/.test(cookieSrc) && /cookie/.test(cookieSrc),
    cookieSrc.slice(0, 160)
  );

  const ua = String(navigator.userAgent || '');
  note('T3_ua_jsdom', /jsdom/i.test(ua), ua);

  note('T4_plugins_empty', navigator.plugins.length === 0, { plugins: navigator.plugins.length, mimeTypes: navigator.mimeTypes.length });
  note('T5_webdriver_undefined', navigator.webdriver === undefined, { webdriver: navigator.webdriver });
  note('T6_languages_default', JSON.stringify([...(navigator.languages || [])]) === JSON.stringify(['en-US', 'en']), [...(navigator.languages || [])]);

  const el = document.getElementById('probe-el');
  const rect = el.getBoundingClientRect();
  note(
    'T7_layout_zero',
    rect.width === 0 && rect.height === 0 && el.offsetWidth === 0 && el.clientWidth === 0,
    { rect: { width: rect.width, height: rect.height }, offsetWidth: el.offsetWidth, clientWidth: el.clientWidth }
  );

  note(
    'T8_screen_zero',
    screen.width === 0 && screen.height === 0 && screen.availWidth === 0 && screen.availHeight === 0,
    { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, innerWidth, innerHeight }
  );

  const docSyms = Object.getOwnPropertySymbols(document).map(String);
  const navKeys = Reflect.ownKeys(navigator).map(String);
  note(
    'T9_internal_symbols',
    docSyms.some((s) => /impl/i.test(s)) || navKeys.some((s) => /impl|SameObject/i.test(s)),
    { documentSymbols: docSyms, navigatorOwnKeys: navKeys.slice(0, 8) }
  );

  let stack = '';
  try { document.querySelector('('); } catch (e) { stack = String(e && e.stack || e); }
  note('T10_stack_jsdom_path', /node_modules[\\\\/]jsdom/.test(stack), stack.split('\\n').slice(0, 5));

  const canvas = document.getElementById('probe-canvas');
  const ctx2d = canvas.getContext('2d');
  const ctxWebgl = canvas.getContext('webgl');
  note('T11_canvas_getContext_null', ctx2d === null && ctxWebgl === null, { ctx2d, ctxWebgl });

  return traits;
})()`;

const CONFIRMED_TRAIT_IDS = [
  'T1_toString_method',
  'T2_toString_accessor',
  'T3_ua_jsdom',
  'T4_plugins_empty',
  'T5_webdriver_undefined',
  'T6_languages_default',
  'T7_layout_zero',
  'T8_screen_zero',
  'T9_internal_symbols',
  'T10_stack_jsdom_path',
  'T11_canvas_getContext_null',
];

async function probeWindow(runtime) {
  return runtime.load(PROBE_SOURCE);
}

/**
 * @param {object} [options]
 * @param {object} [options.fixture]
 * @param {(runtime: object) => Promise<void>|void} [options.beforeProbe] mutate only in tests; probe itself never writes
 */
async function runJsdomTraitProbe(options = {}) {
  const runtime = createJsdomExample(options.jsdomExample);
  const fixture = {
    pageUrl: 'https://example.test/',
    html: DEFAULT_HTML,
    ...options.fixture,
  };
  try {
    await runtime.initialize(fixture);
    if (typeof options.beforeProbe === 'function') await options.beforeProbe(runtime);
    const traits = await probeWindow(runtime);
    return {
      jsdomVersion: '24.1.3',
      traitCount: traits.length,
      confirmedIds: CONFIRMED_TRAIT_IDS.slice(),
      traits,
    };
  } finally {
    await runtime.dispose();
  }
}

module.exports = {
  CONFIRMED_TRAIT_IDS,
  PROBE_SOURCE,
  probeWindow,
  runJsdomTraitProbe,
};

if (require.main === module) {
  runJsdomTraitProbe()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
