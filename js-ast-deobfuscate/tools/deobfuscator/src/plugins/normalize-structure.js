/**
 * 结构标准化：安全上下文拆 SequenceExpression / 语句级三元与逻辑短路 /
 * void 表达式、无参 IIFE、switch case 多余 Block。
 *
 * 不做：带 continue 的 for update 序列搬移；非列表位置的 return/if 序列拆分。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Expression[]} expressions
 */
function toStatements(t, expressions) {
  return expressions.map((expr) => t.expressionStatement(t.cloneNode(expr, true)));
}

/**
 * @param {import('@babel/traverse').NodePath} bodyPath
 */
function hasUnsafeContinue(bodyPath) {
  let found = false;
  bodyPath.traverse({
    Function(path) {
      path.skip();
    },
    ContinueStatement(path) {
      found = true;
      path.stop();
    },
  });
  return found;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} path
 */
function ensureBlockWithT(t, path) {
  if (path.isBlockStatement()) return path;
  path.replaceWith(t.blockStatement([path.node]));
  return path.parentPath.get(path.key);
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} path
 * @param {import('@babel/types').Statement} node
 */
function replaceStatement(t, path, node) {
  if (path.inList) {
    path.replaceWith(node);
    return;
  }
  path.replaceWith(t.blockStatement([node]));
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} path
 * @param {import('@babel/types').Statement[]} statements
 */
function replaceStatementWithStatements(t, path, statements) {
  if (statements.length === 0) {
    path.remove();
    return;
  }
  if (path.inList) {
    path.replaceWithMultiple(statements);
    return;
  }
  if (statements.length === 1) {
    path.replaceWith(statements[0]);
    return;
  }
  path.replaceWith(t.blockStatement(statements));
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function normalizeStructure({ types: t } = {}) {
  const stats = createStats('normalize-structure');
  if (!t) throw new Error('normalize-structure 需要 api.types');

  return {
    name: 'normalize-structure',
    stats,
    visitor: {
      UnaryExpression(path) {
        if (path.node.operator !== 'void' || !path.parentPath.isExpressionStatement()) {
          return;
        }
        stats.matched += 1;
        path.replaceWith(path.node.argument);
        stats.changed += 1;
      },

      SequenceExpression(path) {
        stats.matched += 1;

        if (path.parentPath.isExpressionStatement()) {
          replaceStatementWithStatements(t, path.parentPath, toStatements(t, path.node.expressions));
          stats.changed += 1;
          return;
        }

        if (path.parentPath.isReturnStatement()) {
          if (!path.parentPath.inList) {
            skip(stats, 'return-not-in-list');
            return;
          }
          const exprs = path.node.expressions.slice();
          const returnExpr = exprs.pop();
          path.parentPath.insertBefore(toStatements(t, exprs));
          path.replaceWith(returnExpr);
          stats.changed += 1;
          return;
        }

        if (path.parentPath.isIfStatement() && path.key === 'test') {
          if (!path.parentPath.inList) {
            skip(stats, 'if-test-not-in-list');
            return;
          }
          const exprs = path.node.expressions.slice();
          const testExpr = exprs.pop();
          path.parentPath.insertBefore(toStatements(t, exprs));
          path.replaceWith(testExpr);
          stats.changed += 1;
          return;
        }

        if (path.parentPath.isForStatement() && path.key === 'init') {
          if (!path.parentPath.inList) {
            skip(stats, 'for-init-not-in-list');
            return;
          }
          path.parentPath.insertBefore(toStatements(t, path.node.expressions));
          path.remove();
          stats.changed += 1;
          return;
        }

        if (path.parentPath.isForStatement() && path.key === 'test') {
          const exprs = path.node.expressions.slice();
          const testExpr = exprs.pop();
          const forPath = path.parentPath;
          const bodyPath = ensureBlockWithT(t, forPath.get('body'));
          bodyPath.unshiftContainer(
            'body',
            t.ifStatement(
              t.unaryExpression('!', testExpr, true),
              t.blockStatement([t.breakStatement()]),
            ),
          );
          bodyPath.unshiftContainer('body', toStatements(t, exprs));
          path.remove();
          stats.changed += 1;
          return;
        }

        if (path.parentPath.isForStatement() && path.key === 'update') {
          const forPath = path.parentPath;
          const bodyPath = ensureBlockWithT(t, forPath.get('body'));
          if (hasUnsafeContinue(bodyPath)) {
            skip(stats, 'for-update-has-continue');
            return;
          }
          bodyPath.pushContainer('body', toStatements(t, path.node.expressions));
          path.remove();
          stats.changed += 1;
          return;
        }

        skip(stats, 'sequence-unsafe-context');
      },

      ConditionalExpression(path) {
        if (!path.parentPath.isExpressionStatement()) return;
        stats.matched += 1;
        replaceStatement(
          t,
          path.parentPath,
          t.ifStatement(
            path.node.test,
            t.blockStatement([t.expressionStatement(path.node.consequent)]),
            t.blockStatement([t.expressionStatement(path.node.alternate)]),
          ),
        );
        stats.changed += 1;
      },

      LogicalExpression(path) {
        if (!path.parentPath.isExpressionStatement()) return;
        stats.matched += 1;
        const body = t.blockStatement([t.expressionStatement(path.node.right)]);
        if (path.node.operator === '&&') {
          replaceStatement(t, path.parentPath, t.ifStatement(path.node.left, body, null));
          stats.changed += 1;
        } else if (path.node.operator === '||') {
          replaceStatement(
            t,
            path.parentPath,
            t.ifStatement(t.unaryExpression('!', path.node.left, true), body, null),
          );
          stats.changed += 1;
        } else {
          skip(stats, 'logical-nullish');
        }
      },

      AssignmentExpression(path) {
        if (!path.parentPath.isExpressionStatement() || !t.isConditionalExpression(path.node.right)) {
          return;
        }
        stats.matched += 1;
        const test = path.node.right.test;
        const consequent = t.expressionStatement(
          t.assignmentExpression(
            path.node.operator,
            t.cloneNode(path.node.left, true),
            path.node.right.consequent,
          ),
        );
        const alternate = t.expressionStatement(
          t.assignmentExpression(
            path.node.operator,
            t.cloneNode(path.node.left, true),
            path.node.right.alternate,
          ),
        );
        replaceStatement(
          t,
          path.parentPath,
          t.ifStatement(test, t.blockStatement([consequent]), t.blockStatement([alternate])),
        );
        stats.changed += 1;
      },

      CallExpression(path) {
        if (!path.parentPath.isExpressionStatement()) return;

        if (path.get('callee').isFunctionExpression() && path.node.arguments.length === 0) {
          stats.matched += 1;
          replaceStatementWithStatements(
            t,
            path.parentPath,
            path.node.callee.body.body.map((s) => t.cloneNode(s, true)),
          );
          stats.changed += 1;
          return;
        }

        if (
          path.get('callee').isMemberExpression() &&
          path.get('callee.object').isFunctionExpression() &&
          path.get('callee.property').isIdentifier({ name: 'call' }) &&
          path.node.arguments.length === 1 &&
          path.get('arguments.0').isThisExpression()
        ) {
          stats.matched += 1;
          replaceStatementWithStatements(
            t,
            path.parentPath,
            path.node.callee.object.body.body.map((s) => t.cloneNode(s, true)),
          );
          stats.changed += 1;
        }
      },

      BlockStatement(path) {
        if (!path.parentPath.isSwitchCase()) return;
        stats.matched += 1;
        path.replaceWithMultiple(path.node.body.map((s) => t.cloneNode(s, true)));
        stats.changed += 1;
      },
    },
  };
}
