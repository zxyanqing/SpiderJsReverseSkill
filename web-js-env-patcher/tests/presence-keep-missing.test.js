'use strict';
/**
 * T-G3: 不存在 vs 自有 undefined；诊断不得把缺失补成占位后当基线。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

function classifyPresence(obj, key) {
  const hasOwn = Object.prototype.hasOwnProperty.call(obj, key);
  const inObj = key in obj;
  let value;
  let threw = false;
  try {
    value = obj[key];
  } catch (e) {
    threw = true;
  }
  if (!inObj && !hasOwn) return { kind: 'absent', hasOwn, inObj, value: undefined, threw };
  if (hasOwn && value === undefined && !threw) return { kind: 'own-undefined', hasOwn, inObj, value, threw };
  return { kind: 'present', hasOwn, inObj, value, threw };
}

/** Bad diagnostic path: forge placeholder for absent props (over-exposure). */
function overExpose(obj, key) {
  if (!(key in obj)) {
    Object.defineProperty(obj, key, { configurable: true, enumerable: true, value: undefined });
  }
  return obj;
}

/** Correct keep-missing: leave absent props untouched. */
function keepMissing(obj) {
  return obj;
}

test('T-G3: absent property vs own undefined are distinguishable', () => {
  const a = {};
  const b = {};
  Object.defineProperty(b, 'deviceMemory', { configurable: true, enumerable: true, value: undefined });

  const ca = classifyPresence(a, 'deviceMemory');
  const cb = classifyPresence(b, 'deviceMemory');
  assert.equal(ca.kind, 'absent');
  assert.equal(cb.kind, 'own-undefined');
  assert.notEqual(ca.kind, cb.kind);
  assert.equal('deviceMemory' in a, false);
  assert.equal('deviceMemory' in b, true);
  assert.equal(Object.prototype.hasOwnProperty.call(b, 'deviceMemory'), true);
});

test('T-G3: keep-missing does not invent placeholder; over-expose would', () => {
  const baseline = {};
  const kept = keepMissing({ ...baseline });
  assert.equal(classifyPresence(kept, 'chrome').kind, 'absent');
  assert.equal('chrome' in kept, false);

  const exposed = overExpose({}, 'chrome');
  assert.equal(classifyPresence(exposed, 'chrome').kind, 'own-undefined');
  assert.equal('chrome' in exposed, true);
  // Over-exposure must not be treated as an uninstrumented baseline.
  assert.notEqual(classifyPresence(exposed, 'chrome').kind, 'absent');
});

test('T-G3: diagnostic path must choose keep-missing when reference lacks the property', () => {
  const referenceHas = false; // browser reference: property absent
  const local = {};
  const decision = referenceHas ? 'implement' : 'keep-missing';
  assert.equal(decision, 'keep-missing');
  if (decision === 'keep-missing') {
    keepMissing(local);
  } else {
    overExpose(local, 'deviceMemory');
  }
  assert.equal(classifyPresence(local, 'deviceMemory').kind, 'absent');
});
