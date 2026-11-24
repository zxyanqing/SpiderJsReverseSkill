/**
 * C9 · 环境依赖分析四类测试：正例、反例、幂等和不执行行为对照。
 * 运行：cd tools/deobfuscator && npm run test:c9
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import parser from '@babel/parser';
import generatorModule from '@babel/generator';
import {analyzeEnvironmentDependencies} from '../src/lib/analyze-environment-deps.js';

const generate = generatorModule.default ?? generatorModule;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, '../fixtures/c9');

/**
 * 读取 C9 fixture 文本或 JSON 期待文件。
 * @param {string} name fixture 文件名
 * @returns {string} UTF-8 内容
 */
function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

/**
 * 解析自建源码并生成只读环境依赖报告。
 * @param {string} source 自建 JavaScript 源码
 * @returns {{ast: object, report: object}} AST 与分析报告
 */
function analyzeSource(source) {
  // sourceType script 允许反例 fixture 使用 with；分析器本身仍然是 ESM 模块。
  const ast = parser.parse(source, {sourceType: 'script'});

  // 分析器只读取 AST；这里不调用生成函数、fetch、dangerous 或其它 fixture 函数。
  const report = analyzeEnvironmentDependencies(ast);
  return {ast, report};
}

/**
 * 断言一个条件成立，并在失败时抛出带测试上下文的错误。
 * @param {boolean} condition 待验证条件
 * @param {string} message 失败说明
 * @returns {void}
 */
function assert(condition, message) {
  // 测试失败必须中断 runner，防止部分通过被误报为阶段完成。
  if (!condition) throw new Error(message);
}

/**
 * 将一项依赖记录转换为路径索引条目。
 * @param {object} row 单项依赖记录
 * @returns {[string, object]} 路径与原记录
 */
function toDependencyEntry(row) {
  return [row.path, row];
}

/**
 * 从报告中按路径建立依赖索引。
 * @param {object} report 环境依赖报告
 * @returns {Map<string, object>} 路径到记录的映射
 */
function indexDependencies(report) {
  // 同一路径在不同 access 下可能有多项，测试样本当前每条路径只有一项。
  return new Map(report.dependencies.map(toDependencyEntry));
}

/**
 * 验证静态正例的路径和用途分类。
 * @returns {void}
 */
function testPositive() {
  const source = readFixture('01-positive-input.js');
  const expected = JSON.parse(readFixture('01-positive-expected.json'));
  const {report} = analyzeSource(source);
  const index = indexDependencies(report);

  // 每条静态路径都必须出现，缺失会导致后续矩阵不完整。
  for (const requiredPath of expected.requiredPaths) {
    assert(index.has(requiredPath), `正例缺少路径: ${requiredPath}`);
  }

  // purpose 是后续策略选择的证据，不能只验证路径字符串存在。
  for (const [dependencyPath, purpose] of Object.entries(expected.requiredPurposes)) {
    assert(index.get(dependencyPath)?.purpose === purpose, `用途分类错误: ${dependencyPath}`);
  }

  console.log('✓ 正例：静态依赖路径与用途分类');
}

/**
 * 验证局部遮蔽、动态属性、with 和 direct eval 的停止边界。
 * @returns {void}
 */
function testNegative() {
  const source = readFixture('02-negative-input.js');
  const expected = JSON.parse(readFixture('02-negative-expected.json'));
  const {report} = analyzeSource(source);
  const paths = new Set();
  const reasons = new Set();

  // 依赖记录同时贡献 path 和 reason，显式循环便于审查报告字段来源。
  for (const row of report.dependencies) {
    paths.add(row.path);
    reasons.add(row.reason);
  }

  // unknowns 只贡献停止原因，不伪装成可补环境的依赖路径。
  for (const row of report.unknowns) reasons.add(row.reason);

  // 函数参数 shadowed(navigator, window) 不得被误当作宿主对象。
  for (const ignoredPath of expected.ignoredPaths) {
    assert(!paths.has(ignoredPath), `局部同名被错误报告: ${ignoredPath}`);
  }

  // 三类风险必须各自留下可检索 reason，不能只因为 AST 没改就算通过。
  for (const reason of expected.requiredReasons) {
    assert(reasons.has(reason), `反例缺少停止原因: ${reason}`);
  }
  assert(report.summary.status === expected.status, '反例状态未进入 analyzed-with-stops');
  console.log('✓ 反例：局部遮蔽与动态/危险结构失败关闭');
}

/**
 * 验证分析器不修改 AST，重复分析报告保持稳定。
 * @returns {void}
 */
function testIdempotent() {
  const source = readFixture('03-idempotent-input.js');
  const first = analyzeSource(source);
  const before = generate(first.ast, {comments: false}).code;
  const second = analyzeSource(source);
  const after = generate(second.ast, {comments: false}).code;

  // 文本和 JSON 都必须稳定，证明分析器没有通过 replaceWith 或隐式执行改变输入。
  assert(before === after, '幂等样本 AST 生成结果发生变化');
  assert(JSON.stringify(first.report) === JSON.stringify(second.report), '幂等样本报告发生变化');
  console.log('✓ 幂等：重复分析不改源码且报告一致');
}

/**
 * 验证行为样本没有被分析器执行。
 * @returns {void}
 */
function testBehavior() {
  const source = readFixture('04-behavior-input.js');
  globalThis.__c9Touched = 0;

  // 这里只解析和分析源文本，绝不使用 new Function、eval 或动态 import 运行 fixture。
  const {report} = analyzeSource(source);

  // 若 analyzer 错误执行源码，dangerous() 会把标记改为 1；0 证明只读边界成立。
  assert(globalThis.__c9Touched === 0, '行为样本被错误执行');
  let foundGlobalWrite = false;

  // 明确寻找全局写入依赖，避免用输入源码执行结果代替静态报告。
  for (const row of report.dependencies) {
    // 只有目标路径精确匹配时才证明分析器记录了该全局写入。
    if (row.path === 'globalThis.__c9Touched') foundGlobalWrite = true;
  }
  assert(foundGlobalWrite, '未记录全局写入');
  console.log('✓ 行为：分析过程不执行被分析源码');
}

/**
 * 顺序运行 C9 四类测试并设置非零退出码。
 * @returns {void}
 */
function main() {
  // 四类测试分别覆盖发现、停止、稳定性和安全边界，不共享可变 AST。
  const tests = [testPositive, testNegative, testIdempotent, testBehavior];
  let failed = 0;

  // 每项测试独立捕获错误，使 runner 能报告失败数量后统一退出。
  for (const test of tests) {
    // 正常执行当前测试；断言失败会进入紧邻 catch 并累计。
    try {
      test();
    // 捕获单项失败后继续其它测试，最终仍由 failed 触发非零退出。
    } catch (error) {
      failed += 1;
      console.error(`✗ C9 测试失败: ${error.message}`);
    }
  }

  // 任一项失败都让 runner 失败，避免 CI 只看到其它通过项。
  if (failed > 0) {
    throw new Error(`${failed} 项 C9 测试失败`);
  }
  console.log(`\n全部通过（C9，${tests.length}）`);
}

main();
