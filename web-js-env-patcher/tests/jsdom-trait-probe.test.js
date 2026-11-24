'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIRMED_TRAIT_IDS,
  runJsdomTraitProbe,
} = require('../assets/examples/jsdom-trait-probe');

test('untreated jsdom: every confirmed trait is detected', async () => {
  const report = await runJsdomTraitProbe();
  assert.equal(report.traits.length, CONFIRMED_TRAIT_IDS.length);
  for (const id of CONFIRMED_TRAIT_IDS) {
    const row = report.traits.find((t) => t.id === id);
    assert.ok(row, `missing trait ${id}`);
    assert.equal(row.detected, true, `${id} should be detected on untreated jsdom; observed=${JSON.stringify(row.observed)}`);
  }
});

test('treated UA: T3_ua_jsdom is not detected after appearance-layer override', async () => {
  const chromeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const report = await runJsdomTraitProbe({
    async beforeProbe(runtime) {
      // Minimal appearance-layer example: only override the accessed getter; does not alter jsdom semantic backend.
      await runtime.load(`Object.defineProperty(Navigator.prototype, 'userAgent', {
        configurable: true,
        enumerable: true,
        get() { return ${JSON.stringify(chromeUA)}; },
      });`);
    },
  });
  const ua = report.traits.find((t) => t.id === 'T3_ua_jsdom');
  assert.ok(ua);
  assert.equal(ua.detected, false, `UA should no longer contain jsdom; observed=${ua.observed}`);
  const still = report.traits.find((t) => t.id === 'T1_toString_method');
  assert.equal(still.detected, true, 'unrelated traits remain detectable');
});
