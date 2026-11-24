/**
 * 数组序控制流拍平（可证明子集）。
 *
 * 支持：
 * 1) for (var order = [...|split], …; ; ) { switch(…) { case: …; continue } }
 *    —— order 来自 init 静态数组 / 静态 split；case 无词法声明；按 order 拼接。
 * 2) while (true|!![]) { switch }，前驱兄弟声明静态 order，且 case 键集合与 order 一致。
 *
 * 不做：对象表管道串、动态 resolveStatic 链、switch→if 中间态（过宽逻辑仍 gaps）。
 * 与 restore-sequential-dispatcher 互补：后者要求 order[cursor++] 独占 Binding。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node | null} node
 */
function literalKey(t, node) {
  if (t.isStringLiteral(node)) return `string:${node.value}`;
  if (t.isNumericLiteral(node) && Number.isFinite(node.value)) return `number:${node.value}`;
  return null;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} initPath
 * @returns {string[] | null}
 */
function readStaticOrder(t, initPath) {
  if (
    initPath.isCallExpression() &&
    initPath.get('callee').isMemberExpression() &&
    initPath.get('arguments').length === 1 &&
    initPath.get('arguments.0').isStringLiteral()
  ) {
    const callee = initPath.get('callee');
    const prop = callee.get('property');
    const isSplit =
      (!callee.node.computed && prop.isIdentifier({ name: 'split' })) ||
      (callee.node.computed && prop.isStringLiteral({ value: 'split' }));
    if (isSplit && callee.get('object').isStringLiteral()) {
      const parts = callee.node.object.value.split(initPath.node.arguments[0].value);
      if (parts.length === 0) return null;
      return parts.map((p) => `string:${p}`);
    }
  }

  if (!initPath.isArrayExpression()) return null;
  const keys = [];
  for (const el of initPath.node.elements) {
    if (!el || el.type === 'SpreadElement') return null;
    const key = literalKey(t, el);
    if (!key) return null;
    keys.push(key);
  }
  return keys.length > 0 ? keys : null;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Statement[]} nodes
 */
function hasLexicalBindings(t, nodes) {
  return nodes.some((node) => t.isVariableDeclaration(node) && node.kind !== 'var');
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} casePath
 */
function getCaseStatements(t, casePath) {
  return casePath
    .get('consequent')
    .filter((stmt) => !stmt.isContinueStatement() && !stmt.isBreakStatement())
    .map((stmt) => t.cloneNode(stmt.node, true));
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} switchPath
 * @param {string[]} order
 */
function buildBlocksFromSwitchOrder(t, switchPath, order) {
  const caseMap = new Map();
  for (const casePath of switchPath.get('cases')) {
    if (!casePath.node.test) continue;
    const key = literalKey(t, casePath.node.test);
    if (!key) return null;
    const stmts = getCaseStatements(t, casePath);
    if (hasLexicalBindings(t, stmts)) return null;
    caseMap.set(key, stmts);
  }

  const blocks = [];
  for (const key of order) {
    const stmts = caseMap.get(key);
    if (stmts) blocks.push(...stmts.map((s) => t.cloneNode(s, true)));
  }
  return blocks.length > 0 ? blocks : null;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} loopPath
 * @param {number} maxSiblings
 */
function findNearbyOrderDeclaration(t, loopPath, maxSiblings = 3) {
  let siblingPath = loopPath.getPrevSibling();
  for (let seen = 0; siblingPath && siblingPath.node && seen < maxSiblings; seen += 1) {
    if (!siblingPath.isVariableDeclaration()) break;
    for (const declaratorPath of siblingPath.get('declarations')) {
      if (!declaratorPath.node || !declaratorPath.get('init').node) continue;
      const order = readStaticOrder(t, declaratorPath.get('init'));
      if (order) {
        return { order, declarationPath: siblingPath };
      }
    }
    siblingPath = siblingPath.getPrevSibling();
  }
  return null;
}

/**
 * @param {import('@babel/traverse').NodePath} testPath
 */
function isTruthyLoopTest(testPath) {
  if (testPath.isBooleanLiteral({ value: true })) return true;
  const evaluated = testPath.evaluate();
  return evaluated.confident && evaluated.value === true;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function flattenArrayControlFlow({ types: t } = {}) {
  const stats = createStats('flatten-array-control-flow');
  if (!t) throw new Error('flatten-array-control-flow 需要 api.types');

  return {
    name: 'flatten-array-control-flow',
    stats,
    visitor: {
      ForStatement(path) {
        const body = path.get('body');
        if (!body.isBlockStatement() || body.get('body').length === 0) return;
        const firstStmt = body.get('body.0');
        if (!firstStmt.isSwitchStatement()) return;
        if (!path.get('init').isVariableDeclaration() || path.node.update !== null) return;
        if (!path.inList) return;

        stats.matched += 1;

        let order = null;
        const leftovers = [];
        for (const decl of path.get('init.declarations')) {
          if (decl.node.init === null) {
            leftovers.push(t.variableDeclaration('var', [t.cloneNode(decl.node, true)]));
            continue;
          }
          const candidate = readStaticOrder(t, decl.get('init'));
          if (candidate) order = candidate;
        }

        if (!order) {
          skip(stats, 'for-order-not-static');
          return;
        }

        const blocks = buildBlocksFromSwitchOrder(t, firstStmt, order);
        if (!blocks) {
          skip(stats, 'for-case-unsafe-or-empty');
          return;
        }

        path.replaceWithMultiple([...leftovers, ...blocks]);
        stats.changed += 1;
      },

      WhileStatement(path) {
        if (!isTruthyLoopTest(path.get('test'))) return;
        if (!path.get('body').isBlockStatement()) return;
        if (!path.inList) return;

        const bodyStmts = path.get('body.body');
        if (bodyStmts.length !== 1 || !bodyStmts[0].isSwitchStatement()) return;

        stats.matched += 1;
        const switchStmt = bodyStmts[0];
        const nearby = findNearbyOrderDeclaration(t, path);
        if (!nearby) {
          skip(stats, 'while-no-nearby-order');
          return;
        }

        const blocks = buildBlocksFromSwitchOrder(t, switchStmt, nearby.order);
        if (!blocks) {
          skip(stats, 'while-case-unsafe-or-empty');
          return;
        }

        path.replaceWithMultiple(blocks);
        if (nearby.declarationPath && !nearby.declarationPath.removed) {
          nearby.declarationPath.remove();
        }
        stats.changed += 1;
      },
    },
  };
}
