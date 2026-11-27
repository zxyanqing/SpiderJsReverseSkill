'use strict';

/**
 * Evidence Frame / world / lifecycle helpers (Y07 / I1).
 * Aligns with references/browser-evidence.md「取证上下文与生命周期身份」.
 * Consumed by tests and referenced from Hook / browser-evidence docs —
 * not a test-only stub.
 *
 * Identity rule (formal merge / same-lifecycle / default reuse):
 * - both sides non-empty valid AND equal → known-same (may proceed)
 * - both valid but unequal → known-different (forbid formal)
 * - either side missing / undefined / null (incl. both missing) → unknown
 *   → clue-only / refuse reuse / keep unknown; never treat "both unknown" as same
 */

/** Non-null, non-undefined, non-blank identity token. */
function isValidIdentityValue(v) {
  if (v == null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

/** Both valid and strictly equal. */
function identitiesMatch(a, b) {
  return isValidIdentityValue(a) && isValidIdentityValue(b) && a === b;
}

function sameFrameLabel(a, b) {
  return !!(a && b && identitiesMatch(a.frameId, b.frameId));
}

/**
 * Require every sample to carry the same valid identity for `field`.
 * @returns {{ ok: true, value: * } | { ok: false, reason: string, grade: string, values?: *[] }}
 */
function requireSharedIdentity(samples, field, mismatchReason) {
  const values = samples.map((s) => (s && s[field] !== undefined ? s[field] : undefined));
  if (!values.every(isValidIdentityValue)) {
    return {
      ok: false,
      reason: `incomplete-${field}`,
      grade: 'clue-only',
      values,
    };
  }
  const uniq = new Set(values);
  if (uniq.size > 1) {
    return {
      ok: false,
      reason: mismatchReason,
      grade: 'clue-only',
      values: [...uniq],
    };
  }
  return { ok: true, value: values[0] };
}

/** Merge same-name API evidence only when Frame / world / lifecycle identities match. */
function mergeSameApiEvidence(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const api = samples[0].api;
  if (!samples.every((s) => s.api === api)) {
    return { ok: false, reason: 'mixed-api' };
  }

  const frame = requireSharedIdentity(samples, 'frameId', 'cross-frame-unlabeled-mix');
  if (!frame.ok) {
    return frame.reason === 'incomplete-frameId'
      ? frame
      : { ...frame, frames: frame.values };
  }

  const world = requireSharedIdentity(samples, 'world', 'cross-world-mix');
  if (!world.ok) return world;

  // Lifecycle: navigationId must be present and consistent (url optional but if present must agree).
  const nav = requireSharedIdentity(samples, 'navigationId', 'cross-navigation-mix');
  if (!nav.ok) return nav;

  const urls = samples.map((s) => s.url);
  if (urls.some(isValidIdentityValue)) {
    const url = requireSharedIdentity(samples, 'url', 'cross-url-mix');
    if (!url.ok) return url;
  }

  return {
    ok: true,
    frameId: frame.value,
    world: world.value,
    navigationId: nav.value,
    values: samples.map((s) => s.value),
  };
}

/**
 * Same-lifecycle only when url / navigationId / frameId / world are ALL
 * valid and equal on both sides (J3). Both-missing ≠ same.
 */
function isCurrentLifecycleEvidence(sample, current) {
  if (!sample || !current) return false;
  if (!identitiesMatch(sample.url, current.url)) return false;
  if (!identitiesMatch(sample.navigationId, current.navigationId)) return false;
  if (!identitiesMatch(sample.frameId, current.frameId)) return false;
  if (!identitiesMatch(sample.world, current.world)) return false;
  return true;
}

/**
 * Structured cross-Frame / cross-world reuse permit (K3).
 * True only when attested===true AND allowCrossContext===true.
 * `conditions` text never grants or vetoes (audit/notes only).
 */
function hasCrossContextAttestation(equivalence) {
  return (
    !!equivalence &&
    equivalence.attested === true &&
    equivalence.allowCrossContext === true
  );
}

function canReuseAfterRefresh(oldSample, current, equivalence) {
  if (isCurrentLifecycleEvidence(oldSample, current)) {
    return { reuse: true, reason: 'same-lifecycle' };
  }
  // Incomplete identity → refuse affirmative reuse (incl. both-missing).
  if (
    !isValidIdentityValue(oldSample && oldSample.navigationId) ||
    !isValidIdentityValue(current && current.navigationId) ||
    !isValidIdentityValue(oldSample && oldSample.url) ||
    !isValidIdentityValue(current && current.url) ||
    !isValidIdentityValue(oldSample && oldSample.frameId) ||
    !isValidIdentityValue(current && current.frameId) ||
    !isValidIdentityValue(oldSample && oldSample.world) ||
    !isValidIdentityValue(current && current.world)
  ) {
    return {
      reuse: false,
      reason: 'incomplete-lifecycle-identity',
      grade: 'clue-only',
    };
  }

  const sameFrame = identitiesMatch(oldSample.frameId, current.frameId);
  const sameWorld = identitiesMatch(oldSample.world, current.world);
  const crossContext = !sameFrame || !sameWorld;

  if (!equivalence || equivalence.attested !== true) {
    return {
      reuse: false,
      reason: crossContext ? 'cross-context-default-reject' : 'stale-lifecycle-default-reject',
    };
  }
  if (oldSample.url !== current.url) {
    return { reuse: false, reason: 'url-mismatch' };
  }
  // Same URL but different Frame/world: require explicit cross-context attestation.
  if (crossContext && !hasCrossContextAttestation(equivalence)) {
    return {
      reuse: false,
      reason: 'cross-context-unattested',
      grade: 'clue-only',
    };
  }
  return {
    reuse: true,
    reason: 'conditional-reuse',
    conditions: equivalence.conditions || [],
  };
}

/**
 * Collection window covers the target execution phase.
 * Accepts:
 *   - string `'covers'`
 *   - `{ knownValid: true, coversTargetPhase: true }`
 * Missing / `'unknown'` / non-covering → false.
 */
function isCollectionWindowCovering(collectionWindow) {
  if (collectionWindow === 'covers') return true;
  if (collectionWindow && typeof collectionWindow === 'object') {
    return (
      collectionWindow.knownValid === true && collectionWindow.coversTargetPhase === true
    );
  }
  return false;
}

/**
 * Interpret "no call observed" (J2 / K2):
 * proveAbsence:true only when ALL hold:
 *   - hits is a known numeric zero (Number.isFinite(hits) && hits === 0)
 *   - observer/hook installed
 *   - frameId/world/expected* all valid and matching (both-missing ≠ match)
 *   - possiblyCapped === false
 *   - collection window known valid and covers target phase
 * Missing / null / NaN / negative / non-numeric hits → inconclusive (context
 * / window / cap / observer cannot substitute for a known zero count).
 */
function interpretNoObservation({
  hits,
  possiblyCapped,
  world,
  expectedWorld,
  frameId,
  expectedFrameId,
  hookInstalled,
  observerInstalled,
  collectionWindow,
  observationWindow,
}) {
  if (Number.isFinite(hits) && hits > 0) return { kind: 'observed', hits };
  if (!(Number.isFinite(hits) && hits === 0)) {
    return { kind: 'inconclusive-unknown-hits', proveAbsence: false };
  }

  const observerOn = hookInstalled === true || observerInstalled === true;
  if (!observerOn) {
    return { kind: 'inconclusive-no-observer', proveAbsence: false };
  }

  const windowSpec =
    collectionWindow !== undefined ? collectionWindow : observationWindow;
  if (!isCollectionWindowCovering(windowSpec)) {
    return { kind: 'inconclusive-collection-window', proveAbsence: false };
  }

  if (possiblyCapped === true || possiblyCapped === 'unknown') {
    return { kind: 'inconclusive-truncated', proveAbsence: false };
  }
  if (possiblyCapped !== false) {
    return { kind: 'inconclusive-unknown-cap', proveAbsence: false };
  }

  const frameOk = identitiesMatch(frameId, expectedFrameId);
  const worldOk = identitiesMatch(world, expectedWorld);
  if (!frameOk || !worldOk) {
    const incomplete =
      !isValidIdentityValue(frameId) ||
      !isValidIdentityValue(expectedFrameId) ||
      !isValidIdentityValue(world) ||
      !isValidIdentityValue(expectedWorld);
    return {
      kind: incomplete ? 'inconclusive-incomplete-context' : 'wrong-context',
      proveAbsence: false,
    };
  }

  return { kind: 'not-executed', proveAbsence: true };
}

/**
 * Model cleanup that only clears the cleaned realm/control.
 * Other realms keep hookInstalled / buffer (browser-evidence cleanup boundary).
 */
function afterCleanup({ realms, cleanedRealmId }) {
  const next = {};
  for (const [id, state] of Object.entries(realms || {})) {
    if (id === cleanedRealmId) {
      next[id] = {
        ...state,
        hookInstalled: false,
        buffer: [],
        uninstalled: true,
      };
    } else {
      next[id] = { ...state };
    }
  }
  return next;
}

/**
 * Formal acceptance requires proven absence of diagnostic hooks on that path.
 * Missing control / unknown patches / unknown uninstall must NOT report ready (J4).
 */
function formalPathReady(realmState) {
  if (!realmState || typeof realmState !== 'object') return false;
  if (realmState.hookInstalled !== false) return false;
  // Model path: attested uninstall after cleanup.
  if (realmState.uninstalled === true) return true;
  // Live control path: empty patches array must be known (patchesKnown), not merely
  // "uninstall exists" — incomplete handles cannot fake readiness via controlPresent.
  if (realmState.controlPresent === true && realmState.patchesKnown === true) return true;
  return false;
}

/**
 * Derive realm hook state from a real generate_hook_templates control handle (J4).
 * - control == null / non-object → unknown, not ready
 * - uninstall present but patches not an array → cannot prove uninstall (hookInstalled null)
 * - patches array length>0 → installed
 * - patches array length===0 + callable uninstall → uninstalled (may be formal-ready)
 */
function realmStateFromHookControl(control, extra = {}) {
  const buffer = extra.buffer ? [...extra.buffer] : [];
  if (!control || typeof control !== 'object') {
    return {
      hookInstalled: null,
      buffer,
      controlPresent: false,
      patchesKnown: false,
    };
  }
  const hasUninstall = typeof control.uninstall === 'function';
  const patchesKnown = Array.isArray(control.patches);
  if (!patchesKnown) {
    return {
      hookInstalled: null,
      buffer,
      controlPresent: hasUninstall,
      patchesKnown: false,
    };
  }
  return {
    hookInstalled: control.patches.length > 0,
    buffer,
    controlPresent: hasUninstall,
    patchesKnown: true,
  };
}

/**
 * Annotate a raw sample with required context fields (Frame / world / lifecycle / hook).
 * Missing fields stay explicit null so callers cannot silently upgrade grade.
 */
function annotateEvidenceSample(sample, ctx = {}) {
  const out = { ...(sample || {}) };
  out.frameId = ctx.frameId != null ? ctx.frameId : out.frameId != null ? out.frameId : null;
  out.world = ctx.world != null ? ctx.world : out.world != null ? out.world : null;
  out.navigationId =
    ctx.navigationId != null
      ? ctx.navigationId
      : out.navigationId != null
        ? out.navigationId
        : null;
  out.url = ctx.url != null ? ctx.url : out.url != null ? out.url : null;
  out.hookInstalled =
    ctx.hookInstalled != null
      ? ctx.hookInstalled
      : out.hookInstalled != null
        ? out.hookInstalled
        : null;
  out.possiblyCapped =
    ctx.possiblyCapped != null
      ? ctx.possiblyCapped
      : out.possiblyCapped != null
        ? out.possiblyCapped
        : null;
  return out;
}

module.exports = {
  isValidIdentityValue,
  identitiesMatch,
  sameFrameLabel,
  mergeSameApiEvidence,
  isCurrentLifecycleEvidence,
  hasCrossContextAttestation,
  canReuseAfterRefresh,
  isCollectionWindowCovering,
  interpretNoObservation,
  afterCleanup,
  formalPathReady,
  realmStateFromHookControl,
  annotateEvidenceSample,
};
