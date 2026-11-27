'use strict';

import path from 'node:path';

/**
 * Minimal scorer helpers for TEST-Y05 (ruleVersion-aware).
 * Not a full eval harness — encodes scoring-rules.v1 gates.
 */

export const RULE_VERSION = 'scoring-rules/v1';

/**
 * @param {object} input
 * @param {string} [input.ruleVersion]
 * @param {boolean} [input.hasExecutionRecord]
 * @param {boolean} [input.locatedEnvDiff]
 * @param {boolean} [input.formalPathPass]
 * @param {boolean} [input.traceStubOnlyPass]
 * @param {boolean} [input.fixedContract]
 */
export function scoreAttempt(input) {
  const ruleVersion = input.ruleVersion || RULE_VERSION;
  const execution = input.hasExecutionRecord === true ? 1 : 0;
  const locate = input.locatedEnvDiff === true ? 1 : 0;
  const fix = input.fixedContract === true && input.formalPathPass === true ? 1 : 0;

  let complete = 0;
  if (input.formalPathPass === true && input.traceStubOnlyPass !== true) {
    complete = 1;
  }
  if (input.traceStubOnlyPass === true && input.formalPathPass !== true) {
    complete = 0;
  }

  return {
    ruleVersion,
    scores: { execution, locate, fix, complete },
    okGates: {
      noExecNoExecScore: !(input.hasExecutionRecord !== true && execution > 0),
      stubOnlyNoComplete: !(
        input.traceStubOnlyPass === true &&
        input.formalPathPass !== true &&
        complete > 0
      ),
    },
  };
}

/** Refuse to mix scores from different rule versions in one comparison table. */
export function canCompareScores(a, b) {
  if (!a || !b) return { ok: false, reason: 'missing-side' };
  if (a.ruleVersion !== b.ruleVersion) {
    return { ok: false, reason: 'rule-version-mismatch', left: a.ruleVersion, right: b.ruleVersion };
  }
  return { ok: true };
}

export function isUnderEvalsRoot(repoRoot, absPath) {
  const evals = path.resolve(repoRoot, 'evals');
  const resolved = path.resolve(absPath);
  return resolved === evals || resolved.startsWith(evals + path.sep);
}
