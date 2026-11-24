'use strict';
/**
 * T-G7: 脚本排除实验 — 可执行合成页（依赖 / 无关 / 提交）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Synthetic page units:
 * - init: sets window.__ready
 * - noise: unrelated side effect
 * - submit: writes window.__result from __ready
 */
const UNITS = {
  init() {
    return { ready: true };
  },
  noise(state) {
    return { ...state, noise: (state.noise || 0) + 1 };
  },
  submit(state) {
    if (!state.ready) return { ...state, result: null };
    return { ...state, result: 'OK:' + (state.noise || 0) };
  },
};

function runPage(skip = null) {
  let state = { ready: false, noise: 0, result: undefined };
  const order = ['init', 'noise', 'submit'];
  for (const name of order) {
    if (name === skip) continue;
    state = UNITS[name](state);
  }
  return state;
}

function decideExclusion(baseline, trial, { comparable }) {
  if (!comparable) return { action: 'keep-full-execution', reason: 'control-unclear' };
  if (trial.result !== baseline.result) {
    // If skip caused missing or different result vs task goal, keep full unless proving irrelevance
    return { action: 'keep-full-execution', reason: 'result-changed' };
  }
  return { action: 'skip-ok', reason: 'result-preserved' };
}

test('T-G7: synthetic page has init, noise, and submit units', () => {
  const full = runPage(null);
  assert.equal(full.ready, true);
  assert.equal(full.result, 'OK:1');
  assert.equal(typeof UNITS.init, 'function');
  assert.equal(typeof UNITS.noise, 'function');
  assert.equal(typeof UNITS.submit, 'function');
});

test('T-G7: skipping init yields consumer/state difference', () => {
  const full = runPage(null);
  const noInit = runPage('init');
  assert.equal(full.ready, true);
  assert.equal(noInit.ready, false);
  assert.equal(full.result, 'OK:1');
  assert.equal(noInit.result, null);
  assert.notEqual(noInit.result, full.result);
});

test('T-G7: skipping noise preserves target result', () => {
  const full = runPage(null);
  const noNoise = runPage('noise');
  // Task goal: result token presence/shape; noise only changes counter inside OK:*
  // For this synthetic task, define goal as ready+non-null result from submit.
  assert.equal(full.ready, true);
  assert.equal(noNoise.ready, true);
  assert.ok(full.result && full.result.startsWith('OK:'));
  assert.ok(noNoise.result && noNoise.result.startsWith('OK:'));
  // Relative to task goal "submit produces OK:*", noise skip still succeeds
  assert.equal(noNoise.result, 'OK:0');
  const decision = decideExclusion(
    { result: 'OK:*' },
    { result: noNoise.result.startsWith('OK:') ? 'OK:*' : noNoise.result },
    { comparable: true }
  );
  assert.equal(decision.action, 'skip-ok');
});

test('T-G7: skipping submit yields missing result', () => {
  const full = runPage(null);
  const noSubmit = runPage('submit');
  assert.equal(full.result, 'OK:1');
  assert.equal(noSubmit.result, undefined);
  assert.notEqual(noSubmit.result, full.result);
});

test('T-G7: unclear control → keep full execution', () => {
  const baseline = runPage(null);
  const trial = runPage('noise');
  const decision = decideExclusion(baseline, trial, { comparable: false });
  assert.equal(decision.action, 'keep-full-execution');
  assert.equal(decision.reason, 'control-unclear');
});
