/**
 * 插件：常量折叠（constant-fold）
 *
 * 功能：对 Babel `path.evaluate()` 能自信求出、且可用普通字面量准确表示的
 * BinaryExpression / UnaryExpression / LogicalExpression，替换成对应字面量节点。
 *
 * 不做：
 * - 对赋值左侧表达式动手（避免破坏 `a = 1` 的左值）
 * - 在 evaluate 不自信（confident=false）时强行折叠
 * - 把 NaN / Infinity / 非有限数字、undefined、对象等写成「假字面量」
 *
 * 对照教程：docs/05-Babel-AST基础/07-三插件实战.md、docs/06-解混淆模式库/03-常量与条件化简进阶.md
 */

import tDefault from '@babel/types';
import { createStats, skip } from '../lib/stats.js';

/**
 * 把 evaluate 得到的 JS 值转成可安全回写的 Babel 字面量节点。
 * 返回 null 表示「虽可能算出了值，但本插件拒绝用字面量表示」，调用方应跳过。
 *
 * @param {unknown} value path.evaluate().value
 * @param {typeof import('@babel/types')} t @babel/types
 * @returns {import('@babel/types').Node|null}
 */
function literalFrom(value, t) {
  // 数字：排除 NaN（避免歧义）与 Infinity/-Infinity（NumericLiteral 表示不稳）
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) return null;
    return t.numericLiteral(value);
  }

  // 字符串 / 布尔 / null：有稳定字面量节点，可直接构造
  if (typeof value === 'string') return t.stringLiteral(value);
  if (typeof value === 'boolean') return t.booleanLiteral(value);
  if (value === null) return t.nullLiteral();

  // undefined、bigint、对象、函数等：本插件不硬折，保留原表达式
  return null;
}

/**
 * 判断当前 Path 是否处于赋值表达式的左侧。
 * 左侧折叠会破坏赋值目标，必须跳过。
 *
 * @param {import('@babel/traverse').NodePath} path
 * @returns {boolean}
 */
function isAssignmentLeft(path) {
  return (
    path.parentPath.isAssignmentExpression() &&
    path.parentPath.get('left') === path
  );
}

/**
 * 插件工厂：每次调用创建独立 stats，供流水线/多轮收敛观察。
 * @param {{types?: typeof import('@babel/types')}} [api] 脚手架传入的 { types }
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function constantFold({ types: tFromApi } = {}) {
  const t = tFromApi ?? tDefault;
  const stats = createStats('constant-fold');

  return {
    name: 'constant-fold',
    stats,
    visitor: {
      /**
       * 命中二元 / 一元 / 逻辑表达式：先 guard，再 evaluate，最后按白名单回写字面量。
       * @param {import('@babel/traverse').NodePath} path
       */
      'BinaryExpression|UnaryExpression|LogicalExpression'(path) {
        // matched：形状命中（三种表达式之一），不代表一定会改写
        stats.matched += 1;

        // guard：赋值左侧不可折叠，否则会改坏左值语义
        if (isAssignmentLeft(path)) {
          skip(stats, 'assignment-left');
          return;
        }

        // evaluate：Babel 内部已较保守；不自信则不得替换
        const evaluated = path.evaluate();
        if (!evaluated.confident) {
          skip(stats, 'not-confident');
          return;
        }

        // guard：结果必须能映射到本插件白名单字面量
        const literal = literalFrom(evaluated.value, t);
        if (!literal) {
          skip(stats, 'unsupported-value');
          return;
        }

        // transform：用字面量替换原表达式；副作用已被 evaluate/guard 挡住
        path.replaceWith(literal);
        stats.changed += 1;
      },
    },
  };
}
