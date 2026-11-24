/**
 * F1 家族参考注册表：检测 + 配方 + 文档路径。
 * 不自动执行站点 pass；仅指导 A 插件序与 B scaffold。
 */

/** JAD 通用安全默认（不含 rename） */
export const GENERIC_A_PLUGINS = [
  'normalize-structure',
  'literal-string',
  'constant-fold',
  'const-propagate',
  'inline-literals',
  'static-array',
  'object-map',
  'inline-dispatchers',
  'dead-branch',
  'string-decrypt-chain',
  'normalize-object-ref-state',
  'unused-binding',
  'cleanup-concat-decoy',
  'member-simplify',
  'if-chain-to-switch',
  'flatten-array-control-flow',
  'restore-sequential-dispatcher',
  'restore-explicit-state-machine',
  'restore-for-switch-state',
  'remove-debugger',
];

/** 跳过晚期 inline-literals 的保守链（大样本 / reese84） */
const A_SKIP_LATE_INLINE = GENERIC_A_PLUGINS.filter((p) => p !== 'inline-literals');

/**
 * @typedef {{
 *   id: string,
 *   displayName: string,
 *   reference: string,
 *   hintTokens: string[],
 *   contentRegexes: RegExp[],
 *   families: string[],
 *   notes: string[],
 *   a_plugins: string[],
 *   skip_plugins?: string[],
 *   optional_plugins?: string[],
 *   b_scaffold_hints: string[],
 * }} FamilyPack
 */

/** @type {FamilyPack[]} */
export const FAMILIES = [
  {
    id: 'generic',
    displayName: 'generic layered pipeline',
    reference: null,
    hintTokens: [],
    contentRegexes: [],
    families: ['generic'],
    notes: ['仅用通用 A；残留稳定后再 escalate 家族文档或 B。'],
    a_plugins: GENERIC_A_PLUGINS,
    b_scaffold_hints: [],
  },
  {
    id: 'reese84',
    displayName: 'reese84',
    reference: 'references/families/reese84.md',
    hintTokens: ['reese84'],
    contentRegexes: [/reese84/i],
    families: ['vm-heavy', 'dispatcher-heavy'],
    notes: [
      '默认跳过 inline-literals（大体量易卡住）。',
      '对照参考 decode 比较 dispatcher / 行数残留。',
    ],
    a_plugins: A_SKIP_LATE_INLINE,
    skip_plugins: ['inline-literals'],
    optional_plugins: ['rename-identifiers'],
    b_scaffold_hints: [
      'heavy dispatcher wrappers after A',
      'consider narrow runner for remaining VM handlers; no in-process eval',
    ],
  },
  {
    id: 'dingxiang',
    displayName: 'dingxiang',
    reference: 'references/families/dingxiang.md',
    hintTokens: ['顶象', 'dingxiang', 'dx'],
    contentRegexes: [/dingxiang/i],
    families: ['param-array', 'dispatcher-heavy'],
    notes: [
      '优先还原 IIFE 参数驱动数组后再判断 flatten 残留。',
      '不要默认追加第二轮 inline-literals。',
    ],
    a_plugins: A_SKIP_LATE_INLINE,
    skip_plugins: ['inline-literals'],
    b_scaffold_hints: [
      'IIFE-parameter-backed order arrays',
      'narrow: recover param→array before flatten leftovers',
    ],
  },
  {
    id: 'geetest4',
    displayName: 'geetest4',
    reference: 'references/families/geetest4.md',
    hintTokens: ['极验4', 'geetest4', 'geetest', 'gcaptcha4'],
    contentRegexes: [/geetest/i, /gcaptcha4/i],
    families: ['guarded-switch', 'vm-heavy'],
    notes: [
      'guarded-if + switch 适配器留在 B，不进通用 A。',
      '先压低 loop/switch 与 object-ref 残留。',
    ],
    a_plugins: GENERIC_A_PLUGINS,
    b_scaffold_hints: [
      'encoded-bootstrap-dispatcher / geetest-like-xor-string',
      'guarded switch around for/while state machine',
      'object-ref state table → normalize-object-ref-state then restore-for-switch-state',
    ],
  },
  {
    id: 'tonghuashun',
    displayName: 'tonghuashun',
    reference: 'references/families/tonghuashun.md',
    hintTokens: ['同花顺', 'tonghuashun', '10jqka'],
    contentRegexes: [/10jqka/i, /split\(\s*["']\|["']\s*\)/],
    families: ['split-order-source', 'dispatcher-wrapper'],
    notes: ['nested wrapper → split("|") order；默认跳过 inline-literals。'],
    a_plugins: A_SKIP_LATE_INLINE,
    skip_plugins: ['inline-literals'],
    b_scaffold_hints: [
      'unwrap nested objects to reach split("|") order string',
      'then re-run flatten-array-control-flow / restore-sequential-dispatcher',
    ],
  },
  {
    id: 'yidun',
    displayName: 'yidun',
    reference: 'references/families/yidun.md',
    hintTokens: ['网易易盾', 'yidun', '163'],
    contentRegexes: [/yidun/i],
    families: ['dispatcher-heavy'],
    notes: ['允许一轮 inline-literals；对照 dispatcher wrapper 残留。'],
    a_plugins: GENERIC_A_PLUGINS,
    optional_plugins: ['rename-identifiers'],
    b_scaffold_hints: ['dense dispatcher wrappers after inline-dispatchers'],
  },
  {
    id: 'xiaohongshu',
    displayName: 'xiaohongshu',
    reference: 'references/families/xiaohongshu.md',
    hintTokens: ['小红书', 'xiaohongshu', 'xhs'],
    contentRegexes: [/xiaohongshu/i, /\bxhs\b/i],
    families: ['wrapper-light'],
    notes: ['轻量 wrapper；优先规范化而非激进求值。'],
    a_plugins: GENERIC_A_PLUGINS,
    optional_plugins: ['rename-identifiers'],
    b_scaffold_hints: ['light wrapper cleanup if A leaves small dispatcher residue'],
  },
  {
    id: 'cn-bidding-ob',
    displayName: 'cn-bidding-ob',
    reference: 'references/families/cn-bidding-ob.md',
    hintTokens: ['中国招标投标公共服务平台', '招标投标', 'ob'],
    contentRegexes: [/\b_0x[a-f0-9]+\b/i],
    families: ['ob-variant'],
    notes: ['OB 变种；站点窄逻辑走 B，不进 A。'],
    a_plugins: GENERIC_A_PLUGINS,
    b_scaffold_hints: ['OB wrapper layers + remaining loop/switch'],
  },
  {
    id: 'mps-ob',
    displayName: 'mps-ob',
    reference: 'references/families/mps-ob.md',
    hintTokens: ['中华人民共和国公安部', '公安部', 'mps', 'ob'],
    contentRegexes: [/\b_0x[a-f0-9]+\b/i],
    families: ['ob-variant'],
    notes: ['与招标 OB 同家族但残留画像不同。'],
    a_plugins: GENERIC_A_PLUGINS,
    optional_plugins: ['rename-identifiers'],
    b_scaffold_hints: ['OB adapter residue: loop/switch vs reference decode'],
  },
];

function normalizeHint(value) {
  return String(value || '').toLowerCase();
}

/**
 * @param {FamilyPack} pattern
 * @param {string} inputPath
 * @param {string} hint
 * @param {string} sourceText
 */
function collectDetection(pattern, inputPath, hint, sourceText) {
  let score = 0;
  const reasons = [];
  const haystacks = [normalizeHint(inputPath), normalizeHint(hint)];
  for (const token of pattern.hintTokens) {
    const normalized = normalizeHint(token);
    if (!normalized) continue;
    if (haystacks.some((value) => value.includes(normalized))) {
      score += 10;
      reasons.push(`hint:${token}`);
    }
  }
  for (const regex of pattern.contentRegexes) {
    if (regex.test(sourceText)) {
      score += 3;
      reasons.push(`content:${regex}`);
    }
  }
  return { id: pattern.id, score, reasons };
}

/**
 * @param {{inputPath: string, hint?: string, sourceText: string}} args
 */
export function detectFamily({ inputPath, hint = '', sourceText }) {
  const detections = FAMILIES.filter((pattern) => pattern.id !== 'generic')
    .map((pattern) => collectDetection(pattern, inputPath, hint, sourceText))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const bestId = detections.length > 0 ? detections[0].id : 'generic';
  return {
    bestId,
    detections,
    selected: getFamily(bestId),
  };
}

/**
 * @param {string} id
 */
export function getFamily(id) {
  return FAMILIES.find((pattern) => pattern.id === id) || FAMILIES[0];
}
