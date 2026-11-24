/**
 * C6 · 无用绑定清理验收（unused-binding）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C6 / 教程 08）：
 *   正例：无引用 + 纯净初始化 → 删除
 *   反例：调用副作用、赋值 violation、direct eval → 保留并记原因
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c6-tests.mjs
 *   npm run test:c6
 */

import parser from '@babel/parser';
import t from '@babel/types';
import { runUntilStable } from '../src/lib/run-until-stable.js';
import unusedBinding from '../src/plugins/unused-binding.js';

/**
 * 验收输入（对照第 08 章）。
 */
const FIXTURE = `
function demo() {
  const unusedPure = 1 + 2;
  const unusedCall = getValue();
  let assigned = 0;
  assigned = 1;
  return 7;
}

function withEval() {
  const hidden = 42;
  eval('hidden');
  return 1;
}
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
 * 入口：跑 unused-binding，断言只删纯净无用绑定。
 */
function main() {
  console.log('C6 验收 · unused-binding\n');

  const ast = parser.parse(FIXTURE, { sourceType: 'script' });
  const result = runUntilStable(ast, [unusedBinding], 6, { types: t });
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

  assert(!/unusedPure/.test(code), '正例：unusedPure 已删除');
  assert(
    /unusedCall\s*=\s*getValue\s*\(/.test(code),
    '反例：unusedCall = getValue() 因副作用保留'
  );
  assert(
    /let\s+assigned/.test(code) && /assigned\s*=\s*1/.test(code),
    '反例：assigned 因赋值 violation 保留'
  );
  assert(
    /hidden\s*=\s*42/.test(code) && /eval\s*\(/.test(code),
    '反例：withEval 内 hidden 因 direct eval 保留'
  );

  const reasons = collectReasons(result.reports);
  console.log('\n累计跳过原因：', reasons);
  for (const key of [
    'unused-initializer-may-have-side-effect',
    'has-assignment-or-violation',
    'direct-eval-stop',
  ]) {
    assert(Boolean(reasons[key]), `应记录跳过原因 ${key}`);
  }

  console.log('\n全部通过（C6）');
}

main();
