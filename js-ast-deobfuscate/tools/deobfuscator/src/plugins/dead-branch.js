/**
 * Stage 6 · 静态死分支清理
 *
 * 功能：在 test 可证明为布尔常量时，折叠 IfStatement / ConditionalExpression。
 * 不做：动态条件、非布尔 evaluate 结果、带 label 的复杂控制流猜测。
 *
 * 对照：docs/06-解混淆模式库/08-不可达代码与无用绑定.md；博客「删除冗余逻辑」。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 */
function isLiteralLike(t, node) {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

/**
 * 假常量比较：`1===1` / `"a"!="b"` 等（对齐 AD prune-fake-branches）。
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 * @returns {boolean | null}
 */
function evaluateLiteralCompare(t, node) {
  if (!t.isBinaryExpression(node) || !['==', '===', '!=', '!=='].includes(node.operator)) {
    return null;
  }
  if (!isLiteralLike(t, node.left) || !isLiteralLike(t, node.right)) {
    return null;
  }
  const left = t.isIdentifier(node.left, { name: 'undefined' }) ? undefined : node.left.value;
  const right = t.isIdentifier(node.right, { name: 'undefined' }) ? undefined : node.right.value;
  switch (node.operator) {
    case '==':
      return left == right;
    case '===':
      return left === right;
    case '!=':
      return left != right;
    case '!==':
      return left !== right;
    default:
      return null;
  }
}

/**
 * 证明 Path 的值为确定布尔常量。
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} testPath
 * @returns {{ok: true, value: boolean} | {ok: false}}
 */
function readStaticBoolean(t, testPath) {
  if (testPath.isBooleanLiteral()) {
    return { ok: true, value: testPath.node.value };
  }

  const compared = evaluateLiteralCompare(t, testPath.node);
  if (typeof compared === 'boolean') {
    return { ok: true, value: compared };
  }

  // 允许 `!![]` 等在 evaluate 自信且结果为 boolean 时折叠（常与 constant-fold 配合）。
  const evaluated = testPath.evaluate();
  if (evaluated.confident && typeof evaluated.value === 'boolean') {
    return { ok: true, value: evaluated.value };
  }

  return { ok: false };
}

/**
 * 用选中的 if 分支替换整条 IfStatement。
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} path
 * @param {import('@babel/types').Statement | null | undefined} selected
 */
function replaceIfWithBranch(t, path, selected) {
  if (!selected) {
    path.remove();
    return;
  }

  if (t.isBlockStatement(selected)) {
    if (selected.body.length === 0) {
      path.remove();
      return;
    }
    path.replaceWithMultiple(selected.body.map((statement) => t.cloneNode(statement, true)));
    return;
  }

  path.replaceWith(t.cloneNode(selected, true));
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function deadBranch({ types: t } = {}) {
  const stats = createStats('dead-branch');
  if (!t) throw new Error('dead-branch 需要 api.types');

  return {
    name: 'dead-branch',
    stats,
    visitor: {
      IfStatement: {
        exit(path) {
          stats.matched += 1;
          const proved = readStaticBoolean(t, path.get('test'));
          if (!proved.ok) {
            skip(stats, 'dynamic-condition');
            return;
          }

          const selected = proved.value ? path.node.consequent : path.node.alternate;
          replaceIfWithBranch(t, path, selected);
          stats.changed += 1;
        },
      },

      ConditionalExpression(path) {
        stats.matched += 1;
        const proved = readStaticBoolean(t, path.get('test'));
        if (!proved.ok) {
          skip(stats, 'dynamic-condition');
          return;
        }

        const selected = proved.value ? path.node.consequent : path.node.alternate;
        path.replaceWith(t.cloneNode(selected, true));
        stats.changed += 1;
      },
    },
  };
}
