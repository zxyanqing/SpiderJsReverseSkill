/**
 * C1 · 变化统计验收（createStats / skip）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C1）：
 *   1) createStats(name) 返回含 name / matched / changed / skipped / reasons 的对象
 *   2) 模拟一次命中、一次改写、两次同原因跳过
 *   3) reasons 中该原因的值必须为 2
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c1-tests.mjs
 *   npm run test:c1
 */

import { createStats, skip } from '../src/lib/stats.js';

/**
 * 断言条件成立；失败时打印标题并以非零退出。
 * @param {boolean} ok 条件
 * @param {string} title 用例名
 * @param {string} [detail] 失败补充说明
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
 * 入口：构造统计对象，按题目要求累加，再校验字段与 reasons 计数。
 */
function main() {
  console.log('C1 验收 · createStats / skip\n');

  // ---------- 构造统计容器 ----------
  const stats = createStats('demo-plugin');

  // ---------- 一次命中（形状匹配，尚未改写）----------
  stats.matched += 1;

  // ---------- 一次真实改写 ----------
  stats.changed += 1;

  // ---------- 两次同原因跳过（证据不足，保留原 AST）----------
  const reason = 'dynamic-index';
  skip(stats, reason);
  skip(stats, reason);

  console.log('统计 JSON：');
  console.log(JSON.stringify(stats, null, 2));
  console.log('');

  // ---------- 字段齐全性 ----------
  assert(stats.name === 'demo-plugin', 'name 字段正确');
  assert(typeof stats.matched === 'number', 'matched 为数字');
  assert(typeof stats.changed === 'number', 'changed 为数字');
  assert(typeof stats.skipped === 'number', 'skipped 为数字');
  assert(
    stats.reasons && typeof stats.reasons === 'object',
    'reasons 为对象'
  );

  // ---------- 计数值与题目约定一致 ----------
  assert(stats.matched === 1, 'matched === 1（一次命中）');
  assert(stats.changed === 1, 'changed === 1（一次改写）');
  assert(stats.skipped === 2, 'skipped === 2（两次跳过）');
  assert(
    stats.reasons[reason] === 2,
    `reasons['${reason}'] === 2`,
    `实际：${JSON.stringify(stats.reasons)}`
  );

  console.log('\n全部通过（C1）');
}

main();
