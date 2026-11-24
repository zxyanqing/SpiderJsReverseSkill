'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ORIGINAL_DESCRIPTION = 'Run original website JavaScript locally, diagnose browser-environment differences, and iteratively repair and validate the resulting output against its actual consumer. Use for local WebAPI, DOM, async, Realm, Worker, Wasm, fingerprint, and in-script network dependencies.';

/** Deleted reference basenames from the pre-refactor 48-file set (kept-name files omitted). */
const DELETED_REFERENCE_FILES = [
  'browser-acquisition.md',
  'camoufox-tooling.md',
  'captcha-flow-and-verify-handoff.md',
  'case-patterns.md',
  'cleanup.md',
  'code-change-memory.md',
  'code-style.md',
  'cookie-generation-analysis.md',
  'crypto-entry-location.md',
  'delivery-templates.md',
  'dynamic-resource-freshness.md',
  'env-module-levels.md',
  'env-native-protection.md',
  'final-project-summary.md',
  'fingerprint-baseline-consistency.md',
  'fingerprint-value-replay.md',
  'fixture-validation.md',
  'high-intensity-env-diff.md',
  'high-strength-browser-detection.md',
  'intake-template.md',
  'jsdom-authority-acceptance.md',
  'native-capability-gap.md',
  'node-leakage-and-silent-failure.md',
  'node-version-recovery.md',
  'object-shape-private-state.md',
  'ruyi-tooling.md',
  'session-request-chain.md',
  'stage-markdown-reports.md',
  'tls-request-validation.md',
  'trace-api-coverage.md',
  'trace-runtime-conformance.md',
  'trust-matrix.md',
  'trusted-input-and-isTrusted.md',
  'webapi-env-detection-matrix.md',
  'xhr-fetch-semantics-audit.md',
  'xhr-fetch-session-bridge.md',
];

const DOM_DIMENSIONS = [
  '状态归属明确',
  '模块共享真实状态',
  '公开入口一致',
  '写入统一',
  '读取无副作用',
  '变化观察正确',
  '对象关系稳定',
  '解析与运行接通',
  '适配边界清楚',
  '生命周期一致',
  '正式路径生效',
  '验证证据充分',
  '语义分类准确',
  '关联能力联动',
  '断言与结论相符',
];

/**
 * T7 markers: each phrase must appear only in its authority file among
 * SKILL.md + references/*.md + agents/openai.yaml.
 * Chosen to represent the full constraint, not a common word.
 */
const SINGLE_SOURCE_MARKERS = [
  {
    id: 'completion-three-progresses',
    authority: 'SKILL.md',
    phrase: '实现进展（真实缺陷已修）、定位进展（解释被支持/削弱或范围缩小）、接受反馈',
  },
  {
    id: 'autonomy-no-handoff',
    authority: 'SKILL.md',
    phrase: '常规技术选择不转交用户',
  },
  {
    id: 'jsdom-priority-boundary',
    authority: 'references/runtime-frameworks.md',
    phrase: '不把布局、图形、设备读数等一律交给 jsdom',
  },
  {
    id: 'dom-unification-entry',
    authority: 'references/dom-state-unification.md',
    phrase: '普通 jsdom 维护和局部修复不进入本专项，只按受影响关系回归',
  },
  {
    id: 'local-check-not-acceptance',
    authority: 'references/validation.md',
    phrase: '本地检查或工具通过不等于网站接受',
  },
  {
    id: 'acceptance-levels',
    authority: 'references/validation.md',
    phrase: 'L2（**默认完成**）：消费接受 + 稳定性',
  },
  {
    id: 'jsdom-layering',
    authority: 'references/runtime-frameworks.md',
    phrase: '不提供通用外观层实现资产',
  },
  {
    id: 'mixed-not-delivery',
    authority: 'references/controlled-substitution.md',
    phrase: '混合运行成功不等于正式本地交付',
  },
  {
    id: 'fingerprint-separate',
    authority: 'references/fingerprint.md',
    phrase: '相对稳定配置，与 Cookie/Storage、动态资源',
  },
  {
    id: 'evidence-trust',
    authority: 'references/env-debug-loop.md',
    phrase: '证据可信度矩阵',
  },
  {
    id: 'sensitive-redaction',
    authority: 'references/records-and-delivery.md',
    phrase: '输出报告时可脱敏',
  },
  {
    id: 'budget-not-wait',
    authority: 'references/workflow.md',
    phrase: 'B1、B2 触发的是复核和报告，**不是**等待人工指路',
  },
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function listReferenceMarkdown() {
  return fs.readdirSync(path.join(root, 'references'))
    .filter((name) => name.endsWith('.md'))
    .sort();
}

function structureCorpusFiles() {
  const files = ['SKILL.md', 'agents/openai.yaml'];
  for (const name of listReferenceMarkdown()) files.push(path.join('references', name));
  return files;
}

function parseFrontmatter(skillText) {
  const match = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description, body: skillText.slice(match[0].length) };
}

function bodyLineCount(body) {
  if (body.length === 0) return 0;
  const normalized = body.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (normalized.length === 0) return 0;
  return normalized.split('\n').length;
}

function extractRepoPaths(text) {
  const found = new Set();
  const re = /(?:references|scripts|assets)\/[A-Za-z0-9_./-]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let p = match[0];
    p = p.replace(/[.,;:)\]]+$/, '');
    found.add(p);
  }
  return [...found];
}

function walkNoNodeModules(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    visit(full, entry);
    if (entry.isDirectory()) walkNoNodeModules(full, visit);
  }
}

test('T1 frontmatter name and description are frozen', () => {
  const { name, description } = parseFrontmatter(read('SKILL.md'));
  assert.equal(name, 'web-js-env-patcher');
  assert.equal(description, ORIGINAL_DESCRIPTION);
});

test('T2 SKILL.md body has at most 120 lines', () => {
  const { body } = parseFrontmatter(read('SKILL.md'));
  const lines = bodyLineCount(body);
  assert.ok(lines <= 120, `body has ${lines} lines`);
});

test('T3 every references/*.md is linked from SKILL.md as references/<name>.md', () => {
  const skill = read('SKILL.md');
  const missing = [];
  for (const name of listReferenceMarkdown()) {
    const needle = `references/${name}`;
    if (!skill.includes(needle)) missing.push(needle);
  }
  assert.deepEqual(missing, []);
});

test('T4 referenced references/scripts/assets paths exist', () => {
  const missing = [];
  for (const file of structureCorpusFiles()) {
    const text = read(file);
    for (const repoPath of extractRepoPaths(text)) {
      const abs = path.join(root, repoPath);
      if (!fs.existsSync(abs)) missing.push(`${file} -> ${repoPath}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('T5 deleted old reference filenames do not reappear', () => {
  const hits = [];
  for (const file of structureCorpusFiles()) {
    const text = read(file);
    for (const oldName of DELETED_REFERENCE_FILES) {
      if (text.includes(oldName)) hits.push(`${file} -> ${oldName}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('T6 every scripts/*.js basename appears in references/tools.md', () => {
  const tools = read('references/tools.md');
  const missing = [];
  for (const name of fs.readdirSync(path.join(root, 'scripts')).filter((n) => n.endsWith('.js')).sort()) {
    if (!tools.includes(name)) missing.push(name);
  }
  assert.deepEqual(missing, []);
});

test('T7 single-source marker phrases stay only in their authority files', () => {
  const corpus = structureCorpusFiles();
  for (const marker of SINGLE_SOURCE_MARKERS) {
    const hits = [];
    for (const file of corpus) {
      if (read(file).includes(marker.phrase)) hits.push(file);
    }
    assert.deepEqual(
      hits,
      [marker.authority],
      `marker ${marker.id} (${marker.phrase}) expected only in ${marker.authority}, got ${JSON.stringify(hits)}`
    );
  }
});

test('T8 references files other than task-prompt-template.md have at least 15 lines', () => {
  const short = [];
  for (const name of listReferenceMarkdown()) {
    if (name === 'task-prompt-template.md') continue;
    const lines = read(path.join('references', name)).replace(/\r\n/g, '\n').split('\n').length;
    if (lines < 15) short.push(`${name} (${lines})`);
  }
  assert.deepEqual(short, []);
});

test('T9 dom-state-unification keeps 15 dimensions and drops prompt6 markers', () => {
  const text = read('references/dom-state-unification.md');
  for (const dim of DOM_DIMENSIONS) {
    assert.ok(text.includes(dim), `missing dimension ${dim}`);
  }
  for (const banned of ['PROMPT6', 'SHA-256', '本轮', '历轮']) {
    assert.ok(!text.includes(banned), `banned token present: ${banned}`);
  }
});

test('T10 no .DS_Store outside node_modules', () => {
  const found = [];
  walkNoNodeModules(root, (full, entry) => {
    if (entry.isFile() && entry.name === '.DS_Store') found.push(path.relative(root, full));
  });
  assert.deepEqual(found, []);
});

test('T11 SKILL.md states cross-layer persona principle and links fingerprint.md', () => {
  const { body } = parseFrontmatter(read('SKILL.md'));
  assert.ok(body.includes('跨层画像保持一致'), 'SKILL body must contain decision phrase 跨层画像保持一致');
  assert.ok(body.includes('references/fingerprint.md'), 'SKILL body must link references/fingerprint.md');
});

test('T12 fingerprint.md has 跨层画像一致性 authority section covering TLS and Client Hints', () => {
  const text = read('references/fingerprint.md');
  assert.ok(
    text.includes('跨层画像一致性') || text.includes('## 跨层画像一致性'),
    'fingerprint.md must contain authority heading 跨层画像一致性'
  );
  assert.ok(/TLS/i.test(text), 'fingerprint.md must mention TLS');
  assert.ok(/Client Hints|Sec-CH-UA/i.test(text), 'fingerprint.md must mention Client Hints or Sec-CH-UA');
});

test('T13 network-session.md points to fingerprint.md for cross-layer persona', () => {
  const text = read('references/network-session.md');
  assert.ok(text.includes('references/fingerprint.md'), 'network-session.md must link fingerprint.md');
  assert.ok(
    /跨层画像|画像一致/.test(text),
    'network-session.md must mention 跨层画像 or 画像一致 near the fingerprint link'
  );
});

test('T14 env-discovery.md exists with silent classes and four error keywords', () => {
  const text = read('references/env-discovery.md');
  assert.ok(/静默探测四类|静默四类/.test(text), 'must contain silent-probe section');
  assert.ok(/四类补环境错误|四类错误/.test(text), 'must contain four-error section');
  assert.ok(text.includes('存在性') && text.includes('类型') && text.includes('结构'), 'must mention 存在性/类型/结构');
});

test('T15 SKILL has A/B/C section titles and links', () => {
  const skill = read('SKILL.md');
  assert.ok(skill.includes('环境发现协议'), 'missing 环境发现协议');
  assert.ok(skill.includes('属性值来源'), 'missing 属性值来源');
  assert.ok(skill.includes('无浏览器'), 'missing 无浏览器');
  assert.ok(skill.includes('references/env-discovery.md'));
  assert.ok(skill.includes('references/fingerprint.md'));
  assert.ok(skill.includes('references/workflow.md'));
});

test('T16 validation.md has three acceptance dimensions', () => {
  const text = read('references/validation.md');
  assert.ok(text.includes('消费接受'), 'missing 消费接受');
  assert.ok(text.includes('稳定性'), 'missing 稳定性');
  assert.ok(text.includes('数据真实性'), 'missing 数据真实性');
});

test('T17 workflow.md states browser is not a local prerequisite', () => {
  const text = read('references/workflow.md');
  assert.ok(
    text.includes('浏览器不是本地运行的前置条件') || /浏览器不是.*前置/.test(text),
    'workflow must state browser is not a local prerequisite'
  );
});

test('T18 network-session.md has atomic session package keywords', () => {
  const text = read('references/network-session.md');
  assert.ok(/原子输入|挑战输入原子包|同会话/.test(text), 'must mention atomic/same-session package');
});

test('T19 env-discovery has baseline/trace/formal three modes', () => {
  const text = read('references/env-discovery.md');
  assert.ok(text.includes('基线') && text.includes('追踪') && /正式/.test(text), 'must contain 基线/追踪/正式');
  assert.ok(/追踪三模式|三模式/.test(text), 'must name three modes');
});

test('T20 every references/*.md is linked from SKILL.md (count check)', () => {
  const refs = listReferenceMarkdown();
  const skill = read('SKILL.md');
  const missing = refs.filter((name) => !skill.includes(`references/${name}`));
  assert.ok(refs.length >= 20, `expected >=20 references, got ${refs.length}`);
  assert.deepEqual(missing, []);
});

// --- G1–G8 structure guards (P5 T21–T27; auxiliary, not a substitute for behavior tests) ---

test('T21 runtime-frameworks.md has scenario selection / on-demand composition', () => {
  const text = read('references/runtime-frameworks.md');
  assert.ok(
    /场景选择|按需组合/.test(text),
    'runtime-frameworks.md must mention 场景选择 or 按需组合'
  );
});

test('T22 browser-evidence.md has manual probe steps', () => {
  const text = read('references/browser-evidence.md');
  assert.ok(
    /人工.*探针|探针步骤|只读探针/.test(text),
    'browser-evidence.md must describe manual probe steps'
  );
});

test('T23 env-discovery.md has keep-missing or over-exposure', () => {
  const text = read('references/env-discovery.md');
  assert.ok(
    /保持缺失|过度暴露/.test(text),
    'env-discovery.md must mention 保持缺失 or 过度暴露'
  );
});

test('T24 network-session.md has multi-write / candidate trials', () => {
  const text = read('references/network-session.md');
  assert.ok(
    /多次写入|候选试验|候选前缀/.test(text),
    'network-session.md must mention multi-write candidate trials'
  );
});

test('T25 env-debug-loop.md has four time-parameter kinds', () => {
  const text = read('references/env-debug-loop.md');
  assert.ok(
    /时间参数四类|单脚本执行预算|目标结果完成信号|有限后续观察窗口/.test(text),
    'env-debug-loop.md must name time-parameter kinds'
  );
});

test('T26 hook docs mention keep-missing / summary / formal close', () => {
  const text = read('references/hook-templates.md');
  assert.ok(/保持缺失/.test(text), 'hook-templates.md must mention 保持缺失');
  assert.ok(/摘要/.test(text), 'hook-templates.md must mention 摘要');
  assert.ok(/正式验收关闭|正式.*关闭/.test(text), 'hook-templates.md must mention formal close');
});

test('T27 artifact check scope (explicit entry) is documented', () => {
  const text = read('references/records-and-delivery.md');
  assert.ok(
    /显式入口|检查范围|--file/.test(text),
    'records-and-delivery.md must document explicit-entry check scope'
  );
});
