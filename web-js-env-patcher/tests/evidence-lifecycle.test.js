'use strict';
/**
 * TEST-Y07: 取证 Frame／世界／生命周期身份（含 I1 身份有效性门闸）
 * 断言调用 scripts/evidence_lifecycle.js（交付模块），并经真实 generate_hook_templates 做跨 Realm 清理。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const lifecyclePath = path.join(root, 'scripts', 'evidence_lifecycle.js');
const {
  sameFrameLabel,
  mergeSameApiEvidence,
  isCurrentLifecycleEvidence,
  canReuseAfterRefresh,
  interpretNoObservation,
  afterCleanup,
  formalPathReady,
  realmStateFromHookControl,
  annotateEvidenceSample,
} = require('../scripts/evidence_lifecycle');
const { build } = require('../scripts/generate_hook_templates');

const NAV = 'nav-1';
const URL = 'https://example.test/app';

function sample(extra = {}, ctx = {}) {
  return annotateEvidenceSample(
    { api: 'navigator.userAgent', value: 'UA', ...extra },
    { frameId: 'main', world: 'main', navigationId: NAV, url: URL, ...ctx }
  );
}

test('TEST-Y07: child vs main Frame same-API evidence cannot mix without labels', () => {
  const main = sample({ value: 'MAIN-UA' }, { frameId: 'main' });
  const child = sample({ value: 'CHILD-UA' }, { frameId: 'iframe-0' });
  const mixed = mergeSameApiEvidence([main, child]);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.reason, 'cross-frame-unlabeled-mix');
  assert.equal(mixed.grade, 'clue-only');

  const same = mergeSameApiEvidence([main, { ...main, value: 'MAIN-UA-2' }]);
  assert.equal(same.ok, true);
  assert.equal(same.frameId, 'main');
  assert.equal(same.world, 'main');
  assert.equal(same.navigationId, NAV);
  assert.equal(sameFrameLabel(main, child), false);
});

test('TEST-Y07: same-URL refresh — old lifecycle sample is not auto-current', () => {
  const oldSample = annotateEvidenceSample(
    { api: 'chrome', value: true },
    { url: URL, navigationId: 'nav-1', frameId: 'main', world: 'main' }
  );
  const afterRefresh = { url: URL, navigationId: 'nav-2', frameId: 'main', world: 'main' };
  assert.equal(isCurrentLifecycleEvidence(oldSample, afterRefresh), false);

  const rejected = canReuseAfterRefresh(oldSample, afterRefresh, null);
  assert.equal(rejected.reuse, false);
  assert.equal(rejected.reason, 'stale-lifecycle-default-reject');

  const conditional = canReuseAfterRefresh(oldSample, afterRefresh, {
    attested: true,
    conditions: ['same-resource-hash', 'hooks-cleared'],
  });
  assert.equal(conditional.reuse, true);
  assert.equal(conditional.reason, 'conditional-reuse');
  assert.ok(conditional.conditions.includes('same-resource-hash'));

  assert.equal(
    isCurrentLifecycleEvidence(oldSample, {
      url: URL,
      navigationId: 'nav-1',
      frameId: 'main',
      world: 'main',
    }),
    true
  );
});

test('TEST-Y07 J3: same URL/nav across Frame or world cannot default reuse', () => {
  const main = {
    url: URL,
    navigationId: 'nav-1',
    frameId: 'main',
    world: 'main',
  };
  const childIsolated = {
    url: URL,
    navigationId: 'nav-1',
    frameId: 'iframe-0',
    world: 'isolated',
  };

  // C anti-example: URL+nav match but Frame/world differ → not same-lifecycle.
  assert.equal(isCurrentLifecycleEvidence(main, childIsolated), false);

  const silent = canReuseAfterRefresh(main, childIsolated, null);
  assert.equal(silent.reuse, false);
  assert.equal(silent.reason, 'cross-context-default-reject');

  // attested without cross-context declaration still refused
  const attestedOnly = canReuseAfterRefresh(main, childIsolated, {
    attested: true,
    conditions: ['same-resource-hash'],
  });
  assert.equal(attestedOnly.reuse, false);
  assert.equal(attestedOnly.reason, 'cross-context-unattested');

  // explicit cross-context attestation may conditional-reuse
  const crossOk = canReuseAfterRefresh(main, childIsolated, {
    attested: true,
    allowCrossContext: true,
    conditions: ['cross-frame-attested', 'same-resource-hash'],
  });
  assert.equal(crossOk.reuse, true);
  assert.equal(crossOk.reason, 'conditional-reuse');

  // positive: same frame/world/url/nav → same-lifecycle
  const sameCtx = { ...main };
  assert.equal(isCurrentLifecycleEvidence(main, sameCtx), true);
  assert.equal(canReuseAfterRefresh(main, sameCtx, null).reuse, true);
  assert.equal(canReuseAfterRefresh(main, sameCtx, null).reason, 'same-lifecycle');

  // missing frame/world on otherwise matching url/nav → incomplete, not same
  const noFrame = { url: URL, navigationId: 'nav-1', world: 'main' };
  assert.equal(isCurrentLifecycleEvidence(main, noFrame), false);
  assert.equal(canReuseAfterRefresh(main, noFrame, null).reuse, false);
  assert.equal(canReuseAfterRefresh(main, noFrame, null).reason, 'incomplete-lifecycle-identity');
});

test('TEST-Y07 K3: cross-context reuse requires structured allowCrossContext only', () => {
  const a = {
    url: 'https://case.test/',
    navigationId: 'nav-1',
    frameId: 'main',
    world: 'main',
  };
  const b = { ...a, world: 'isolated' };

  // C-F5-03: structured false + negative text → reuse false (structured, not text).
  const structuredFalse = canReuseAfterRefresh(a, b, {
    attested: true,
    allowCrossContext: false,
    conditions: ['cross-world: NOT equivalent; do not reuse'],
  });
  assert.equal(structuredFalse.reuse, false);
  assert.equal(structuredFalse.reason, 'cross-context-unattested');

  // Negative / "not established" text alone cannot grant (no allowCrossContext:true).
  const textOnly = canReuseAfterRefresh(a, b, {
    attested: true,
    conditions: ['cross-world equivalence has NOT been established'],
  });
  assert.equal(textOnly.reuse, false);
  assert.equal(textOnly.reason, 'cross-context-unattested');

  // Keyword-looking positive text still cannot grant without structured true.
  const keywordOnly = canReuseAfterRefresh(a, b, {
    attested: true,
    conditions: ['cross-world equivalence established'],
  });
  assert.equal(keywordOnly.reuse, false);

  // Structured permit true + opposite text → still reuse true (text has no veto).
  const textOpposite = canReuseAfterRefresh(a, b, {
    attested: true,
    allowCrossContext: true,
    conditions: ['cross-world: NOT equivalent; do not reuse'],
  });
  assert.equal(textOpposite.reuse, true);
  assert.equal(textOpposite.reason, 'conditional-reuse');

  // Positive: allowCrossContext:true + neutral / empty conditions.
  const neutral = canReuseAfterRefresh(a, b, {
    attested: true,
    allowCrossContext: true,
    conditions: ['same-resource-hash'],
  });
  assert.equal(neutral.reuse, true);
  assert.equal(neutral.reason, 'conditional-reuse');

  const emptyConditions = canReuseAfterRefresh(a, b, {
    attested: true,
    allowCrossContext: true,
  });
  assert.equal(emptyConditions.reuse, true);
  assert.equal(emptyConditions.reason, 'conditional-reuse');

  // Same-context same-lifecycle; incomplete identity refuse; default cross-context refuse.
  assert.equal(canReuseAfterRefresh(a, { ...a }, null).reuse, true);
  assert.equal(canReuseAfterRefresh(a, { ...a }, null).reason, 'same-lifecycle');
  assert.equal(
    canReuseAfterRefresh(a, { ...a, frameId: undefined }, { attested: true, allowCrossContext: true })
      .reuse,
    false
  );
  assert.equal(canReuseAfterRefresh(a, b, null).reuse, false);
  assert.equal(canReuseAfterRefresh(a, b, null).reason, 'cross-context-default-reject');
});

test('TEST-Y07: log cap — no-observation distinguishes truncation / not-executed / wrong-context', () => {
  const base = {
    hits: 0,
    expectedWorld: 'main',
    expectedFrameId: 'main',
    world: 'main',
    frameId: 'main',
    hookInstalled: true,
    collectionWindow: 'covers',
  };

  const capped = interpretNoObservation({ ...base, possiblyCapped: true });
  assert.equal(capped.kind, 'inconclusive-truncated');
  assert.equal(capped.proveAbsence, false);

  const wrongWorld = interpretNoObservation({
    ...base,
    possiblyCapped: false,
    world: 'isolated',
  });
  assert.equal(wrongWorld.kind, 'wrong-context');
  assert.equal(wrongWorld.proveAbsence, false);

  const notExec = interpretNoObservation({ ...base, possiblyCapped: false });
  assert.equal(notExec.kind, 'not-executed');
  assert.equal(notExec.proveAbsence, true);

  const unknownCap = interpretNoObservation({ ...base, possiblyCapped: 'unknown' });
  assert.equal(unknownCap.kind, 'inconclusive-truncated');
  assert.equal(unknownCap.proveAbsence, false);
});

test('TEST-Y07: model cleanup does not pollute other realms; formal path requires no hook', () => {
  const realms = {
    page: { hookInstalled: true, buffer: ['hit'] },
    iframe: { hookInstalled: true, buffer: ['iframe-hit'] },
  };
  const after = afterCleanup({ realms, cleanedRealmId: 'page' });
  assert.equal(after.page.hookInstalled, false);
  assert.equal(after.page.uninstalled, true);
  assert.deepEqual(after.page.buffer, []);
  assert.equal(after.iframe.hookInstalled, true, 'other realm must keep its hook state');
  assert.deepEqual(after.iframe.buffer, ['iframe-hit']);

  assert.equal(formalPathReady(after.page), true);
  assert.equal(formalPathReady(after.iframe), false);
});

test('TEST-Y07 I1: both-missing / one-missing / null identity cannot affirm merge or reuse', () => {
  // --- lifecycle: both missing navigationId ---
  const bothMissNav = { url: URL };
  const bothMissNav2 = { url: URL };
  assert.equal(isCurrentLifecycleEvidence(bothMissNav, bothMissNav2), false);
  const reuseBothMiss = canReuseAfterRefresh(bothMissNav, bothMissNav2, {
    attested: true,
    conditions: ['should-not-matter'],
  });
  assert.equal(reuseBothMiss.reuse, false);
  assert.equal(reuseBothMiss.reason, 'incomplete-lifecycle-identity');
  assert.equal(reuseBothMiss.grade, 'clue-only');

  // --- lifecycle: one side missing ---
  const withNav = { url: URL, navigationId: 'nav-1' };
  const withoutNav = { url: URL };
  assert.equal(isCurrentLifecycleEvidence(withNav, withoutNav), false);
  assert.equal(canReuseAfterRefresh(withNav, withoutNav, null).reuse, false);

  // --- lifecycle: explicit null ---
  const nullNav = { url: URL, navigationId: null };
  assert.equal(isCurrentLifecycleEvidence(nullNav, nullNav), false);
  assert.equal(
    isCurrentLifecycleEvidence(
      { url: URL, navigationId: 'nav-1' },
      { url: URL, navigationId: null }
    ),
    false
  );

  // --- merge: both missing navigationId ---
  const a = annotateEvidenceSample(
    { api: 'navigator.userAgent', value: 'A' },
    { frameId: 'main', world: 'main' }
  );
  const b = annotateEvidenceSample(
    { api: 'navigator.userAgent', value: 'B' },
    { frameId: 'main', world: 'main' }
  );
  assert.equal(a.navigationId, null);
  const mergeBothMiss = mergeSameApiEvidence([a, b]);
  assert.equal(mergeBothMiss.ok, false);
  assert.equal(mergeBothMiss.reason, 'incomplete-navigationId');
  assert.equal(mergeBothMiss.grade, 'clue-only');

  // --- merge: one side missing world ---
  const left = sample({}, { world: 'main' });
  const right = sample({}, { world: null });
  const mergeOneMiss = mergeSameApiEvidence([left, right]);
  assert.equal(mergeOneMiss.ok, false);
  assert.equal(mergeOneMiss.reason, 'incomplete-world');
  assert.equal(mergeOneMiss.grade, 'clue-only');

  // --- merge: same frame, different world ---
  const mainWorld = sample({}, { world: 'main' });
  const isoWorld = sample({}, { world: 'isolated' });
  const mergeWorld = mergeSameApiEvidence([mainWorld, isoWorld]);
  assert.equal(mergeWorld.ok, false);
  assert.equal(mergeWorld.reason, 'cross-world-mix');
  assert.equal(mergeWorld.grade, 'clue-only');

  // --- merge: same frame/world, different navigation ---
  const nav1 = sample({}, { navigationId: 'nav-1' });
  const nav2 = sample({}, { navigationId: 'nav-2' });
  const mergeNav = mergeSameApiEvidence([nav1, nav2]);
  assert.equal(mergeNav.ok, false);
  assert.equal(mergeNav.reason, 'cross-navigation-mix');
  assert.equal(mergeNav.grade, 'clue-only');

  // --- merge: frameId explicitly null on both ---
  const nullFrameA = sample({}, { frameId: null });
  const nullFrameB = sample({}, { frameId: null });
  const mergeNullFrame = mergeSameApiEvidence([nullFrameA, nullFrameB]);
  assert.equal(mergeNullFrame.ok, false);
  assert.equal(mergeNullFrame.reason, 'incomplete-frameId');
});

test('TEST-Y07 J2: incomplete context / unknown window cannot proveAbsence', () => {
  const covering = {
    hits: 0,
    possiblyCapped: false,
    hookInstalled: true,
    collectionWindow: 'covers',
    expectedWorld: 'main',
    expectedFrameId: 'main',
    world: 'main',
    frameId: 'main',
  };

  // Positive control: all gates green → may prove absence.
  const ok = interpretNoObservation(covering);
  assert.equal(ok.kind, 'not-executed');
  assert.equal(ok.proveAbsence, true);

  // Frame/world both missing (C anti-example: double-missing was treated as equal).
  const bothMiss = interpretNoObservation({
    hits: 0,
    possiblyCapped: false,
    hookInstalled: true,
    collectionWindow: 'covers',
    // world / frameId / expected* all absent
  });
  assert.equal(bothMiss.proveAbsence, false);
  assert.equal(bothMiss.kind, 'inconclusive-incomplete-context');

  // One side missing
  const oneMiss = interpretNoObservation({
    ...covering,
    frameId: 'main',
    expectedFrameId: undefined,
  });
  assert.equal(oneMiss.proveAbsence, false);
  assert.equal(oneMiss.kind, 'inconclusive-incomplete-context');

  // Explicit null on both sides of world
  const nullWorld = interpretNoObservation({
    ...covering,
    world: null,
    expectedWorld: null,
  });
  assert.equal(nullWorld.proveAbsence, false);
  assert.equal(nullWorld.kind, 'inconclusive-incomplete-context');

  // Collection window missing
  const noWindow = interpretNoObservation({
    hits: 0,
    possiblyCapped: false,
    hookInstalled: true,
    expectedWorld: 'main',
    expectedFrameId: 'main',
    world: 'main',
    frameId: 'main',
  });
  assert.equal(noWindow.proveAbsence, false);
  assert.equal(noWindow.kind, 'inconclusive-collection-window');

  // Window unknown / not covering
  const unknownWin = interpretNoObservation({
    ...covering,
    collectionWindow: 'unknown',
  });
  assert.equal(unknownWin.proveAbsence, false);
  assert.equal(unknownWin.kind, 'inconclusive-collection-window');

  const missWin = interpretNoObservation({
    ...covering,
    collectionWindow: { knownValid: true, coversTargetPhase: false },
  });
  assert.equal(missWin.proveAbsence, false);
  assert.equal(missWin.kind, 'inconclusive-collection-window');

  // Object form covering still allows proveAbsence
  const objWin = interpretNoObservation({
    ...covering,
    collectionWindow: { knownValid: true, coversTargetPhase: true },
  });
  assert.equal(objWin.proveAbsence, true);
  assert.equal(objWin.kind, 'not-executed');
});

test('TEST-Y07 K2: only known numeric zero hits can proveAbsence', () => {
  const gatesGreen = {
    possiblyCapped: false,
    observerInstalled: true,
    frameId: 'main',
    expectedFrameId: 'main',
    world: 'main',
    expectedWorld: 'main',
    collectionWindow: { knownValid: true, coversTargetPhase: true },
  };

  // C-F5-02: missing / invalid hits must not prove absence even when other gates are green.
  for (const [label, value] of [
    ['omitted', undefined],
    ['null', null],
    ['NaN', NaN],
    ['negative', -1],
    ['unknown', 'unknown'],
    ['Infinity', Infinity],
    ['string-zero', '0'],
  ]) {
    const r = interpretNoObservation(
      label === 'omitted' ? { ...gatesGreen } : { ...gatesGreen, hits: value }
    );
    assert.equal(r.proveAbsence, false, label);
    assert.equal(r.kind, 'inconclusive-unknown-hits', label);
    assert.notEqual(r.kind, 'not-executed', label);
  }

  // Positive: finite zero may still proveAbsence when gates are green.
  const zero = interpretNoObservation({ ...gatesGreen, hits: 0 });
  assert.equal(zero.kind, 'not-executed');
  assert.equal(zero.proveAbsence, true);

  // Finite positive remains observed.
  const observed = interpretNoObservation({ ...gatesGreen, hits: 3 });
  assert.equal(observed.kind, 'observed');
  assert.equal(observed.hits, 3);

  // Existing J2 refusals must not regress when hits is a known zero.
  assert.equal(
    interpretNoObservation({
      ...gatesGreen,
      hits: 0,
      frameId: undefined,
      expectedFrameId: undefined,
      world: undefined,
      expectedWorld: undefined,
    }).proveAbsence,
    false
  );
  assert.equal(
    interpretNoObservation({
      ...gatesGreen,
      hits: 0,
      collectionWindow: 'unknown',
    }).proveAbsence,
    false
  );
  assert.equal(
    interpretNoObservation({
      ...gatesGreen,
      hits: 0,
      possiblyCapped: true,
    }).proveAbsence,
    false
  );
  assert.equal(
    interpretNoObservation({
      hits: 0,
      possiblyCapped: false,
      collectionWindow: 'covers',
      frameId: 'main',
      expectedFrameId: 'main',
      world: 'main',
      expectedWorld: 'main',
      // no observer
    }).proveAbsence,
    false
  );
});

test('TEST-Y07 I1: no observer / null control cannot prove absence or formal readiness', () => {
  const base = {
    hits: 0,
    possiblyCapped: false,
    expectedWorld: 'main',
    expectedFrameId: 'main',
    world: 'main',
    frameId: 'main',
    collectionWindow: 'covers',
  };

  const noHook = interpretNoObservation({ ...base, hookInstalled: false });
  assert.equal(noHook.kind, 'inconclusive-no-observer');
  assert.equal(noHook.proveAbsence, false);

  const missingHook = interpretNoObservation({ ...base });
  assert.equal(missingHook.kind, 'inconclusive-no-observer');
  assert.equal(missingHook.proveAbsence, false);

  const nullControl = realmStateFromHookControl(null);
  assert.equal(nullControl.controlPresent, false);
  assert.equal(nullControl.hookInstalled, null);
  assert.equal(nullControl.patchesKnown, false);
  assert.equal(formalPathReady(nullControl), false);

  assert.equal(formalPathReady(null), false);
  assert.equal(formalPathReady({ hookInstalled: false }), false, 'false alone is not proof');
  assert.equal(
    formalPathReady({ hookInstalled: false, uninstalled: true }),
    true,
    'attested model uninstall ok'
  );
});

test('TEST-Y07 J4: incomplete control handle without patches cannot be formal-ready', () => {
  // C anti-example: only uninstall(), no patches array.
  const incomplete = realmStateFromHookControl({
    uninstall() {},
  });
  assert.equal(incomplete.controlPresent, true);
  assert.equal(incomplete.patchesKnown, false);
  assert.equal(incomplete.hookInstalled, null);
  assert.equal(formalPathReady(incomplete), false);

  // patches wrong type
  const badPatches = realmStateFromHookControl({
    uninstall() {},
    patches: 'gone',
  });
  assert.equal(badPatches.patchesKnown, false);
  assert.equal(badPatches.hookInstalled, null);
  assert.equal(formalPathReady(badPatches), false);

  // controlPresent alone with forged hookInstalled:false still not ready without patchesKnown
  assert.equal(
    formalPathReady({ hookInstalled: false, controlPresent: true, patchesKnown: false }),
    false
  );

  // Complete uninstalled handle: patches:[] + uninstall
  const clean = realmStateFromHookControl({
    uninstall() {},
    patches: [],
  });
  assert.equal(clean.patchesKnown, true);
  assert.equal(clean.hookInstalled, false);
  assert.equal(clean.controlPresent, true);
  assert.equal(formalPathReady(clean), true);

  // Still installed
  const live = realmStateFromHookControl({
    uninstall() {},
    patches: [{ api: 'fetch' }],
  });
  assert.equal(live.hookInstalled, true);
  assert.equal(formalPathReady(live), false);

  // null still not ready
  assert.equal(formalPathReady(realmStateFromHookControl(null)), false);
});

test('TEST-Y07 F4.3: real generate_hook_templates install→activity→uninstall; other realm untouched', async () => {
  const code = build({
    param: 'sign',
    apiPattern: '/api/',
    types: 'fetch',
    debugger: false,
  });

  function makeRealm(url) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url,
      runScripts: 'outside-only',
    });
    const { window } = dom;
    const infos = [];
    window.console.info = (...args) => {
      infos.push(args);
    };
    window.fetch = async (input) => ({ ok: true, url: String(input) });
    const control = window.eval(code);
    return { dom, window, control, infos };
  }

  const page = makeRealm('https://example.test/page');
  const other = makeRealm('https://example.test/iframe-other');

  assert.equal(typeof page.control.install, 'function');
  assert.equal(typeof page.control.uninstall, 'function');
  assert.ok(page.control.patches.length > 0, 'page hooks installed');
  assert.ok(other.control.patches.length > 0, 'other realm hooks installed');

  const pageWrapped = page.window.fetch;
  const otherWrapped = other.window.fetch;
  await page.window.fetch('/api/page?sign=1');
  await other.window.fetch('/api/other?sign=1');
  assert.ok(page.infos.length >= 1, 'page activity observed');
  assert.ok(other.infos.length >= 1, 'other realm activity observed');

  const before = {
    page: realmStateFromHookControl(page.control, { buffer: ['page-hit'] }),
    other: realmStateFromHookControl(other.control, { buffer: ['other-hit'] }),
  };
  assert.equal(before.page.hookInstalled, true);
  assert.equal(before.other.hookInstalled, true);

  // Uninstall ONLY the page-realm control (real delivery entry).
  page.control.uninstall();

  const afterPage = realmStateFromHookControl(page.control, { buffer: [] });
  const afterOther = realmStateFromHookControl(other.control, {
    buffer: ['other-hit'],
  });
  assert.equal(afterPage.hookInstalled, false);
  assert.equal(afterPage.controlPresent, true);
  assert.equal(formalPathReady(afterPage), true);
  assert.equal(page.window.fetch === pageWrapped, false, 'page fetch restored from wrap');
  assert.equal(typeof page.window.fetch, 'function');

  assert.equal(afterOther.hookInstalled, true, 'other realm must keep hooks');
  assert.equal(formalPathReady(afterOther), false);
  assert.equal(other.window.fetch, otherWrapped, 'other realm still wrapped');
  assert.ok(other.control.patches.length > 0);

  // Model-level afterCleanup must agree with real control-derived states.
  const modeled = afterCleanup({
    realms: {
      page: { hookInstalled: true, buffer: ['page-hit'] },
      other: { hookInstalled: true, buffer: ['other-hit'] },
    },
    cleanedRealmId: 'page',
  });
  assert.equal(modeled.page.hookInstalled, false);
  assert.equal(modeled.other.hookInstalled, true);

  page.dom.window.close();
  other.dom.window.close();
});

test('TEST-Y07 F4: test alone without $M scripts cannot pass (requires delivery module)', () => {
  assert.ok(fs.existsSync(lifecyclePath));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'y07-isolated-'));
  try {
    // Copy THIS test file alone (no scripts/) — C acceptance: cannot still pass.
    const isolatedTest = path.join(tmp, 'evidence-lifecycle.test.js');
    fs.copyFileSync(__filename, isolatedTest);
    const childEnv = { ...process.env, NODE_PATH: '' };
    delete childEnv.NODE_TEST_CONTEXT; // allow nested `node --test` from within a test
    const r = spawnSync(process.execPath, ['--test', isolatedTest], {
      encoding: 'utf8',
      cwd: tmp,
      env: childEnv,
    });
    const out = `${r.stderr}\n${r.stdout}`;
    const pass = Number((/# pass (\d+)/.exec(out) || [])[1] || 0);
    const fail = Number((/# fail (\d+)/.exec(out) || [])[1] || 0);
    assert.ok(
      pass === 0 && (fail >= 1 || r.status !== 0),
      `isolated copy must not pass; status=${r.status} pass=${pass} fail=${fail}\n${out.slice(0, 800)}`
    );
    assert.match(out, /Cannot find module|MODULE_NOT_FOUND|evidence_lifecycle|generate_hook_templates/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
