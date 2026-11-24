'use strict';
/**
 * T-G4: Cookie 多次写入候选前缀试验（合成；非每项目门槛）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * RFC 6265–style path-match (minimal fixture):
 * cookie-path is a prefix of request-path, and either equal, cookie-path ends with '/',
 * or the next char of request-path is '/'.
 * So Path=/api matches /api and /api/x, but NOT /apix.
 */
function pathMatches(requestPath, cookiePath) {
  const p = cookiePath || '/';
  if (requestPath === p) return true;
  if (!requestPath.startsWith(p)) return false;
  if (p.endsWith('/')) return true;
  return requestPath.charAt(p.length) === '/';
}

/**
 * Minimal jar: name -> { value, path, httpOnly, deleted }
 * Visible cookie string for a request path (document.cookie style: no HttpOnly).
 */
function visibleCookieHeader(jar, requestPath, { includeHttpOnly = false } = {}) {
  const parts = [];
  for (const [name, meta] of Object.entries(jar)) {
    if (meta.deleted) continue;
    if (meta.httpOnly && !includeHttpOnly) continue;
    if (!pathMatches(requestPath, meta.path || '/')) continue;
    parts.push(`${name}=${meta.value}`);
  }
  return parts.sort().join('; ');
}

/** Apply ordered writes onto a jar (mutates a clone). */
function applyWrites(writes, baseJar) {
  const jar = cloneJar(baseJar || Object.create(null));
  for (const w of writes) {
    if (w.op === 'delete') {
      jar[w.name] = { deleted: true };
    } else {
      jar[w.name] = {
        value: w.value,
        path: w.path || '/',
        httpOnly: !!w.httpOnly,
        deleted: false,
      };
    }
  }
  return jar;
}

function cloneJar(jar) {
  const out = Object.create(null);
  for (const [name, meta] of Object.entries(jar || {})) {
    out[name] = { ...meta };
  }
  return out;
}

/** Candidate n = first n writes only (from empty client unless base provided). */
function candidatePrefix(allWrites, n, baseJar) {
  return applyWrites(allWrites.slice(0, n), baseJar);
}

/** Consumer accepts only if visible cookie equals expected (path /api). */
function consumerAccepts(jar, expectedVisible) {
  return visibleCookieHeader(jar, '/api') === expectedVisible;
}

test('T-G4: middle candidate accepted while final candidate rejected', () => {
  // ≥4 ordered writes; middle k (1<k<n) accepted; final rejected; first also rejected.
  const writes = [
    { op: 'set', name: 'sid', value: 'WRONG', path: '/' },
    { op: 'set', name: 'sid', value: 'A', path: '/' },
    { op: 'set', name: 'sid', value: 'BAD', path: '/' },
    { op: 'set', name: 'noise', value: '1', path: '/' },
  ];
  const n = writes.length;
  assert.ok(n >= 4);
  const expected = 'sid=A';
  const accepts = [];
  for (let i = 1; i <= n; i++) {
    accepts[i] = consumerAccepts(candidatePrefix(writes, i), expected);
  }
  assert.equal(accepts[1], false, 'first candidate must not be the sole success story');
  const middleHits = [];
  for (let k = 2; k <= n - 1; k++) {
    if (accepts[k]) middleHits.push(k);
  }
  assert.ok(middleHits.length >= 1, 'expected a middle candidate (1<k<n) to be accepted');
  assert.equal(accepts[n], false, 'final candidate must be rejected');
  // Must not imply "take last write only"
  const lastOnly = applyWrites([writes[writes.length - 1]]);
  assert.equal(consumerAccepts(lastOnly, expected), false);
});

test('T-G4: prefix includes delete and same-name overwrite', () => {
  const writes = [
    { op: 'set', name: 'tok', value: 'v1', path: '/' },
    { op: 'delete', name: 'tok' },
    { op: 'set', name: 'tok', value: 'v2', path: '/' },
  ];
  assert.equal(visibleCookieHeader(candidatePrefix(writes, 1), '/'), 'tok=v1');
  assert.equal(visibleCookieHeader(candidatePrefix(writes, 2), '/'), '');
  assert.equal(visibleCookieHeader(candidatePrefix(writes, 3), '/'), 'tok=v2');
});

test('T-G4: Path and HttpOnly scope', () => {
  const jar = applyWrites([
    { op: 'set', name: 'pub', value: '1', path: '/api' },
    { op: 'set', name: 'sec', value: '2', path: '/', httpOnly: true },
    { op: 'set', name: 'root', value: '3', path: '/' },
  ]);
  assert.equal(visibleCookieHeader(jar, '/api'), 'pub=1; root=3');
  assert.equal(visibleCookieHeader(jar, '/api/x'), 'pub=1; root=3');
  // /apix must NOT match Path=/api (startsWith alone would falsely match)
  assert.equal(visibleCookieHeader(jar, '/apix'), 'root=3');
  assert.ok(!visibleCookieHeader(jar, '/apix').includes('pub='));
  assert.equal(visibleCookieHeader(jar, '/other'), 'root=3');
  assert.equal(visibleCookieHeader(jar, '/api', { includeHttpOnly: true }), 'pub=1; root=3; sec=2');
  assert.ok(!visibleCookieHeader(jar, '/api').includes('sec='));
});

test('T-G4: post-navigation writes do not backfill prior candidate', () => {
  const preNav = [{ op: 'set', name: 'sid', value: 'PRE', path: '/' }];
  const candidateAtSubmit = candidatePrefix(preNav, 1);
  const postNavWrites = [{ op: 'set', name: 'sid', value: 'POST', path: '/' }];
  const afterNav = applyWrites([...preNav, ...postNavWrites]);
  assert.equal(visibleCookieHeader(candidateAtSubmit, '/'), 'sid=PRE');
  assert.equal(visibleCookieHeader(afterNav, '/'), 'sid=POST');
  assert.notEqual(
    visibleCookieHeader(candidateAtSubmit, '/'),
    visibleCookieHeader(afterNav, '/')
  );
});

test('T-G4: trials do not inherit prior client response pollution', () => {
  // Same server/initial cookie state cloned per trial
  const serverInitial = applyWrites([
    { op: 'set', name: 'seed', value: 'S', path: '/' },
  ]);
  const baseline1 = cloneJar(serverInitial);
  const baseline2 = cloneJar(serverInitial);
  assert.equal(visibleCookieHeader(baseline1, '/'), 'seed=S');
  assert.equal(visibleCookieHeader(baseline2, '/'), 'seed=S');

  // Trial 1: merge response pollution onto its own clone
  const trial1 = applyWrites(
    [{ op: 'set', name: 'pollute', value: 'P1', path: '/' }],
    baseline1
  );
  assert.ok(visibleCookieHeader(trial1, '/').includes('pollute=P1'));

  // Trial 2 MUST start from clean baseline2 (actually used), not trial1
  const trial2 = applyWrites(
    [{ op: 'set', name: 'b', value: '2', path: '/' }],
    baseline2
  );
  assert.equal(visibleCookieHeader(trial2, '/'), 'b=2; seed=S');
  assert.ok(!visibleCookieHeader(trial2, '/').includes('pollute='));
  // Prove baseline2 was the source: seed present, pollution absent
  assert.equal(baseline2.pollute, undefined);
  assert.equal(baseline2.seed.value, 'S');
  assert.notEqual(trial1, trial2);
});
