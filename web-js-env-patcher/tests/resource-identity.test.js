'use strict';
/**
 * TEST-Y04: 复现身份关联（资源哈希／补丁修订／runtime·fixture·config／多子资源）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect, sha256File, normalizeIdentity } = require('../scripts/check_dynamic_resources');

function withCase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y04-'));
  try {
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'js', 'original'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeManifest(caseDir, obj) {
  fs.writeFileSync(
    path.join(caseDir, 'notes', 'resource-manifest.json'),
    JSON.stringify(obj, null, 2) + '\n'
  );
}

function writeFile(caseDir, rel, content) {
  const full = path.join(caseDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return sha256File(full);
}

test('TEST-Y04: same-URL content hash change is detected (not silent pass)', () => withCase((dir) => {
  const fileRel = 'js/original/app.js';
  writeFile(dir, fileRel, 'console.log("v1")\n');
  writeManifest(dir, {
    schemaVersion: 'resource-manifest/v1',
    identity: { patchRevision: { name: 'r0' } },
    resources: [
      {
        url: 'https://example.test/app.js',
        type: 'script',
        file: fileRel,
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        dynamic: false,
        use: 'static',
        requiredForFinal: true,
      },
    ],
  });
  const report = inspect(dir, { requireRuntimeRefresh: false, strict: true });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => /不匹配|不得静默通过/.test(p)));
  assert.notEqual(report.status, 'passed');
}));

test('TEST-Y04: patch-only revision does not impersonate resource/SDK identity', () => withCase((dir) => {
  const fileRel = 'js/original/sdk.js';
  const hash = writeFile(dir, fileRel, '/* sdk body stable */\n');
  const baseIdentity = {
    runtime: { node: 'v18.20.0', jsdom: '24.1.3' },
    fixture: { path: 'fixtures/sample.fixture.json', schema: 'env-fixture/v2' },
    patchRevision: { name: 'env-patch-r1', sha256: 'patchhash111' },
    config: { timezone: 'Asia/Shanghai' },
  };
  writeManifest(dir, {
    schemaVersion: 'resource-manifest/v1',
    identity: baseIdentity,
    resources: [
      {
        url: 'https://example.test/sdk.js',
        type: 'script',
        file: fileRel,
        sha256: hash,
        dynamic: false,
        use: 'static',
        requiredForFinal: true,
      },
    ],
  });
  const before = inspect(dir, { requireRuntimeRefresh: false });
  assert.equal(before.ok, true);
  assert.equal(before.resources[0].sha256, hash);

  // Only patch revision changes; resource bytes and sha stay the same.
  writeManifest(dir, {
    schemaVersion: 'resource-manifest/v1',
    identity: {
      ...baseIdentity,
      patchRevision: { name: 'env-patch-r2', sha256: 'patchhash222' },
    },
    resources: [
      {
        url: 'https://example.test/sdk.js',
        type: 'script',
        file: fileRel,
        sha256: hash,
        dynamic: false,
        use: 'static',
        requiredForFinal: true,
      },
    ],
  });
  const after = inspect(dir, { requireRuntimeRefresh: false });
  assert.equal(after.ok, true);
  assert.equal(after.resources[0].sha256, before.resources[0].sha256, 'resource identity unchanged');
  assert.notDeepEqual(after.identity.patchRevision, before.identity.patchRevision);
  assert.equal(after.identity.runtime.node, before.identity.runtime.node);
  assert.equal(after.identity.fixture.path, before.identity.fixture.path);
}));

test('TEST-Y04: runtime/fixture/config changes are trackable; incompatible sample not silently reusable', () => withCase((dir) => {
  const fileRel = 'js/original/app.js';
  const hash = writeFile(dir, fileRel, 'console.log(1)\n');
  writeManifest(dir, {
    identity: {
      runtime: { node: 'v18' },
      fixture: { path: 'fixtures/a.json' },
      config: { lang: 'zh-CN' },
      patchRevision: { name: 'r1' },
    },
    resources: [
      {
        url: 'https://example.test/app.js',
        type: 'script',
        file: fileRel,
        sha256: hash,
        dynamic: false,
        use: 'static',
        requiredForFinal: true,
        reusable: true,
      },
    ],
  });
  let report = inspect(dir, {});
  assert.equal(report.ok, true);
  assert.deepEqual(normalizeIdentity(report.identity).runtime, { node: 'v18' });

  writeManifest(dir, {
    identity: {
      runtime: { node: 'v20', jsdom: '24.1.3' },
      fixture: { path: 'fixtures/b.json', schema: 'env-fixture/v2' },
      config: { lang: 'en-US' },
      patchRevision: { name: 'r1' },
    },
    resources: [
      {
        url: 'https://example.test/app.js',
        type: 'script',
        file: fileRel,
        sha256: hash,
        dynamic: false,
        use: 'static',
        requiredForFinal: true,
        reusable: true,
      },
    ],
  });
  report = inspect(dir, {});
  assert.equal(report.identity.runtime.node, 'v20');
  assert.equal(report.identity.fixture.path, 'fixtures/b.json');
  assert.equal(report.identity.config.lang, 'en-US');

  // Content changed but still marked reusable → must fail (no silent reuse)
  writeFile(dir, fileRel, 'console.log("CHANGED")\n');
  report = inspect(dir, {});
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => /reusable|不得静默复用|不匹配/.test(p)));
}));

test('TEST-Y04: multiple dependent dynamic resources each have manifest entries', () => withCase((dir) => {
  const aRel = 'js/original/chunk-a.js';
  const bRel = 'js/original/chunk-b.js';
  const aHash = writeFile(dir, aRel, '/* a */\n');
  const bHash = writeFile(dir, bRel, '/* b */\n');
  writeManifest(dir, {
    identity: { runtime: { node: 'v18' }, patchRevision: { name: 'r1' } },
    resources: [
      {
        url: 'https://example.test/chunk-a.js',
        type: 'script',
        file: aRel,
        sha256: aHash,
        fetchedAt: '2026-11-25T00:00:00Z',
        dynamic: true,
        use: 'runtime-refresh',
        requiredForFinal: true,
        runtimeRefresh: true,
        refreshEntry: 'env/refresh.js',
      },
      {
        url: 'https://example.test/chunk-b.js',
        type: 'script',
        file: bRel,
        sha256: bHash,
        fetchedAt: '2026-11-25T00:00:01Z',
        dynamic: true,
        use: 'runtime-refresh',
        requiredForFinal: true,
        runtimeRefresh: true,
        refreshEntry: 'env/refresh.js',
      },
    ],
  });
  writeFile(dir, 'env/refresh.js', 'module.exports = {}\n');
  const report = inspect(dir, { requireRuntimeRefresh: true });
  assert.equal(report.resources.length, 2, 'must list both dependent resources, not only an entry script');
  assert.equal(report.dynamicCount, 2);
  assert.equal(report.requiredDynamicCount, 2);
  assert.ok(report.resources.every((r) => r.url && r.sha256 && r.file));
  assert.equal(report.ok, true);
}));
