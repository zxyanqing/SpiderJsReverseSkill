/**
 * 字面量内联增强：在 Binding.constant 的 var/let/const 上传播基础字面量；
 * 折叠声明 init 中的纯字符串 SequenceExpression；静态数组下标只读折叠。
 *
 * 比 const-propagate 更宽（允许 var/let），但对 LHS/update/delete 等不安全替换目标失败关闭。
 * 大样本可按家族配方跳过本插件。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 */
function isPrimitiveNode(t, node) {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

/**
 * @param {import('@babel/traverse').NodePath} path
 */
function getReplacementTarget(path) {
  let current = path;
  while (current.parentPath.isMemberExpression() && current.key === 'object') {
    current = current.parentPath;
  }
  return current;
}

/**
 * @param {import('@babel/traverse').NodePath} path
 */
function isUnsafeReplacementTarget(path) {
  const target = getReplacementTarget(path);
  if (target.parentPath.isUpdateExpression() && target.key === 'argument') return true;
  if (
    (target.parentPath.isAssignmentExpression() || target.parentPath.isAssignmentPattern()) &&
    target.key === 'left'
  ) {
    return true;
  }
  if (
    (target.parentPath.isForInStatement() || target.parentPath.isForOfStatement()) &&
    target.key === 'left'
  ) {
    return true;
  }
  if (target.parentPath.isUnaryExpression({ operator: 'delete' }) && target.key === 'argument') {
    return true;
  }
  if (target.parentPath.isObjectProperty() && target.key === 'key' && !target.parent.computed) {
    return true;
  }
  return false;
}

/**
 * @param {import('@babel/traverse').NodePath} path
 * @param {import('@babel/types').Node} node
 */
function replaceSafely(path, node) {
  if (isUnsafeReplacementTarget(path)) return false;
  path.replaceWith(node);
  return true;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function inlineLiterals({ types: t } = {}) {
  const stats = createStats('inline-literals');
  if (!t) throw new Error('inline-literals 需要 api.types');

  return {
    name: 'inline-literals',
    stats,
    visitor: {
      MemberExpression(path) {
        if (
          t.isArrayExpression(path.node.object) &&
          path.node.object.elements.length === 0 &&
          t.isArrayExpression(path.node.property) &&
          path.node.property.elements.length === 0
        ) {
          stats.matched += 1;
          if (replaceSafely(path, t.identifier('undefined'))) {
            stats.changed += 1;
          } else {
            skip(stats, 'unsafe-empty-member');
          }
        }
      },

      VariableDeclarator(path) {
        if (!path.get('id').isIdentifier()) return;
        const name = path.node.id.name;
        const init = path.node.init;
        const binding = path.scope.getBinding(name);
        if (!binding) return;

        if (t.isStringLiteral(init) || t.isNumericLiteral(init) || t.isBooleanLiteral(init)) {
          stats.matched += 1;
          if (!binding.constant) {
            skip(stats, 'not-constant');
            return;
          }
          let replacedAll = binding.referencePaths.length > 0;
          let replacedAny = false;
          for (const refPath of binding.referencePaths) {
            if (!replaceSafely(refPath, t.cloneNode(init, true))) {
              replacedAll = false;
              continue;
            }
            replacedAny = true;
            stats.changed += 1;
          }
          if (replacedAny && replacedAll) {
            path.remove();
          } else if (!replacedAny) {
            skip(stats, 'no-safe-refs');
          }
          return;
        }

        if (
          t.isSequenceExpression(init) &&
          init.expressions.length > 0 &&
          init.expressions.every((expr) => t.isStringLiteral(expr))
        ) {
          stats.matched += 1;
          path
            .get('init')
            .replaceWith(t.cloneNode(init.expressions[init.expressions.length - 1], true));
          stats.changed += 1;
          return;
        }

        if (
          t.isArrayExpression(init) &&
          init.elements.length > 0 &&
          init.elements.every((el) => el && isPrimitiveNode(t, el))
        ) {
          stats.matched += 1;
          let replacedAll = binding.referencePaths.length > 0;
          let replacedCount = 0;
          for (const refPath of binding.referencePaths) {
            const parent = refPath.parentPath;
            if (!parent.isMemberExpression({ object: refPath.node }) || !parent.get('property').isNumericLiteral()) {
              replacedAll = false;
              continue;
            }
            const index = parent.node.property.value;
            if (!init.elements[index]) {
              replacedAll = false;
              continue;
            }
            if (!replaceSafely(parent, t.cloneNode(init.elements[index], true))) {
              replacedAll = false;
              continue;
            }
            replacedCount += 1;
            stats.changed += 1;
          }
          if (replacedAll && replacedCount > 0) {
            path.remove();
          } else if (replacedCount === 0) {
            skip(stats, 'array-no-static-index');
          }
        }
      },
    },
  };
}
