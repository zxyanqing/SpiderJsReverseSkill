/**
 * C2 · 收敛循环
 * 目标：对同一棵 AST 反复跑插件列表，直到无改写或生成文本稳定；
 * 超过最大轮次则抛错，用于暴露插件震荡。
 */

import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import { createStats } from './stats.js';

// 兼容 Babel 包的 default / 直接导出，后续只使用统一后的 API 名称
const traverse = traverseModule.default ?? traverseModule;
const generate = generatorModule.default ?? generatorModule;

/**
 * 把当前 AST 生成源码文本，用于「文本级」稳定性比较。
 * @param {object} ast Babel File AST
 * @returns {string} 生成后的 JS 源码
 */
function generateSource(ast) {
  // compact:false 便于人工阅读报告；注释保留以免误伤样本语义线索
  return generate(ast, { compact: false, comments: true }).code;
}

/**
 * 在一轮中运行单个插件工厂，并返回本轮统计。
 * @param {object} ast 正在改写的 AST（原地修改）
 * @param {Function|object} pluginOrFactory
 *   - 工厂：`(api) => { name, visitor, stats? }`
 *   - 或已构造对象：`{ name, visitor, stats? }`
 * @param {{types?: object}} api 传给工厂的上下文（至少可含 types）
 * @returns {{name: string, changed: number, matched: number, skipped: number, reasons: object, stats: object}}
 */
function runOnePlugin(ast, pluginOrFactory, api) {
  // 每轮重新调用工厂，确保 createStats 得到全新计数器，避免跨轮污染
  const plugin =
    typeof pluginOrFactory === 'function'
      ? pluginOrFactory(api)
      : pluginOrFactory;

  // 工厂若未自带 stats，在此补一份，保证报告字段齐全
  if (!plugin.stats) {
    plugin.stats = createStats(plugin.name ?? 'anonymous-plugin');
  }

  // 缺少 visitor 视为接口错误：这不是「证据不足跳过」，而是插件实现损坏
  if (!plugin.visitor || typeof plugin.visitor !== 'object') {
    throw new Error(
      `插件 ${plugin.name ?? '(未命名)'} 缺少 visitor；runUntilStable 无法执行`
    );
  }

  // 对本轮新建的 visitor 做一次完整 traverse；插件内部应维护 stats.changed
  traverse(ast, plugin.visitor);

  return {
    name: plugin.name ?? 'anonymous-plugin',
    changed: plugin.stats.changed ?? 0,
    matched: plugin.stats.matched ?? 0,
    skipped: plugin.stats.skipped ?? 0,
    reasons: plugin.stats.reasons ?? {},
    stats: plugin.stats,
  };
}

/**
 * 多轮收敛驱动：固定顺序重复执行 plugins，直到稳定或超限。
 *
 * 停止条件（满足其一即停）：
 * 1. 本轮所有插件 `changed` 之和为 0（没有任何 AST 改写）
 * 2. 本轮生成源码与上一轮完全相同（防止 changed 统计漏记/虚报导致假循环）
 *
 * @param {object} ast Babel File AST；函数会原地修改它
 * @param {Array<Function|object>} plugins 插件工厂或插件对象列表（顺序固定）
 * @param {number} [maxRounds=6] 最大轮次；用于暴露震荡，不是「多跑几次总会好」
 * @param {{types?: object}} [api={}] 传给每个插件工厂的 API（如 { types: t }）
 * @returns {{ast: object, rounds: number, reports: Array<{round: number, changed: number, plugins: object[]}>}}
 */
export function runUntilStable(ast, plugins, maxRounds = 6, api = {}) {
  // 插件列表必须是非空数组；空列表会导致「永远 changed===0」的假收敛，掩盖配置错误
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new Error('runUntilStable 需要非空 plugins 数组');
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error(`maxRounds 必须是正整数，收到: ${maxRounds}`);
  }

  // previous：上一轮生成文本；第一轮开始前先拍快照，便于与第 1 轮结果比较
  let previous = generateSource(ast);
  const reports = [];

  // 按轮次循环：每轮都重新创建各插件统计，再累加 changed
  for (let round = 1; round <= maxRounds; round += 1) {
    // roundReports：本轮每个插件的独立报告，便于解释「谁在第几轮改了什么」
    const roundReports = [];
    let changed = 0;

    // 固定顺序跑完本轮所有插件；后一个插件可以看到前一个插件刚写出的新字面量
    for (const pluginOrFactory of plugins) {
      const report = runOnePlugin(ast, pluginOrFactory, api);
      roundReports.push(report);
      changed += report.changed;
    }

    // current：本轮结束后的源码文本，用于文本级稳定性判断
    const current = generateSource(ast);
    reports.push({ round, changed, plugins: roundReports, code: current });

    // 停止条件 1：本轮没有任何真实改写
    // 停止条件 2：生成文本与上一轮相同（即便 changed 因 bug 非 0，也不继续空转）
    if (changed === 0 || current === previous) {
      return {
        ast,
        rounds: round,
        reports,
        code: current,
      };
    }

    // 进入下一轮前更新快照
    previous = current;
  }

  // 超过上限仍有变化：通常是两个插件互相改写（震荡），必须失败而不是静默截断
  throw new Error(
    `runUntilStable: 已执行 ${maxRounds} 轮仍未收敛，可能存在插件震荡；请检查相邻 Pass 是否互相创造无限变化`
  );
}

export default runUntilStable;
