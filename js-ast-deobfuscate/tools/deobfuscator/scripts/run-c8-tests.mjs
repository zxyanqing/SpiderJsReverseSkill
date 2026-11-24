/**
 * C8 · 顺序数组分发器四类测试：正例、反例、幂等、行为对照。
 * 运行：cd tools/deobfuscator && npm run test:c8
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform } from '../src/transform.js';
import { generateCode } from '../src/generate.js';

const PLUGIN = 'restore-sequential-dispatcher';
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, '../fixtures/c8');

/**
 * 去掉教学文件头注释并统一换行，只比较可执行源码。
 * @param {string} code 输入或生成源码
 * @returns {string} 规范化源码
 */
function normalizeCode(code) {
  const withoutBanner = code.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
  return withoutBanner.replace(/\r\n/g, '\n').trim() + '\n';
}

/**
 * 读取一个 C8 fixture。
 * @param {string} name 文件名
 * @returns {string} UTF-8 源码
 */
function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

/**
 * 只运行 C8 插件，避免默认流水线的清理插件影响期望源码。
 * @param {string} source 输入源码
 * @returns {string} 生成源码
 */
function runPlugin(source) {
  const ast = parseCode(source);
  transform(ast, [PLUGIN]);
  return generateCode(ast, source).code;
}

/**
 * 执行自建 sample 并捕获返回或抛错，形成可 JSON 比较的行为记录。
 * @param {string} source 含 sample 函数的自建源码
 * @returns {{kind: string, value?: unknown, name?: string, message?: string}} 行为摘要
 */
function observe(source) {
  try {
    // 自建 fixture 可在当前进程对照；此 helper 不用于未知脚本安全隔离。
    const value = new Function(`${source}\nreturn sample();`)();
    return { kind: 'return', value };
  } catch (error) {
    // 异常路径比较错误类型与消息，不能只比较“两边都抛错”。
    return {
      kind: 'throw',
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 输出单项测试结果；失败时打印差异说明。
 * @param {boolean} ok 是否通过
 * @param {string} title 用例标题
 * @param {string} [detail] 失败详情
 * @returns {boolean} 原样返回 ok 供汇总
 */
function report(ok, title, detail = '') {
  // 通过时只打印简短结果，保持回归日志可扫描。
  if (ok) {
    console.log(`✓ ${title}`);
    return true;
  }

  // 失败时输出详情，便于定位源码差异或行为差异。
  console.error(`✗ ${title}`);
  if (detail) console.error(detail);
  return false;
}

/**
 * 主入口：依次执行四类验收，任一失败则设置非零退出码。
 */
function main() {
  const positiveInput = readFixture('01-positive-input.js');
  const positiveExpected = readFixture('01-positive-expected.js');
  const positiveGot = runPlugin(positiveInput);

  const negativeInput = readFixture('02-negative-input.js');
  const negativeExpected = readFixture('02-negative-expected.js');
  const negativeGot = runPlugin(negativeInput);

  const idempotentInput = readFixture('03-idempotent-input.js');
  const idempotentExpected = readFixture('03-idempotent-expected.js');
  const once = runPlugin(idempotentInput);
  const twice = runPlugin(once);

  const behaviorInput = readFixture('04-behavior-input.js');
  const behaviorExpected = readFixture('04-behavior-expected.js');
  const behaviorGot = runPlugin(behaviorInput);
  const beforeBehavior = observe(behaviorInput);
  const afterBehavior = observe(behaviorGot);

  const splitInput = readFixture('06-split-order-input.js');
  const splitExpected = readFixture('06-split-order-expected.js');
  const splitGot = runPlugin(splitInput);
  const splitBefore = observe(splitInput);
  const splitAfter = observe(splitGot);

  const results = [
    report(
      normalizeCode(positiveGot) === normalizeCode(positiveExpected),
      '正例：按静态 order 还原',
      `--- got ---\n${positiveGot}\n--- expected ---\n${positiveExpected}`
    ),
    report(
      normalizeCode(negativeGot) === normalizeCode(negativeExpected),
      '反例：case 声明风险失败关闭',
      `--- got ---\n${negativeGot}\n--- expected ---\n${negativeExpected}`
    ),
    report(
      normalizeCode(once) === normalizeCode(idempotentExpected) &&
        normalizeCode(twice) === normalizeCode(once),
      '幂等：第二轮不再改变',
      `--- once ---\n${once}\n--- twice ---\n${twice}`
    ),
    report(
      normalizeCode(behaviorGot) === normalizeCode(behaviorExpected) &&
        JSON.stringify(beforeBehavior) === JSON.stringify(afterBehavior) &&
        beforeBehavior.kind === 'throw' &&
        beforeBehavior.name === 'Error' &&
        beforeBehavior.message === 'step|step',
      '行为：重复 case 与 throw 保持一致',
      `before=${JSON.stringify(beforeBehavior)} after=${JSON.stringify(afterBehavior)}`
    ),
    report(
      normalizeCode(splitGot) === normalizeCode(splitExpected) &&
        JSON.stringify(splitBefore) === JSON.stringify(splitAfter),
      '正例：字符串 split 静态 order',
      `--- got ---\n${splitGot}\n--- expected ---\n${splitExpected}`
    ),
  ];

  const failed = results.filter((ok) => !ok).length;

  // 任一用例失败都必须让命令失败，避免 CI 把部分通过误判为阶段完成。
  if (failed > 0) {
    console.error(`\n${failed} 项失败（共 ${results.length}）`);
    process.exitCode = 1;
  } else {
    console.log(`\n全部通过（${results.length}）`);
  }
}

main();
