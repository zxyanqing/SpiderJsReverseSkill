/**
 * C4 · 静态字符串数组验收（static-array）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C4 / 教程 07）：
 *   正例：words[2] → 'two'
 *   反例：动态索引、成员写入、传入未知函数 → 整表跳过并记原因
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c4-tests.mjs
 *   npm run test:c4
 */

import parser from '@babel/parser';
import t from '@babel/types';
import { runUntilStable } from '../src/lib/run-until-stable.js';
import staticArray from '../src/plugins/static-array.js';

/**
 * 验收输入（对照第 07 章）：正例与三类反例分表存放，避免互相拖累。
 */
const FIXTURE = `
const words = ['zero', 'one', 'two'];
console.log(words[2]);

const pool = ['a', 'b', 'c'];
const dynamicIndex = getIndex();
console.log(pool[dynamicIndex]);

const mutableWords = ['old'];
mutableWords[0] = 'new';
console.log(mutableWords[0]);

const leaked = ['x', 'y'];
use(leaked);
console.log(leaked[0]);
`;

/**
 * @param {boolean} ok
 * @param {string} title
 * @param {string} [detail]
 */
function assert(ok, title, detail = '') {
  if (ok) {
    console.log(`✓ ${title}`);
    return;
  }
  console.error(`✗ ${title}`);
  if (detail) console.error(detail);
  process.exit(1);
}

/**
 * @param {Array<{plugins: Array<{reasons: object}>}>} reports
 * @returns {Record<string, number>}
 */
function collectReasons(reports) {
  const all = {};
  for (const round of reports) {
    const reasons = round.plugins[0].reasons || {};
    for (const [k, v] of Object.entries(reasons)) {
      all[k] = (all[k] ?? 0) + v;
    }
  }
  return all;
}

/**
 * 入口：跑 static-array，断言正例展开与反例整表保留。
 */
function main() {
  console.log('C4 验收 · static-array\n');

  const ast = parser.parse(FIXTURE, { sourceType: 'script' });
  const result = runUntilStable(ast, [staticArray], 6, { types: t });
  const code = result.code;

  console.log('各轮报告：');
  for (const round of result.reports) {
    const p = round.plugins[0];
    console.log(
      `  第 ${round.round} 轮 changed=${round.changed}`,
      `matched=${p.matched} skipped=${p.skipped}`,
      JSON.stringify(p.reasons)
    );
  }
  console.log('\n生成结果：\n' + code);

  assert(
    /console\.log\(\s*['"]two['"]\s*\)/.test(code),
    "正例：words[2] → 'two'"
  );
  assert(
    /pool\[dynamicIndex\]/.test(code),
    '反例：动态索引整表跳过，pool[dynamicIndex] 保留'
  );
  assert(
    /mutableWords\[0\]\s*=\s*['"]new['"]/.test(code) &&
      /console\.log\(\s*mutableWords\[0\]\s*\)/.test(code),
    '反例：成员写入整表跳过'
  );
  assert(
    /use\(\s*leaked\s*\)/.test(code) && /leaked\[0\]/.test(code),
    '反例：逃逸到未知函数整表跳过'
  );

  const reasons = collectReasons(result.reports);
  console.log('\n累计跳过原因：', reasons);
  assert(
    Boolean(reasons['dynamic-or-out-of-range-index']),
    '应记录 dynamic-or-out-of-range-index'
  );
  assert(
    Boolean(reasons['array-write-or-unknown-context']),
    '应记录 array-write-or-unknown-context'
  );

  console.log('\n全部通过（C4）');
}

main();
