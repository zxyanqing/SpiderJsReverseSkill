/**
 * 插件：成员访问简化（member-simplify）
 *
 * 功能：把 `obj['push']` 这类「computed + 字符串字面量键」改成 `obj.push`
 *（computed: false + Identifier property），仅当键名是合法标识符。
 *
 * 不做：
 * - 已是点语法（computed=false）的节点
 * - 动态键：`obj[key]`、`obj[1+2]`
 * - 非法标识符键：`obj['a-b']`、`obj['123abc']`
 * - 保留字键：Babel `isValidIdentifier` 为 false 的名字（如 `class`）——即使 `obj.class` 在 JS 里合法，本插件与历史行为一致，不改
 *
 * 对照教程：docs/05-Babel-AST基础/07-三插件实战.md
 */

import tDefault from '@babel/types';
import { createStats, skip } from '../lib/stats.js';

/**
 * 判断属性名是否允许改成点语法右侧的 Identifier。
 * @param {string} name 字符串键
 * @param {typeof import('@babel/types')} t
 * @returns {boolean}
 */
function isValidIdentifierName(name, t) {
  return t.isValidIdentifier(name);
}

/**
 * 插件工厂。
 * @param {{types?: typeof import('@babel/types')}} [api]
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function memberSimplify({ types: tFromApi } = {}) {
  const t = tFromApi ?? tDefault;
  const stats = createStats('member-simplify');

  return {
    name: 'member-simplify',
    stats,
    visitor: {
      /**
       * 仅处理 MemberExpression：通过全部 guard 后，原地改 computed / property。
       * @param {import('@babel/traverse').NodePath} path MemberExpression
       */
      MemberExpression(path) {
        stats.matched += 1;

        // guard：已是点语法，无需简化
        if (!path.node.computed) {
          skip(stats, 'not-computed');
          return;
        }

        // guard：属性必须是静态字符串字面量（不能是 Identifier / 表达式）
        const prop = path.get('property');
        if (!prop.isStringLiteral()) {
          skip(stats, 'property-not-string-literal');
          return;
        }

        const name = prop.node.value;

        // guard：键名必须是合法标识符，否则点语法非法或本插件策略拒绝
        if (!isValidIdentifierName(name, t)) {
          skip(stats, 'invalid-identifier-name');
          return;
        }

        // transform：obj['push'] → obj.push（原地改字段，保持与历史脚手架一致）
        path.node.computed = false;
        path.node.property = t.identifier(name);
        stats.changed += 1;
      },
    },
  };
}
