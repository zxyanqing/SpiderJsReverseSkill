'use strict';
/**
 * T-G5: 时间参数四类 + 生成时快照语义（可控调度，无长 sleep）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const TIME_KINDS = [
  'script-budget',
  'process-deadline',
  'completion-signal',
  'observation-window',
];

/**
 * Controllable scheduler: tasks are { at, run }; advance(virtualMs) drains due tasks.
 */
function createScheduler() {
  let now = 0;
  const tasks = [];
  return {
    now: () => now,
    schedule(delay, run) {
      tasks.push({ at: now + delay, run });
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at);
        if (due.length === 0) {
          now = target;
          break;
        }
        const next = due[0];
        now = next.at;
        const idx = tasks.indexOf(next);
        tasks.splice(idx, 1);
        next.run();
      }
    },
  };
}

test('T-G5: four time-parameter kinds are distinct labels', () => {
  assert.equal(TIME_KINDS.length, 4);
  assert.deepEqual(new Set(TIME_KINDS).size, 4);
  assert.ok(TIME_KINDS.includes('script-budget'));
  assert.ok(TIME_KINDS.includes('completion-signal'));
  assert.ok(TIME_KINDS.includes('observation-window'));
  // Fixed delay is not a correctness proof
  assert.notEqual('fixed-sleep-ms', TIME_KINDS[0]);
});

test('T-G5: extending observation window does not mutate saved generation snapshot', () => {
  const sched = createScheduler();
  let state = { token: 'GEN' };
  const generationSnapshot = { ...state };

  // Late rewrite after generation
  sched.schedule(50, () => {
    state = { token: 'LATE' };
  });

  // Extend observation window past the late task
  sched.advance(100);
  assert.equal(state.token, 'LATE');
  assert.equal(generationSnapshot.token, 'GEN');
  assert.notEqual(generationSnapshot.token, state.token);
});

test('T-G5: distinguishes timeout, late task, and cleanup paths', () => {
  function runScenario(kind) {
    const sched = createScheduler();
    const log = [];
    let result = null;
    let cleaned = false;
    const SCRIPT_BUDGET = 30;

    const onComplete = (value) => {
      if (result !== null) return;
      result = value;
      log.push('complete');
    };

    if (kind === 'timeout') {
      // Completion signal never fires within budget
      sched.schedule(100, () => onComplete('late-ok'));
      sched.advance(SCRIPT_BUDGET);
      if (result === null) log.push('timeout');
    } else if (kind === 'late-task') {
      // Result already taken; late task must not overwrite snapshot
      onComplete('gen');
      const snap = result;
      sched.schedule(10, () => {
        result = 'overwritten';
        log.push('late-task');
      });
      sched.advance(20);
      return { kind, snap, result, log, cleaned };
    } else if (kind === 'cleanup') {
      onComplete('gen');
      sched.schedule(5, () => {
        cleaned = true;
        log.push('cleanup');
      });
      sched.advance(10);
    }

    return { kind, result, log, cleaned };
  }

  const t = runScenario('timeout');
  assert.ok(t.log.includes('timeout'));
  assert.equal(t.result, null);

  const late = runScenario('late-task');
  assert.equal(late.snap, 'gen');
  assert.ok(late.log.includes('late-task'));
  // Policy under test: generation snapshot stays; live result may change — caller keeps snap
  assert.equal(late.snap, 'gen');
  assert.notEqual(late.snap, late.result);

  const c = runScenario('cleanup');
  assert.equal(c.result, 'gen');
  assert.equal(c.cleaned, true);
  assert.ok(c.log.includes('cleanup'));
  assert.ok(!c.log.includes('timeout'));
});
