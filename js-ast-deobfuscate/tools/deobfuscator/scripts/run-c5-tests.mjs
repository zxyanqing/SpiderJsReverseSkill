/**
 * C5 · 对象映射表验收（object-map）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C5 / 教程 06）：
 *   正例：只读数据属性折叠
 *   反例：成员写入、函数属性 this 风险、对象逃逸 → 整表跳过
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c5-tests.mjs
 *   npm run test:c5
 */

import parser from '@babel/parser';
import t from '@babel/types';
import { runUntilStable } from '../src/lib/run-until-stable.js';
import objectMap from '../src/plugins/object-map.js';

/**
 * 验收输入（对照第 06 章）。
 */
const FIXTURE = `
const safeTable = { token: 'abc', count: 3 };
console.log(safeTable.token, safeTable['count']);

const mutableTable = { token: 'old' };
mutableTable.token = 'new';
console.log(mutableTable.token);

const fnTable = {
  method: function () { return this.x; },
  x: 1
};
fnTable.method();

const leaked = { a: 1 };
use(leaked);
console.log(leaked.a);
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
 * 入口：跑 object-map，断言数据属性折叠与 this/写入/逃逸反例。
 */
function main() {
  console.log('C5 验收 · object-map\n');

  const ast = parser.parse(FIXTURE, { sourceType: 'script' });
  const result = runUntilStable(ast, [objectMap], 6, { types: t });
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
    /console\.log\(\s*['"]abc['"]\s*,\s*3\s*\)/.test(code),
    "正例：safeTable.token / ['count'] → 'abc', 3"
  );
  assert(
    /mutableTable\.token\s*=\s*['"]new['"]/.test(code) &&
      /console\.log\(\s*mutableTable\.token\s*\)/.test(code),
    '反例：写入整表跳过'
  );
  assert(
    /fnTable\.method\s*\(/.test(code),
    '反例：函数属性因 this 风险保留调用形态'
  );
  assert(
    /use\(\s*leaked\s*\)/.test(code) && /leaked\.a/.test(code),
    '反例：逃逸整表跳过'
  );

  const reasons = collectReasons(result.reports);
  console.log('\n累计跳过原因：', reasons);
  assert(
    Boolean(reasons['write-or-unknown-context']),
    '应记录 write-or-unknown-context'
  );
  assert(
    Boolean(reasons['function-property-this-risk']),
    '应记录 function-property-this-risk'
  );

  console.log('\n全部通过（C5）');
}

main();
