'use strict';
const { isDeepStrictEqual } = require('node:util');
const own = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
function invalid(message) { const e = new TypeError(`fixture: ${message}`); e.code = 'ERR_FIXTURE'; throw e; }
function normalizeFixture(fixture = {}, overrides = {}) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) invalid('root must be an object');
  if (fixture.schemaVersion !== undefined && fixture.schemaVersion !== 'env-fixture/v2') invalid(`unsupported schemaVersion: ${fixture.schemaVersion}`);
  const versioned = fixture.schemaVersion === 'env-fixture/v2';
  for (const key of ['browser','browserSources','request','runtime']) {
    if (fixture[key] != null && (typeof fixture[key] !== 'object' || Array.isArray(fixture[key]))) invalid(`${key} must be an object or null`);
  }
  if (fixture.entry != null && typeof fixture.entry !== 'string') invalid('entry must be a string or null');
  const fields = ['output','param'].filter(k => fixture[k] != null);
  for (const k of fields) if (typeof fixture[k] !== 'string') invalid(`${k} must be a field name string`);
  if (fields.length === 2 && fixture.output !== fixture.param) invalid('output and legacy param conflict');
  const field = overrides.field ?? fixture.output ?? fixture.param ?? '';
  for (const k of ['input', 'args']) if (fixture[k] != null && !Array.isArray(fixture[k])) invalid(`${k} must be a positional argument array; wrap an object in [object]`);
  if (fixture.input != null && fixture.args != null && !isDeepStrictEqual(fixture.input, fixture.args)) invalid('input and legacy args conflict');
  if (overrides.args !== undefined && !Array.isArray(overrides.args)) invalid('--args must be a JSON array');
  const args = overrides.args ?? fixture.input ?? fixture.args ?? [];
  const argsKnown = overrides.args !== undefined || fixture.input != null || fixture.args != null || !versioned;
  let expected; let expectedPath = ''; let expectedKnown = false;
  if (own(fixture, 'expected')) { expected = fixture.expected; expectedPath = 'expected'; expectedKnown = true; }
  if (own(fixture, 'expectedValue')) {
    const legacy = field ? { [field]: fixture.expectedValue } : fixture.expectedValue;
    if (expectedKnown && !isDeepStrictEqual(field ? expected?.[field] : expected, fixture.expectedValue)) invalid('expected and legacy expectedValue conflict');
    if (!expectedKnown) { expected = legacy; expectedPath = 'expectedValue'; expectedKnown = true; }
  }
  if (!expectedKnown && fixture.observedOutput != null) {
    expected = fixture.observedOutput; expectedPath = 'observedOutput'; expectedKnown = true;
  }
  return { fixture, version: versioned ? 'env-fixture/v2' : 'legacy-unversioned',
    entry: overrides.entry ?? fixture.entry ?? '', field, args, argsKnown, expected, expectedPath, expectedKnown };
}
module.exports = { normalizeFixture };
