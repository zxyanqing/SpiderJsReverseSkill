'use strict';
function compare(fixture, actual) {
  const problems = [];
  for (const key of Object.keys(fixture || {})) {
    if (actual[key] !== fixture[key]) problems.push(`mismatch:${key}`);
  }
  return { ok: problems.length === 0, problems, status: problems.length ? 'failed' : 'passed' };
}
module.exports = { compare, requiredKeys: ['sign', 'ts'] };
