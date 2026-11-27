'use strict';
/**
 * TEST-Y05: 独立评测资产（路径／隔离／过程／正式路径／可比性／题型覆盖）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const evalsRoot = path.join(root, 'evals');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function listScenarioIds() {
  return fs
    .readdirSync(path.join(evalsRoot, 'scenarios'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

test('TEST-Y05 path: assets live under $M/evals and not M-external root', () => {
  assert.ok(fs.existsSync(evalsRoot));
  assert.ok(fs.existsSync(path.join(evalsRoot, 'README.md')));
  assert.ok(fs.existsSync(path.join(evalsRoot, 'catalog.yaml')));
  assert.ok(fs.existsSync(path.join(evalsRoot, 'scoring-rules.v1.md')));
  // Forbidden sibling evals outside package
  const external = path.resolve(root, '..', 'evals');
  // If it exists it must not be our delivery root; delivery must be under $M/evals
  for (const id of listScenarioIds()) {
    const ws = path.join(evalsRoot, 'scenarios', id, 'workspace');
    assert.ok(fs.existsSync(ws), `missing workspace for ${id}`);
    assert.ok(ws.startsWith(evalsRoot + path.sep));
  }
  assert.equal(path.basename(evalsRoot), 'evals');
  assert.equal(path.dirname(evalsRoot), root);
  void external;
});

test('TEST-Y05 stage pack: hides fault keys from AGENT_WS (prep only, not isolation)', () => {
  const id = 'E01';
  const out = path.join(os.tmpdir(), `y05-stage-${process.pid}-${Date.now()}`);
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'stage_eval_agent_workspace.mjs'), '--id', id, '--out', out],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(fs.existsSync(path.join(out, 'prompt.md')));
  assert.ok(fs.existsSync(path.join(out, 'workspace')));
  assert.ok(fs.existsSync(path.join(out, 'AGENT_PACK.json')));
  assert.ok(!fs.existsSync(path.join(out, 'hidden')));
  assert.ok(!fs.existsSync(path.join(out, 'case.yaml')));
  const walk = (dir, acc = []) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, acc);
      else acc.push(path.relative(out, full));
    }
    return acc;
  };
  const files = walk(out).join('\n').toLowerCase();
  assert.ok(!files.includes('fault.yaml'));
  assert.ok(!files.includes(`${path.sep}graders${path.sep}`) && !/graders\//.test(files));
  assert.ok(!files.includes('scoring-rules'));
  // Hidden keys still exist for graders, just not in agent pack
  assert.ok(fs.existsSync(path.join(evalsRoot, 'hidden', id, 'fault.yaml')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('TEST-Y05 process/formal/comparability gates in scoring-rules.v1', async () => {
  const { scoreAttempt, canCompareScores, RULE_VERSION } = await import('../evals/lib/score.mjs');

  const noExec = scoreAttempt({
    hasExecutionRecord: false,
    locatedEnvDiff: true,
    formalPathPass: true,
    fixedContract: true,
  });
  assert.equal(noExec.scores.execution, 0);
  assert.equal(noExec.okGates.noExecNoExecScore, true);

  const stubOnly = scoreAttempt({
    hasExecutionRecord: true,
    locatedEnvDiff: true,
    fixedContract: true,
    traceStubOnlyPass: true,
    formalPathPass: false,
  });
  assert.equal(stubOnly.scores.complete, 0);
  assert.equal(stubOnly.okGates.stubOnlyNoComplete, true);

  const formal = scoreAttempt({
    hasExecutionRecord: true,
    locatedEnvDiff: true,
    fixedContract: true,
    formalPathPass: true,
    traceStubOnlyPass: false,
  });
  assert.equal(formal.scores.complete, 1);
  assert.equal(formal.ruleVersion, RULE_VERSION);

  const mix = canCompareScores(
    { ruleVersion: 'scoring-rules/v1', scores: formal.scores },
    { ruleVersion: 'scoring-rules/v2', scores: formal.scores }
  );
  assert.equal(mix.ok, false);
  assert.equal(mix.reason, 'rule-version-mismatch');

  const same = canCompareScores(
    { ruleVersion: RULE_VERSION, scores: formal.scores },
    { ruleVersion: RULE_VERSION, scores: noExec.scores }
  );
  assert.equal(same.ok, true);

  const rules = read('evals/scoring-rules.v1.md');
  assert.match(rules, /scoring-rules\/v1/);
  assert.match(rules, /无执行记录|执行分/);
  assert.match(rules, /正式路径/);
  assert.match(rules, /禁止.*混|不得.*混/);
});

test('TEST-Y05 catalog covers multiple env fault classes from 02', () => {
  const catalog = read('evals/catalog.yaml');
  const idMap = read('evals/hidden/public-id-map.yaml');
  const ids = listScenarioIds();
  assert.ok(ids.length >= 4, `expected several scenarios, got ${ids.length}`);
  // Public catalog uses neutral ids only (no fault-class directory names).
  for (const leak of [
    'descriptor-wrong',
    'cookie-path-visibility',
    'async-boundary',
    'fixture-truncated',
    'wasm-import-missing',
    'hook-side-effect',
    'realm-child',
  ]) {
    assert.ok(!ids.includes(leak), `public scenario id still leaky: ${leak}`);
    assert.ok(!catalog.includes(`id: ${leak}`), `catalog still lists leaky id ${leak}`);
  }
  assert.ok(ids.includes('E01') && ids.includes('E07'));
  const requiredClasses = [
    'descriptor',
    'Cookie Path',
    '异步',
    'fixture',
    'WASM',
    'Hook',
    'Realm',
  ];
  for (const c of requiredClasses) {
    assert.ok(idMap.includes(c) || idMap.toLowerCase().includes(c.toLowerCase()), `hidden id-map missing class: ${c}`);
  }
  for (const id of ids) {
    assert.ok(/^E\d{2}$/.test(id), `scenario id not neutral: ${id}`);
    assert.ok(fs.existsSync(path.join(evalsRoot, 'scenarios', id, 'prompt.md')));
    assert.ok(fs.existsSync(path.join(evalsRoot, 'hidden', id, 'fault.yaml')));
    assert.ok(fs.existsSync(path.join(evalsRoot, 'hidden', id, 'graders')));
  }
  assert.ok(fs.existsSync(path.join(evalsRoot, 'compare-protocol.md')));
  assert.ok(fs.existsSync(path.join(evalsRoot, 'isolation.md')));
  assert.ok(fs.existsSync(path.join(evalsRoot, 'BOUNDARY.md')));
});

test('TEST-Y05 F1.3: staged packs and public paths have no leak phrases / leaky ids', async () => {
  const { scanAgentPackDir, scanText, LEAKY_PUBLIC_IDS } = await import('../evals/lib/leak-scan.mjs');
  const ids = listScenarioIds();
  assert.ok(ids.length >= 7);
  const allHits = [];

  for (const id of ids) {
    assert.ok(/^E\d{2}$/.test(id), `leaky or non-neutral scenario dir: ${id}`);
    assert.ok(!LEAKY_PUBLIC_IDS.includes(id));

    const out = path.join(os.tmpdir(), `y05-leak-${id}-${process.pid}-${Date.now()}`);
    if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'stage_eval_agent_workspace.mjs'), '--id', id, '--out', out],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const hits = scanAgentPackDir(out);
    const pack = JSON.parse(fs.readFileSync(path.join(out, 'AGENT_PACK.json'), 'utf8'));
    hits.push(...scanText(JSON.stringify(pack), `${id}/AGENT_PACK.json`));
    assert.equal(pack.scenarioId, id);
    assert.ok(/^E\d{2}$/.test(pack.scenarioId));
    assert.ok(!LEAKY_PUBLIC_IDS.includes(pack.scenarioId));
    for (const h of hits) allHits.push({ id, ...h });
    fs.rmSync(out, { recursive: true, force: true });
  }

  const catalogHits = scanText(read('evals/catalog.yaml'), 'evals/catalog.yaml');
  allHits.push(...catalogHits.map((h) => ({ id: 'catalog', ...h })));

  assert.deepEqual(allHits, [], `leak hits: ${JSON.stringify(allHits)}`);
});

test('TEST-Y05 F2.2 / I2 / J1 / K1: allow-list denies home+/private/tmp+os.tmpdir answers (main+child+symlink)', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('sandbox-exec only on darwin');
    return;
  }
  // Prefer /private/tmp workRoot so sibling os.tmpdir() answers are clearly outside work tree.
  const workRoot = fs.mkdtempSync(path.join('/private/tmp', 'y05-iso-'));
  // Home external answer — denied by allow-list (not via deny-list entry).
  const externalDir = fs.mkdtempSync(path.join(os.homedir(), 'y05-ext-answer-'));
  const externalFile = path.join(externalDir, 'fault-copy.yaml');
  const faultBytes = fs.readFileSync(path.join(evalsRoot, 'hidden', 'E01', 'fault.yaml'));
  fs.writeFileSync(externalFile, faultBytes);
  // Non-/Users answer under /private/tmp — C/J1 anti-example.
  const privateTmpFile = path.join(
    '/private/tmp',
    `y05-private-tmp-answer-${process.pid}-${Date.now()}.yaml`
  );
  fs.writeFileSync(privateTmpFile, faultBytes);
  // Outside-workRoot os.tmpdir()/var/folders sibling — C-F5-01 / K1 anti-example.
  const systemTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'y05-system-tmp-answer-'));
  const systemTmpFile = path.join(systemTmpDir, 'fault-copy.yaml');
  fs.writeFileSync(systemTmpFile, faultBytes);
  try {
    const env = {
      ...process.env,
      EVAL_EXTERNAL_ANSWER_HINT: externalFile,
      EVAL_PRIVATE_TMP_ANSWER_HINT: privateTmpFile,
      EVAL_SYSTEM_TMP_ANSWER_HINT: systemTmpFile,
    };
    delete env.EVAL_EXTRA_DENY_READ; // must not rely on per-copy deny list
    const r = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts', 'run_eval_agent_isolated.mjs'),
        '--skill-root',
        root,
        '--work-root',
        workRoot,
        '--scenario',
        'E01',
        '--',
        process.execPath,
        path.join(workRoot, 'SKILL_CLEAN', 'evals', 'lib', 'isolation-probe.mjs'),
      ],
      { encoding: 'utf8', cwd: root, env }
    );
    assert.equal(r.status, 0, `launcher failed:\n${r.stderr}\n${r.stdout}`);
    const lines = String(r.stdout).trim().split('\n').filter(Boolean);
    const report = JSON.parse(lines[lines.length - 1]);
    assert.equal(report.agentWsOk, true, 'AGENT_WS prompt readable');
    assert.equal(report.skillCleanOk, true, 'SKILL_CLEAN SKILL.md readable');
    assert.equal(report.hiddenOk, false, 'original hidden must be denied');
    assert.equal(report.scoringOk, false, 'scoring-rules must be denied');
    assert.equal(report.symlinkOk, false, 'symlink into hidden must be denied');
    assert.equal(report.childHiddenOk, false, 'child process must be denied hidden');
    assert.equal(
      report.externalAnswerOk,
      false,
      'home external answer copy must be denied without blacklist entry'
    );
    assert.equal(report.childExternalOk, false, 'child must be denied external answer');
    assert.equal(
      report.privateTmpAnswerOk,
      false,
      '/private/tmp answer must be denied without blacklist entry'
    );
    assert.equal(report.childPrivateTmpOk, false, 'child must be denied /private/tmp answer');
    assert.equal(
      report.privateTmpSymlinkOk,
      false,
      'workspace symlink to /private/tmp answer must be denied'
    );
    assert.equal(
      report.systemTmpAnswerOk,
      false,
      'os.tmpdir()/var/folders answer must be denied without blacklist entry'
    );
    assert.equal(report.childSystemTmpOk, false, 'child must be denied os.tmpdir() answer');
    assert.equal(
      report.systemTmpSymlinkOk,
      false,
      'workspace symlink to os.tmpdir() answer must be denied'
    );
    assert.equal(report.nodeBinOk, true, 'Node binary must remain readable');
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
    fs.rmSync(systemTmpDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(privateTmpFile);
    } catch {
      /* ignore */
    }
  }
});

test('TEST-Y05 F2.3 / I2 / J1 / K1: isolation.md declares allow-list; no whole-/var read', () => {
  const iso = read('evals/isolation.md');
  assert.match(iso, /唯一默认/);
  assert.match(iso, /run_eval_agent_isolated/);
  assert.match(iso, /伪隔离|不算|不得单独/);
  assert.match(iso, /sandbox-exec|Seatbelt/);
  assert.match(iso, /受限可读|allow-list/);
  assert.match(iso, /黑名单|不得单独/);
  assert.match(iso, /独立外部答案|\/private\/tmp/);
  assert.match(iso, /os\.tmpdir\(\)|var\/folders/);
  assert.match(iso, /禁止.*allow file-read\*|无条件.*file-read\*|无全局/);
  assert.ok(!/可选\s*OS|择一即可/.test(iso), 'old optional/choose-one wording must be gone');
  const launcher = read('scripts/run_eval_agent_isolated.mjs');
  assert.match(launcher, /\(deny default\)/);
  assert.ok(
    !/\(allow file-read\*\)\s*$/m.test(launcher) && !/\(allow file-read\*\)\n/.test(launcher),
    'unconditional (allow file-read*) must be gone'
  );
  assert.ok(!/\(allow default\)/.test(launcher), 'allow-default must not be the profile model');
  assert.match(launcher, /TMPDIR/);
  assert.ok(
    !/\(allow file-read\* \(subpath "\/var"\)\)/.test(launcher),
    'whole /var read allow must be gone'
  );
  assert.ok(
    !/\(allow file-read\* \(subpath "\/private\/var"\)\)/.test(launcher),
    'whole /private/var read allow must be gone'
  );
  assert.ok(
    !/\(allow file-read\* \(subpath "\/var\/folders"\)\)/.test(launcher),
    '/var/folders read allow must be gone'
  );
  assert.ok(
    !/\(allow file-read\* \(subpath "\/private\/var\/folders"\)\)/.test(launcher),
    '/private/var/folders read allow must be gone'
  );
  const stageSrc = read('scripts/stage_eval_agent_workspace.mjs');
  assert.match(stageSrc, /NOT isolation|不算隔离|不是隔离/i);
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'build_eval_skill_clean.mjs')));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'run_eval_agent_isolated.mjs')));
});

test('TEST-Y05 F2: cwd-only still reads original hidden (documents stage≠isolation)', () => {
  const hidden = path.join(evalsRoot, 'hidden', 'E01', 'fault.yaml');
  assert.ok(fs.existsSync(hidden));
  const r = spawnSync(
    process.execPath,
    ['-e', `require('fs').readFileSync(process.argv[1]); console.log('ok')`, hidden],
    { encoding: 'utf8', cwd: os.tmpdir() }
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ok/);
});

test('TEST-Y05 I3: scenario switch + content identity rebuild (no silent reuse)', async () => {
  const { ensurePrepared } = await import('../scripts/ensure_eval_prepared.mjs');
  const {
    checkAgentWsIdentity,
    checkSkillCleanIdentity,
    computeSkillCleanIdentityFromSource,
  } = await import('../scripts/eval_content_identity.mjs');

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'y05-i3-'));
  const logs = [];
  const opts = {
    skillRoot: root,
    workRoot,
    log: (m) => logs.push(String(m)),
    fail: (m) => {
      throw new Error(m);
    },
  };

  try {
    // --- E01 prepare ---
    const first = ensurePrepared({ ...opts, scenario: 'E01' });
    assert.ok(first.rebuilds.length >= 1);
    const packE01 = JSON.parse(
      fs.readFileSync(path.join(first.agentWs, 'AGENT_PACK.json'), 'utf8')
    );
    assert.equal(packE01.scenarioId, 'E01');
    assert.ok(packE01.contentIdentity && /^[a-f0-9]{64}$/.test(packE01.contentIdentity));
    const cleanMan = JSON.parse(
      fs.readFileSync(path.join(first.skillClean, 'SKILL_CLEAN.json'), 'utf8')
    );
    assert.ok(cleanMan.contentIdentity && /^[a-f0-9]{64}$/.test(cleanMan.contentIdentity));
    assert.equal(checkAgentWsIdentity(first.agentWs, root, 'E01').ok, true);
    assert.equal(checkSkillCleanIdentity(first.skillClean, root).ok, true);

    // --- same work-root switch E01 → E02: must not stay E01 ---
    logs.length = 0;
    const switched = ensurePrepared({ ...opts, scenario: 'E02' });
    assert.ok(
      switched.rebuilds.some((r) => r.tree === 'AGENT_WS'),
      `expected AGENT_WS rebuild on scenario switch, got ${JSON.stringify(switched.rebuilds)}`
    );
    const packE02 = JSON.parse(
      fs.readFileSync(path.join(switched.agentWs, 'AGENT_PACK.json'), 'utf8')
    );
    assert.equal(packE02.scenarioId, 'E02');
    assert.notEqual(packE02.contentIdentity, packE01.contentIdentity);

    // --- staged pack content tamper: change prompt bytes → rebuild ---
    const promptPath = path.join(switched.agentWs, 'prompt.md');
    const promptBefore = fs.readFileSync(promptPath, 'utf8');
    fs.writeFileSync(promptPath, `${promptBefore}\n<!-- I3 tamper -->\n`);
    assert.equal(checkAgentWsIdentity(switched.agentWs, root, 'E02').ok, false);
    logs.length = 0;
    const afterTamper = ensurePrepared({ ...opts, scenario: 'E02' });
    assert.ok(afterTamper.rebuilds.some((r) => r.tree === 'AGENT_WS'));
    assert.equal(fs.readFileSync(promptPath, 'utf8'), promptBefore);
    assert.equal(checkAgentWsIdentity(afterTamper.agentWs, root, 'E02').ok, true);

    // --- skill source content change → SKILL_CLEAN rebuild ---
    const skillMd = path.join(root, 'SKILL.md');
    const skillBefore = fs.readFileSync(skillMd, 'utf8');
    const idBefore = computeSkillCleanIdentityFromSource(root).contentIdentity;
    try {
      fs.writeFileSync(skillMd, `${skillBefore}\n<!-- I3 skill content bump -->\n`);
      const idAfter = computeSkillCleanIdentityFromSource(root).contentIdentity;
      assert.notEqual(idAfter, idBefore, 'content identity must track uncommitted skill bytes');
      assert.equal(checkSkillCleanIdentity(afterTamper.skillClean, root).ok, false);
      logs.length = 0;
      const afterSkill = ensurePrepared({ ...opts, scenario: 'E02' });
      assert.ok(
        afterSkill.rebuilds.some((r) => r.tree === 'SKILL_CLEAN'),
        `expected SKILL_CLEAN rebuild, got ${JSON.stringify(afterSkill.rebuilds)}`
      );
      const man2 = JSON.parse(
        fs.readFileSync(path.join(afterSkill.skillClean, 'SKILL_CLEAN.json'), 'utf8')
      );
      assert.equal(man2.contentIdentity, idAfter);
      assert.equal(checkSkillCleanIdentity(afterSkill.skillClean, root).ok, true);
    } finally {
      fs.writeFileSync(skillMd, skillBefore);
    }

    // docs: path/HEAD ≠ content identity
    const iso = read('evals/isolation.md');
    assert.match(iso, /contentIdentity|内容身份/);
    assert.match(iso, /路径.*HEAD|HEAD.*路径|路径／HEAD/);
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
});
