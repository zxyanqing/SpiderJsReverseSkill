'use strict';
/**
 * TEST-Y06: 固定来源案例（重建校验／反例观察／本地模拟≠网站接受）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const caseDir = path.join(root, 'cases', 'fingerprintjs-local');
const sourcesPath = path.join(caseDir, 'sources.json');

function readSources() {
  return JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Optional accelerator only — never a hard prerequisite for live tests. */
function defaultCacheDir() {
  const fromEnv = process.env.Y06_FP_CACHE_DIR;
  const candidate = fromEnv || '/tmp/y06-fp-check';
  try {
    const sources = readSources();
    if (
      fs.existsSync(candidate) &&
      sources.sources.every((s) => fs.existsSync(path.join(candidate, s.archive)))
    ) {
      return fs.realpathSync(candidate);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function runPrepare(output, cacheDir) {
  const args = [path.join(caseDir, 'prepare.mjs'), '--output', output];
  // Explicit null/false disables cache even if default exists (G5 smoke).
  let cache;
  if (cacheDir === null || cacheDir === false) cache = null;
  else if (cacheDir) cache = cacheDir;
  else cache = defaultCacheDir();
  if (cache) args.push('--cache-dir', cache);
  // Downloads need headroom when no local cache.
  const timeout = cache ? 120000 : 300000;
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
  });
}

/** Prepare assets for live runs: cache if present, else download+verify via prepare.mjs. */
function prepareLiveAssets(label) {
  const prepared = path.join(os.tmpdir(), `y06-${label}-${process.pid}-${Date.now()}`);
  if (fs.existsSync(prepared)) fs.rmSync(prepared, { recursive: true, force: true });
  const cache = defaultCacheDir();
  const prep = runPrepare(prepared, cache || null);
  assert.equal(
    prep.status,
    0,
    `prepare failed (cache=${cache || 'none'}): ${prep.stderr || prep.stdout}`
  );
  return { prepared, cache: cache || null };
}

function goodE09() {
  return {
    iframeCreateCount: 2,
    sampleCount: 1,
    capturedCount: 1,
    functionDistinctCount: 1,
    objectDistinctCount: 1,
    distinctRealmCount: 1,
    childDistinctFromPage: true,
    functionDistinctFromPage: true,
    objectDistinctFromPage: true,
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
        objectProtoDistinct: true,
      },
    ],
  };
}

function cleanHost() {
  return {
    before: {
      hasWindow: false,
      hasDocument: false,
      hasNavigator: false,
      navigatorId: null,
      windowIsObject: false,
    },
    after: {
      hasWindow: false,
      hasDocument: false,
      hasNavigator: false,
      navigatorId: null,
      windowIsObject: false,
    },
  };
}

function collectBoundaryCorpus() {
  const files = [
    path.join(root, 'references', 'real-source-cases.md'),
    path.join(caseDir, 'README.md'),
    path.join(caseDir, 'NOTICE'),
    path.join(caseDir, 'anti-examples.md'),
    path.join(caseDir, 'observe.mjs'),
    path.join(root, 'cases', 'README.md'),
  ];
  return files.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));
}

test('TEST-Y06 rebuild: pins + prepare verify recorded commit/hashes', async () => {
  const sources = readSources();
  assert.equal(sources.caseId, 'fingerprintjs-local');
  assert.equal(sources.expectedVersion, '5.2.0');
  assert.ok(Array.isArray(sources.sources) && sources.sources.length >= 2);

  const byName = Object.fromEntries(sources.sources.map((s) => [s.name, s]));
  const src = byName['fingerprintjs-source'];
  const npm = byName['fingerprintjs-npm-dist'];
  assert.ok(src, 'source pin missing');
  assert.ok(npm, 'npm dist pin missing');
  assert.equal(src.commit, 'e196578ba35362fdf15647e013d66ac28b3c9fb5');
  assert.match(src.sha256, /^[a-f0-9]{64}$/);
  assert.match(npm.sha256, /^[a-f0-9]{64}$/);
  assert.equal(src.license, 'MIT');
  assert.equal(npm.license, 'MIT');
  assert.ok(fs.existsSync(path.join(caseDir, 'prepare.mjs')), 'prepare command asset missing');
  assert.ok(fs.existsSync(path.join(caseDir, 'NOTICE')), 'license notice missing');

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'y06-rebuild-'));
  // Place under realpath parent (prepare normalizes); mkdtemp already created — prepare needs non-existent.
  fs.rmSync(out, { recursive: true, force: true });
  const prepared = path.join(path.dirname(out), `y06-rebuild-run-${process.pid}-${Date.now()}`);

  const okRun = runPrepare(prepared);
  assert.equal(okRun.status, 0, `prepare failed: ${okRun.stderr || okRun.stdout}`);
  const prepareJson = JSON.parse(fs.readFileSync(path.join(prepared, 'PREPARE.json'), 'utf8'));
  assert.equal(prepareJson.status, 'ok');
  for (const pin of sources.sources) {
    const got = prepareJson.sources.find((s) => s.name === pin.name);
    assert.ok(got, `missing prepare evidence for ${pin.name}`);
    assert.equal(got.verifiedSha256, pin.sha256);
    assert.equal(got.expectedSha256, pin.sha256);
  }
  const runnable = JSON.parse(fs.readFileSync(path.join(prepared, 'RUNNABLE.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(prepared, runnable.distCjs)));
  assert.ok(fs.existsSync(path.join(prepared, runnable.license)));

  // Wrong hash must not silently pass: cache a corrupt archive under the pinned name.
  const badOut = path.join(path.dirname(prepared), `y06-rebuild-bad-${process.pid}-${Date.now()}`);
  const badCache = fs.mkdtempSync(path.join(os.tmpdir(), 'y06-bad-cache-'));
  const victim = sources.sources[0];
  fs.writeFileSync(path.join(badCache, victim.archive), 'not-the-pinned-bytes\n');
  // Also plant the other archive correctly so failure is specifically the corrupt one.
  const goodDownloads = path.join(prepared, 'downloads');
  for (const pin of sources.sources) {
    if (pin.name === victim.name) continue;
    fs.copyFileSync(path.join(goodDownloads, pin.archive), path.join(badCache, pin.archive));
  }
  const badRun = runPrepare(badOut, badCache);
  assert.notEqual(badRun.status, 0, 'corrupt cache must fail prepare');
  assert.match(`${badRun.stderr}\n${badRun.stdout}`, /SHA256 mismatch/i);

  fs.rmSync(prepared, { recursive: true, force: true });
  fs.rmSync(badCache, { recursive: true, force: true });
  if (fs.existsSync(badOut)) fs.rmSync(badOut, { recursive: true, force: true });
});

test('TEST-Y06 anti-examples: declared observations catch injected env/asset faults', async () => {
  const { observeConsumer } = await import('../cases/fingerprintjs-local/observe.mjs');
  const { runFingerprintCase, writeFakeWrongVersionDist } = await import(
    '../cases/fingerprintjs-local/lib/load-agent.mjs'
  );

  const pageRealm = {
    load: { inPageRealm: true, inHostRealm: false },
    get: { inPageRealm: true, inHostRealm: false },
  };

  // Positive local observation (synthetic success) must still refuse websiteAccepted.
  const baseline = observeConsumer({
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['platform'],
      componentDetails: { platform: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    realm: pageRealm,
    componentErrors: [],
    e09: goodE09(),
    host: cleanHost(),
  });
  assert.equal(baseline.ok, true);
  assert.equal(baseline.websiteAccepted, false);

  const incomplete = observeConsumer({
    mode: 'incomplete-callback',
    loadedVersion: null,
    result: null,
    completionReached: false,
    error: null,
    websiteAccepted: false,
  });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.problems.some((p) => p.code === 'callback-incomplete'));

  const proto = observeConsumer({
    mode: 'wrong-prototype',
    loadedVersion: null,
    result: null,
    completionReached: false,
    error: 'Cannot read properties of undefined',
    websiteAccepted: false,
  });
  assert.equal(proto.ok, false);
  assert.ok(
    proto.problems.some((p) => p.code === 'runtime-error' || p.code === 'callback-incomplete')
  );

  // Component errors must not silently ok (name+message retained).
  const masked = observeConsumer({
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['colorGamut'],
      componentDetails: {
        colorGamut: {
          status: 'error',
          error: { name: 'ReferenceError', message: 'matchMedia is not defined' },
        },
      },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    realm: pageRealm,
    componentErrors: [
      { component: 'colorGamut', name: 'ReferenceError', message: 'matchMedia is not defined' },
    ],
    e09: goodE09(),
    host: cleanHost(),
  });
  assert.equal(masked.ok, false);
  assert.ok(masked.problems.some((p) => p.code === 'component-error' && /matchMedia/.test(p.detail)));

  // Executable injection: load forged dist (version 9.9.9) through the case harness.
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'y06-fake-'));
  writeFakeWrongVersionDist(fakeDir);
  const wrongRes = await runFingerprintCase({
    distCjs: path.join(fakeDir, 'fp.cjs.js'),
    distUmd: path.join(fakeDir, 'fp.umd.js'),
    fault: 'wrong-resource-version',
    fakeDistDir: fakeDir,
    timeoutMs: 3000,
  });
  const wrongResObs = observeConsumer(wrongRes);
  assert.equal(wrongResObs.ok, false);
  assert.ok(wrongResObs.problems.some((p) => p.code === 'resource-version-mismatch'));

  const incompleteRun = await runFingerprintCase({
    distCjs: path.join(fakeDir, 'fp.cjs.js'),
    fault: 'incomplete-callback',
    timeoutMs: 3000,
  });
  const incompleteObs = observeConsumer(incompleteRun);
  assert.equal(incompleteObs.ok, false);
  assert.ok(incompleteObs.problems.some((p) => p.code === 'callback-incomplete'));

  fs.rmSync(fakeDir, { recursive: true, force: true });
});

test('TEST-Y06 F3: page-Realm load + distinctive realm/component assertions', async () => {
  const { prepared } = prepareLiveAssets('f3');
  const runnable = JSON.parse(fs.readFileSync(path.join(prepared, 'RUNNABLE.json'), 'utf8'));
  assert.equal(runnable.loadPath, 'page-script');
  assert.ok(runnable.distUmd);

  function runLocal(fault) {
    return spawnSync(
      process.execPath,
      [path.join(caseDir, 'run-local.mjs'), '--assets', prepared, '--fault', fault],
      { cwd: root, encoding: 'utf8', timeout: 60000 }
    );
  }

  const baselineRun = runLocal('baseline');
  assert.equal(baselineRun.status, 0, baselineRun.stderr || baselineRun.stdout);
  const baseline = JSON.parse(baselineRun.stdout);
  assert.equal(baseline.raw.loadPath, 'page-script');
  assert.equal(baseline.raw.realm.load.inPageRealm, true);
  assert.equal(baseline.raw.realm.load.inHostRealm, false);
  assert.ok(baseline.raw.realm.get, 'realm.get probe required');
  assert.equal(baseline.raw.realm.get.inPageRealm, true);
  assert.equal(baseline.raw.realm.get.inHostRealm, false);
  assert.ok(baseline.raw.iframeCreateCount >= 1, 'SDK should create iframe(s)');
  assert.ok(baseline.raw.result && baseline.raw.result.componentDetails);
  assert.equal((baseline.raw.componentErrors || []).length, 0);
  assert.equal(baseline.observation.ok, true);

  const noMmRun = runLocal('missing-matchMedia');
  assert.equal(noMmRun.status, 0, noMmRun.stderr || noMmRun.stdout);
  const noMm = JSON.parse(noMmRun.stdout);
  assert.ok((noMm.raw.componentErrors || []).length >= 1);
  const errName = noMm.raw.componentErrors[0].component;
  assert.equal(noMm.raw.result.componentDetails[errName].status, 'error');
  assert.match(noMm.raw.result.componentDetails[errName].error.message, /matchMedia/);
  assert.equal(noMm.observation.ok, false);
  assert.ok(noMm.observation.problems.some((p) => p.code === 'component-error'));

  const hostRun = runLocal('host-require-realm');
  assert.equal(hostRun.status, 0, hostRun.stderr || hostRun.stdout);
  const host = JSON.parse(hostRun.stdout);
  assert.equal(host.raw.loadPath, 'host-require');
  assert.equal(host.raw.realm.load.inPageRealm, false);
  assert.equal(host.raw.realm.load.inHostRealm, true);
  assert.equal(host.observation.ok, false);
  assert.ok(host.observation.problems.some((p) => p.code === 'realm-mismatch'));

  const readme = fs.readFileSync(path.join(caseDir, 'README.md'), 'utf8');
  assert.match(readme, /页面 Realm/);
  assert.match(readme, /禁止.*createRequire|禁止.*宿主/);
  assert.match(readme, /matchMedia/);
  const anti = fs.readFileSync(path.join(caseDir, 'anti-examples.md'), 'utf8');
  assert.match(anti, /host-require-realm/);
  assert.match(anti, /missing-matchMedia/);

  fs.rmSync(prepared, { recursive: true, force: true });
});




test('TEST-Y06 G2: observe requires page Realm for get(); load-ok/get-host fails', async () => {
  const { observeConsumer } = await import('../cases/fingerprintjs-local/observe.mjs');
  const base = {
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['platform'],
      componentDetails: { platform: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    componentErrors: [],
    e09: goodE09(),
    host: cleanHost(),
  };

  const bothOk = observeConsumer({
    ...base,
    realm: {
      load: { inPageRealm: true, inHostRealm: false },
      get: { inPageRealm: true, inHostRealm: false },
    },
  });
  assert.equal(bothOk.ok, true);

  const getHost = observeConsumer({
    ...base,
    realm: {
      load: { inPageRealm: true, inHostRealm: false },
      get: { inPageRealm: false, inHostRealm: true },
    },
  });
  assert.equal(getHost.ok, false);
  assert.ok(getHost.problems.some((p) => p.code === 'realm-get-mismatch'));
  assert.ok(!getHost.problems.some((p) => p.code === 'realm-mismatch'));

  const getMissing = observeConsumer({
    ...base,
    realm: {
      load: { inPageRealm: true, inHostRealm: false },
      get: null,
    },
  });
  assert.equal(getMissing.ok, false);
  assert.ok(getMissing.problems.some((p) => p.code === 'realm-get-evidence-missing'));
});



test('TEST-Y06 G5: prepare works without /tmp/y06-fp-check hard dependency', () => {
  // Even if a machine cache exists, force no --cache-dir so path is download-capable.
  const out = path.join(os.tmpdir(), `y06-g5-nocache-${process.pid}-${Date.now()}`);
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  const prep = runPrepare(out, null);
  assert.equal(prep.status, 0, `prepare without cache failed: ${prep.stderr || prep.stdout}`);
  const runnable = JSON.parse(fs.readFileSync(path.join(out, 'RUNNABLE.json'), 'utf8'));
  assert.ok(runnable.distUmd);
  assert.ok(fs.existsSync(path.join(out, runnable.distUmd)));
  fs.rmSync(out, { recursive: true, force: true });
});

test('TEST-Y06 G3: observe fails when after introduces globalThis.navigator', async () => {
  const { observeConsumer } = await import('../cases/fingerprintjs-local/observe.mjs');
  const { evaluateE09Problems } = await import(
    '../cases/fingerprintjs-local/lib/e09-iframe-realm.mjs'
  );
  const pageRealm = {
    load: { inPageRealm: true, inHostRealm: false },
    get: { inPageRealm: true, inHostRealm: false },
  };
  const polluted = {
    before: {
      hasWindow: false,
      hasDocument: false,
      hasNavigator: false,
      navigatorId: null,
      windowIsObject: false,
    },
    after: {
      hasWindow: false,
      hasDocument: false,
      hasNavigator: true,
      navigatorId: 'ua:polluted|lang:',
      windowIsObject: false,
    },
  };
  const direct = evaluateE09Problems(goodE09(), polluted, 'page-script');
  assert.ok(direct.some((p) => p.code === 'e09-host-polluted' && /navigator/.test(p.detail)));

  const obs = observeConsumer({
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['platform'],
      componentDetails: { platform: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    realm: pageRealm,
    componentErrors: [],
    e09: goodE09(),
    host: polluted,
  });
  assert.equal(obs.ok, false);
  assert.ok(obs.problems.some((p) => p.code === 'e09-host-polluted' && /navigator/.test(p.detail)));

  // Clean host still passes (hasNavigator false both sides).
  const clean = observeConsumer({
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['platform'],
      componentDetails: { platform: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    realm: pageRealm,
    componentErrors: [],
    e09: goodE09(),
    host: cleanHost(),
  });
  assert.equal(clean.ok, true);
});

test('TEST-Y06 H1: probe objectProtoDistinct=false when child shares page object prototype', async () => {
  // Probe-level (not observer field injection): plain jsdom iframe shares Object with page.
  const { JSDOM } = await import('jsdom');
  const {
    installIframeRealmProbe,
    computeObjectProtoDistinct,
    evaluateE09Problems,
  } = await import('../cases/fingerprintjs-local/lib/e09-iframe-realm.mjs');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/h1-same-proto',
  });
  const { window } = dom;
  assert.equal(
    computeObjectProtoDistinct(window, window),
    false,
    'same Realm must not count as object-distinct'
  );

  const probe = installIframeRealmProbe(window);
  const iframe = window.document.createElement('iframe');
  window.document.body.appendChild(iframe);
  assert.ok(iframe.contentWindow, 'jsdom iframe should expose contentWindow after append');
  assert.equal(
    computeObjectProtoDistinct(window, iframe.contentWindow),
    false,
    'plain jsdom child Frame shares page Object.prototype'
  );
  iframe.setAttribute('data-e09-h1', '1');
  await new Promise((r) => setTimeout(r, 20));

  const report = probe.getReport();
  assert.ok(report.capturedCount >= 1, JSON.stringify(report));
  const captured = report.samples.filter((s) => s.captured);
  assert.ok(
    captured.every((s) => s.objectProtoDistinct === false),
    `expected all samples objectProtoDistinct=false, got ${JSON.stringify(captured)}`
  );
  assert.equal(report.objectDistinctFromPage, false);
  assert.equal(report.objectDistinctCount, 0);

  const problems = evaluateE09Problems(
    {
      ...report,
      iframeCreateCount: Math.max(1, report.iframeCreateCount),
    },
    null,
    'page-script'
  );
  assert.ok(
    problems.some((p) => p.code === 'e09-object-realm-not-distinct'),
    JSON.stringify(problems)
  );

  try {
    dom.window.close();
  } catch {
    /* ignore */
  }
});

test('TEST-Y06 G1: observe fails when only objectProtoDistinct is false', async () => {
  const { observeConsumer } = await import('../cases/fingerprintjs-local/observe.mjs');
  const { collapseE09ObjectOnly } = await import(
    '../cases/fingerprintjs-local/lib/e09-iframe-realm.mjs'
  );
  const pageRealm = {
    load: { inPageRealm: true, inHostRealm: false },
    get: { inPageRealm: true, inHostRealm: false },
  };
  const injected = collapseE09ObjectOnly(goodE09());
  const obs = observeConsumer({
    mode: 'e09-object-collapse',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'deadbeef',
      components: ['platform'],
      componentDetails: { platform: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: false,
    loadPath: 'page-script',
    realm: pageRealm,
    componentErrors: [],
    e09: injected,
    host: cleanHost(),
  });
  assert.equal(obs.ok, false);
  assert.ok(obs.problems.some((p) => p.code === 'e09-object-realm-not-distinct'));
  assert.ok(!obs.problems.some((p) => p.code === 'e09-realm-not-distinct'));
});

test('TEST-Y06 F5/E09: iframe realm distinct + collapse injection fails', async () => {
  const { prepared } = prepareLiveAssets('e09');

  function runLocal(fault) {
    const childEnv = { ...process.env, NODE_PATH: '' };
    delete childEnv.NODE_TEST_CONTEXT;
    return spawnSync(
      process.execPath,
      [path.join(caseDir, 'run-local.mjs'), '--assets', prepared, '--fault', fault],
      { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv }
    );
  }

  const baselineRun = runLocal('baseline');
  assert.equal(baselineRun.status, 0, baselineRun.stderr || baselineRun.stdout);
  const baseline = JSON.parse(baselineRun.stdout);
  assert.ok(baseline.raw.e09, 'e09 report required');
  assert.ok(baseline.raw.e09.iframeCreateCount >= 1);
  assert.equal(baseline.raw.e09.childDistinctFromPage, true);
  assert.ok(baseline.raw.e09.distinctRealmCount >= 1);
  assert.equal(baseline.raw.host.after.hasWindow, false);
  assert.equal(baseline.raw.host.after.hasDocument, false);
  // G3: navigator must not be newly introduced (parallel to window/document).
  // Node may already expose navigator; then binding must stay identical.
  if (!baseline.raw.host.before.hasNavigator) {
    assert.equal(baseline.raw.host.after.hasNavigator, false);
  } else {
    assert.equal(baseline.raw.host.after.hasNavigator, true);
    assert.equal(baseline.raw.host.after.navigatorId, baseline.raw.host.before.navigatorId);
  }
  assert.equal(baseline.observation.ok, true);
  assert.ok(!baseline.observation.problems.some((p) => String(p.code).startsWith('e09-')));

  const collapseRun = runLocal('e09-collapse');
  assert.equal(collapseRun.status, 0, collapseRun.stderr || collapseRun.stdout);
  const collapse = JSON.parse(collapseRun.stdout);
  assert.equal(collapse.raw.e09.childDistinctFromPage, false);
  assert.equal(collapse.observation.ok, false);
  assert.ok(collapse.observation.problems.some((p) => p.code === 'e09-realm-not-distinct'));

  // G1: baseline must expose object distinct in pass path
  assert.equal(baseline.raw.e09.objectDistinctFromPage, true);
  assert.ok(baseline.raw.e09.objectDistinctCount >= 1);
  assert.equal(baseline.raw.e09.functionDistinctFromPage, true);

  // G1.2: function OK, object wrong → must fail with object-specific code
  const objCollapseRun = runLocal('e09-object-collapse');
  assert.equal(objCollapseRun.status, 0, objCollapseRun.stderr || objCollapseRun.stdout);
  const objCollapse = JSON.parse(objCollapseRun.stdout);
  assert.equal(objCollapse.raw.e09.functionDistinctFromPage, true);
  assert.equal(objCollapse.raw.e09.objectDistinctFromPage, false);
  assert.equal(objCollapse.raw.e09.objectCollapsed, true);
  assert.equal(objCollapse.observation.ok, false);
  assert.ok(
    objCollapse.observation.problems.some((p) => p.code === 'e09-object-realm-not-distinct'),
    JSON.stringify(objCollapse.observation.problems)
  );
  assert.ok(
    !objCollapse.observation.problems.some((p) => p.code === 'e09-realm-not-distinct'),
    'function-only path must not also raise function realm failure'
  );

  const selfCheck = fs.readFileSync(path.join(root, 'references', 'integration-self-check.md'), 'utf8');
  assert.match(selfCheck, /E09|子 Frame|iframe.*Realm/);
  assert.match(selfCheck, /objectProtoDistinct|对象\/原型/);

  fs.rmSync(prepared, { recursive: true, force: true });
});

test('TEST-Y06 boundary: local simulation must not claim website accept / bypass rate', async () => {
  const { observeConsumer } = await import('../cases/fingerprintjs-local/observe.mjs');

  const forced = observeConsumer({
    mode: 'baseline',
    loadedVersion: '5.2.0',
    result: {
      visitorId: 'abc',
      components: ['x'],
      componentDetails: { x: { status: 'ok', hasValue: true } },
    },
    completionReached: true,
    error: null,
    websiteAccepted: true,
    loadPath: 'page-script',
    realm: {
      load: { inPageRealm: true, inHostRealm: false },
      get: { inPageRealm: true, inHostRealm: false },
    },
    componentErrors: [],
    e09: goodE09(),
    host: cleanHost(),
  });
  assert.equal(forced.ok, false);
  assert.ok(forced.problems.some((p) => p.code === 'forbidden-website-accepted'));
  assert.equal(forced.websiteAccepted, false);
  assert.equal(forced.localSimulationOnly, true);
  assert.match(forced.note, /本地模拟通过\s*≠\s*真实网站接受/);
  assert.match(forced.note, /绕过率/);

  const corpus = collectBoundaryCorpus();
  for (const { file, text } of corpus) {
    const hasBoundary =
      /本地模拟通过\s*≠\s*真实网站接受|本地模拟≠网站接受|websiteAccepted|localSimulationOnly/.test(text) ||
      /不得.*网站接受|禁止.*网站接受|≠ 真实网站接受/.test(text) ||
      /real-website acceptance|not.*website accept/i.test(text);
    assert.ok(hasBoundary, `missing local≠website boundary in ${path.relative(root, file)}`);
    // Must not present bypass rate as a success metric / claim.
    assert.ok(
      !/绕过成功率\s*[≥>=]|bypass rate\s*[≥>=]|网站接受\s*=\s*true/i.test(text),
      `forbidden success-rate / websiteAccepted claim in ${path.relative(root, file)}`
    );
  }

  const method = fs.readFileSync(path.join(root, 'references', 'real-source-cases.md'), 'utf8');
  assert.match(method, /本地模拟通过 ≠ 真实网站接受/);
  assert.match(method, /绕过率/);
  // Positive pin of the forbid wording (not absence-only).
  assert.ok(/不得写绕过率|不得推导风控绕过率|不能推导风控绕过率|不得.*绕过率/.test(method + corpus.map((c) => c.text).join('\n')));
});
