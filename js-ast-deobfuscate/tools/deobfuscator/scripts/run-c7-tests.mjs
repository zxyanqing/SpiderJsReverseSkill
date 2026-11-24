/**
 * C7 · 四类测试运行器（针对插件 const-propagate）
 *
 * ---------------------------------------------------------------------------
 * 回答的四个问题（对应 docs/06-解混淆模式库 验收闭环）：
 *   1) 正例：安全形态有没有真正命中并改写？
 *   2) 反例：证据不足时有没有误伤（语义必须保留）？
 *   3) 幂等：第二次运行是否不再改变结果？
 *   4) 行为对照：改写前后可观察行为是否一致？
 *
 * ---------------------------------------------------------------------------
 * 为何放在 fixtures/c7/ 子目录：
 *   旧的 scripts/run-fixtures.mjs 会扫 fixtures/*-input.js 并用默认插件链跑。
 *   const-propagate 不在默认链里；若与 01/02/03 混放会误伤回归。
 *   C7 样本集中在 fixtures/c7/，由本脚本显式加载。
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c7-tests.mjs
 *   npm run test:c7
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform } from '../src/transform.js';
import { generateCode } from '../src/generate.js';

/** 本批四类测试只启用字面量传播插件，避免其它 Pass 干扰判定。 */
const PLUGIN = 'const-propagate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** C7 专用 fixture 根目录（与阶段 5 综合 fixture 隔离）。 */
const fixturesDir = path.join(__dirname, '../fixtures/c7');

/**
 * 统一换行并去掉首尾空白，避免 Windows CRLF / 末尾空行导致假失败。
 * @param {string} code 生成或读盘得到的源码
 * @returns {string} 规范化后的源码（末尾保留一个换行）
 */
function normalize(code) {
  return code.replace(/\r\n/g, '\n').trim() + '\n';
}

/**
 * 去掉文件头教学用块注释，再规范化。
 * 原因：generate 会保留 input 的 banner，而 expected 文件有另一段说明注释；
 * 比较语义时应忽略这类文档注释，只比可执行语句。
 * @param {string} code 源码
 * @returns {string}
 */
function normalizeCode(code) {
  const withoutBanner = code.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
  return normalize(withoutBanner);
}

/**
 * 读取 fixtures/c7 下的一个文本文件。
 * @param {string} name 文件名（相对 fixtures/c7）
 * @returns {string} UTF-8 源码
 */
function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

/**
 * 对源码只跑 const-propagate，再生成可读 JS。
 * 进入条件：源码可被 parser 解析。
 * 失败影响：抛出解析/插件错误，整次测试失败。
 * @param {string} source 输入源码
 * @returns {string} 变换后的源码
 */
function runConstPropagate(source) {
  // 每次从源码重新 parse，保证不共享上一轮残留 AST
  const ast = parseCode(source);
  // 显式传入插件名，不走 DEFAULT_PLUGINS
  transform(ast, [PLUGIN]);
  const { code } = generateCode(ast, source);
  return code;
}

/**
 * 在隔离函数中执行「定义 sample + 调用 sample」并返回 JSON 可序列化结果。
 * 仅用于自建行为对照样本；不对未知混淆做通用沙箱承诺。
 * @param {string} source 含 function sample() { ... } 的源码
 * @returns {unknown} sample() 的返回值
 */
function evalSample(source) {
  // new Function 避免污染当前模块作用域；结尾显式 return sample()
  const runner = new Function(`${source}\n; return sample();`);
  return runner();
}

/**
 * 深度比较两个值（行为对照用），对数组/对象走 JSON 稳定串。
 * @param {unknown} a 改写前结果
 * @param {unknown} b 改写后结果
 * @returns {boolean} 是否行为一致
 */
function sameBehavior(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 打印单条用例结果；失败时带上 got/expected 便于定位。
 * @param {boolean} ok 是否通过
 * @param {string} title 用例标题
 * @param {{got?: string, expected?: string, detail?: string}} [extra] 失败附加信息
 * @returns {boolean} 原样返回 ok，方便累计失败数
 */
function report(ok, title, extra = {}) {
  if (ok) {
    console.log(`✓ ${title}`);
    return true;
  }
  console.error(`✗ ${title}`);
  if (extra.detail) console.error(extra.detail);
  if (extra.got != null) console.error('--- got ---\n' + extra.got);
  if (extra.expected != null) console.error('--- expected ---\n' + extra.expected);
  return false;
}

/**
 * ① 正例：输入应变为期望输出（发生折叠）。
 * @returns {boolean}
 */
function testPositive() {
  const input = readFixture('01-positive-input.js');
  const expected = readFixture('01-positive-expected.js');
  const got = runConstPropagate(input);
  return report(normalizeCode(got) === normalizeCode(expected), '正例 01-positive（应发生折叠）', {
    got,
    expected,
  });
}

/**
 * ② 反例：危险/不确定形态不得被误折叠；输出须等于期望（语义保留）。
 * 另做关键字抽查，防止「碰巧文本接近但删掉了 getValue」这类假绿。
 * @returns {boolean}
 */
function testNegative() {
  const input = readFixture('02-negative-input.js');
  const expected = readFixture('02-negative-expected.js');
  const got = runConstPropagate(input);

  // 文本级：与 expected 对齐（忽略文件头教学注释）
  const textOk = normalizeCode(got) === normalizeCode(expected);

  // 语义抽查：这些片段必须仍在，否则说明误伤
  const markers = ['let mutable', 'mutable = 2', 'getValue()', 'const bag'];
  const markerOk = markers.every((m) => got.includes(m));

  return report(textOk && markerOk, '反例 02-negative（不得误折叠）', {
    got,
    expected,
    detail: markerOk
      ? undefined
      : `缺少保留标记之一: ${markers.filter((m) => !got.includes(m)).join(', ')}`,
  });
}

/**
 * ③ 幂等：第一次结果等于 expected，且对 expected 再跑一次仍不变。
 * @returns {boolean}
 */
function testIdempotent() {
  const input = readFixture('03-idempotent-input.js');
  const expected = readFixture('03-idempotent-expected.js');

  // 第一轮：从原始输入得到稳定形
  const once = runConstPropagate(input);
  const firstOk = normalizeCode(once) === normalizeCode(expected);

  // 第二轮：对期望/稳定形再跑，必须（规范化后）不变
  const twice = runConstPropagate(once);
  const secondOk = normalizeCode(twice) === normalizeCode(once);

  return report(firstOk && secondOk, '幂等 03-idempotent（第二轮不再变化）', {
    got: `first:\n${once}\nsecond:\n${twice}`,
    expected,
    detail: !firstOk
      ? '第一轮结果与 expected 不一致'
      : !secondOk
        ? '第二轮仍在改写（非幂等）'
        : undefined,
  });
}

/**
 * ④ 行为对照：改写前后 sample() 返回值一致，且源码等于 expected。
 * @returns {boolean}
 */
function testBehavior() {
  const input = readFixture('04-behavior-input.js');
  const expected = readFixture('04-behavior-expected.js');
  const transformed = runConstPropagate(input);

  // 源码级：变换结果应与期望文件一致（忽略文件头注释）
  const sourceOk = normalizeCode(transformed) === normalizeCode(expected);

  // 行为级：在隔离函数中分别执行输入与输出，比较返回值
  let before;
  let after;
  let evalOk = false;
  let evalError = '';
  try {
    before = evalSample(input);
    after = evalSample(transformed);
    evalOk = sameBehavior(before, after);
  } catch (err) {
    evalError = String(err && err.stack ? err.stack : err);
  }

  // 额外约定：本样本期望返回值固定，防止「两边都错但碰巧相等」
  const expectedValue = ['ok', true, 10, 20];
  const valueOk = sameBehavior(before, expectedValue);

  return report(
    sourceOk && evalOk && valueOk,
    '行为对照 04-behavior（改写前后 sample() 一致）',
    {
      got: transformed,
      expected,
      detail: [
        !sourceOk ? '源码与 expected 不一致' : '',
        evalError ? `执行失败: ${evalError}` : '',
        !evalOk ? `行为不一致 before=${JSON.stringify(before)} after=${JSON.stringify(after)}` : '',
        !valueOk ? `返回值不是约定的 ${JSON.stringify(expectedValue)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  );
}

/**
 * 入口：按 正例 → 反例 → 幂等 → 行为 顺序跑完并汇总。
 * 任一失败则 process.exit(1)，便于接入 npm script / CI。
 */
function main() {
  console.log(`C7 四类测试 · 插件 = ${PLUGIN}`);
  console.log(`fixture 目录 = ${fixturesDir}\n`);

  const results = [testPositive(), testNegative(), testIdempotent(), testBehavior()];
  const failed = results.filter((ok) => !ok).length;

  if (failed) {
    console.error(`\n${failed} 项失败（共 ${results.length}）`);
    process.exit(1);
  }
  console.log(`\n全部通过（${results.length}）`);
}

main();
