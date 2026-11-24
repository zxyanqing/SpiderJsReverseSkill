/**
 * C3 · 字面量传播验收（const-propagate）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C3 / 教程 05）：
 *   正例：offset → index → words[index]、对象简写 { token }
 *   反例：let 再赋值、对象身份引用必须保留并记入 skip reasons
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c3-tests.mjs
 *   npm run test:c3
 */

import parser from '@babel/parser';
import t from '@babel/types';
import { runUntilStable } from '../src/lib/run-until-stable.js';
import constPropagate from '../src/plugins/const-propagate.js';

/**
 * 验收输入：正例与反例放在同一份源码，便于一次跑完对照。
 */
const FIXTURE = `
const words = ['a', 'b', 'token'];
const offset = 2;
const index = offset;
console.log(words[index]);

const token = 'abc';
const request = { token };
console.log(request);

let mutableIndex = 1;
mutableIndex = 2;
console.log(words[mutableIndex]);

const data = { value: 1 };
console.log(data, data);
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
 * 汇总多轮 reasons。
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
 * 入口：多轮跑 const-propagate，断言正例替换、反例保留与跳过原因。
 */
function main() {
  console.log('C3 验收 · const-propagate\n');

  const ast = parser.parse(FIXTURE, { sourceType: 'script' });
  const result = runUntilStable(ast, [constPropagate], 6, { types: t });
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

  // ---------- 正例 ----------
  assert(/words\[\s*2\s*\]/.test(code), "正例：words[index] → words[2]");
  assert(
    /token\s*:\s*['"]abc['"]/.test(code),
    '正例：{ token } → { token: "abc" }'
  );

  // ---------- 反例 ----------
  assert(
    /mutableIndex/.test(code) && !/words\[\s*1\s*\]/.test(code),
    '反例：mutableIndex 不被传播成 1'
  );
  assert(
    /console\.log\(\s*data\s*,\s*data\s*\)/.test(code),
    '反例：data 对象身份引用保留'
  );

  const reasons = collectReasons(result.reports);
  console.log('\n累计跳过原因：', reasons);
  assert(
    Boolean(reasons['not-const'] || reasons['not-supported-init']),
    '反例：记录 not-const / not-supported-init 等跳过原因'
  );

  console.log('\n全部通过（C3）');
}

main();
