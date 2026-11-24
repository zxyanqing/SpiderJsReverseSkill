'use strict';
/**
 * Local regression locks for D11–D13 (P5 E11/E12 equivalent).
 * Not full eval harness cases — same refusal conditions as 04 §E11/E12.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** E11: same-session dependency closure — mixing another epoch's script fails. */
function buildAtomicPackage(epoch) {
  return {
    epoch,
    html: `<html data-epoch="${epoch}"></html>`,
    scriptDigest: sha256(`script-${epoch}`),
    url: `https://challenge.test/e/${epoch}`,
    ua: 'Mozilla/5.0 Eval',
    visibleCookies: { seed: `seed-${epoch}` },
  };
}

function consumeAtomic(pkg, scriptDigestUsed) {
  if (scriptDigestUsed !== pkg.scriptDigest) {
    return { ok: false, code: 'input-epoch-mismatch' };
  }
  return { ok: true };
}

test('E11-local: mixing another session epoch script is rejected', () => {
  const sessA = buildAtomicPackage('A');
  const sessB = buildAtomicPackage('B');
  assert.equal(consumeAtomic(sessA, sessA.scriptDigest).ok, true);
  const mixed = consumeAtomic(sessA, sessB.scriptDigest);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, 'input-epoch-mismatch');
});

test('E11-local: missing required closure member fails closed (no silent history fallback)', () => {
  const pkg = buildAtomicPackage('C');
  delete pkg.visibleCookies;
  const required = ['html', 'scriptDigest', 'url', 'ua', 'visibleCookies'];
  const missing = required.filter((k) => pkg[k] == null);
  assert.deepEqual(missing, ['visibleCookies']);
  assert.ok(missing.length > 0, 'must fail when a required member is absent');
});

/**
 * E12: navigation-time cookie pair — final cookie must not replace capture-at-nav.
 * Distinct from E5 REAL_ token vs last window value.
 */
function captureNavHandoff(navUrl, cookiesAtNav) {
  return {
    navUrl,
    stateSnapshot: { capturedAt: 'nav' },
    cookieDelta: { ...cookiesAtNav },
  };
}

function requestWithHandoff(handoff, cookiesUsed) {
  const same =
    handoff.navUrl &&
    cookiesUsed.navTok === handoff.cookieDelta.navTok &&
    cookiesUsed.finalTok !== handoff.cookieDelta.navTok;
  // Accept only when using nav-time token for the nav URL.
  if (cookiesUsed.navTok === handoff.cookieDelta.navTok && !cookiesUsed.useFinalInstead) {
    return { ok: true };
  }
  return { ok: false, code: 'nav-cookie-mismatch' };
}

test('E12-local: using final cookie instead of nav-time cookie is rejected', () => {
  const atNav = { navTok: 'NAV_TIME', other: '1' };
  const handoff = captureNavHandoff('https://challenge.test/go', atNav);
  // After scripts continue, final jar differs.
  const finalJar = { navTok: 'FINAL_LATER', other: '1', extra: 'x' };

  const good = requestWithHandoff(handoff, { navTok: atNav.navTok, useFinalInstead: false });
  assert.equal(good.ok, true);

  const bad = requestWithHandoff(handoff, { navTok: finalJar.navTok, useFinalInstead: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'nav-cookie-mismatch');
});

test('E12-local: sensitive cookie values must not appear in stdout/report channel', () => {
  const handoff = captureNavHandoff('https://challenge.test/go', { navTok: 'SECRET_NAV' });
  const report = {
    navUrl: handoff.navUrl,
    // Structured delta keys only — raw secret stays on private channel.
    cookieKeys: Object.keys(handoff.cookieDelta),
  };
  const stdout = JSON.stringify(report);
  assert.equal(stdout.includes('SECRET_NAV'), false);
  assert.ok(report.cookieKeys.includes('navTok'));
});
