/**
 * if (disc === lit) / else-if 链 → switch(disc)。
 * 同时合并同块内连续无 alternate 的同判别式 if。
 *
 * 不做：判别式不一致、非 ==/===、少于 2 个 case。
 */

import generatorMod from '@babel/generator';
import { createStats, skip } from '../lib/stats.js';

const generate = generatorMod.default ?? generatorMod;

/**
 * @param {import('@babel/types').Node} node
 */
function normalizeCode(node) {
  return generate(node, {
    compact: true,
    comments: false,
    jsescOption: { minimal: true },
  }).code;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} testNode
 */
function getCaseInfo(t, testNode) {
  if (!t.isBinaryExpression(testNode) || !['==', '==='].includes(testNode.operator)) {
    return null;
  }
  const leftLiteral = t.isLiteral(testNode.left);
  const rightLiteral = t.isLiteral(testNode.right);
  if (leftLiteral === rightLiteral) return null;
  if (leftLiteral) {
    return { discriminant: testNode.right, caseValue: testNode.left };
  }
  return { discriminant: testNode.left, caseValue: testNode.right };
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node | null | undefined} node
 */
function toCaseStatements(t, node) {
  if (!node) return [];
  if (t.isBlockStatement(node)) {
    return node.body.map((stmt) => t.cloneNode(stmt, true));
  }
  return [t.cloneNode(node, true)];
}

/**
 * @param {import('@babel/traverse').NodePath} path
 */
function unwrapAlternate(path) {
  if (!path.node) return { kind: 'empty', path: null, node: null };
  if (path.isIfStatement()) return { kind: 'if', path, node: path.node };
  if (path.isBlockStatement()) {
    const body = path.get('body');
    if (body.length === 1 && body[0].isIfStatement()) {
      return { kind: 'if', path: body[0], node: body[0].node };
    }
    return { kind: 'default', path, node: path.node };
  }
  return { kind: 'default', path, node: path.node };
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 */
function isTerminalStatement(t, node) {
  return (
    t.isReturnStatement(node) ||
    t.isThrowStatement(node) ||
    t.isBreakStatement(node) ||
    t.isContinueStatement(node)
  );
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} path
 */
function collectIfChain(t, path) {
  if (path.parentPath.isIfStatement() && path.key === 'alternate') return null;

  let currentPath = path;
  let discriminantCode = null;
  let discriminantNode = null;
  const cases = [];
  let defaultStatements = null;

  while (currentPath && currentPath.isIfStatement()) {
    const info = getCaseInfo(t, currentPath.node.test);
    if (!info) return null;

    const currentCode = normalizeCode(info.discriminant);
    if (discriminantCode === null) {
      discriminantCode = currentCode;
      discriminantNode = t.cloneNode(info.discriminant, true);
    } else if (currentCode !== discriminantCode) {
      return null;
    }

    cases.push({
      test: t.cloneNode(info.caseValue, true),
      statements: toCaseStatements(t, currentPath.node.consequent),
    });

    const alternate = unwrapAlternate(currentPath.get('alternate'));
    if (alternate.kind === 'empty') break;
    if (alternate.kind === 'if') {
      currentPath = alternate.path;
      continue;
    }
    defaultStatements = toCaseStatements(t, alternate.node);
    break;
  }

  if (cases.length < 2) return null;
  return { discriminant: discriminantNode, cases, defaultStatements };
}

/**
 * @param {import('@babel/types')} t
 * @param {{discriminant: import('@babel/types').Node, cases: object[], defaultStatements: object[] | null}} chain
 */
function buildSwitchStatementFromChain(t, chain) {
  const switchCases = chain.cases.map((entry) => {
    const statements = entry.statements.slice();
    if (statements.length === 0 || !isTerminalStatement(t, statements[statements.length - 1])) {
      statements.push(t.breakStatement());
    }
    return t.switchCase(entry.test, statements);
  });

  if (chain.defaultStatements) {
    switchCases.push(t.switchCase(null, chain.defaultStatements));
  }

  return t.switchStatement(chain.discriminant, switchCases);
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath[]} statementPaths
 * @param {number} startIndex
 */
function collectConsecutiveIfCases(t, statementPaths, startIndex) {
  const firstPath = statementPaths[startIndex];
  if (!firstPath || !firstPath.isIfStatement() || firstPath.node.alternate) return null;

  const firstInfo = getCaseInfo(t, firstPath.node.test);
  if (!firstInfo) return null;

  const discriminantCode = normalizeCode(firstInfo.discriminant);
  const cases = [
    {
      test: t.cloneNode(firstInfo.caseValue, true),
      statements: toCaseStatements(t, firstPath.node.consequent),
    },
  ];

  let endIndex = startIndex + 1;
  while (endIndex < statementPaths.length) {
    const nextPath = statementPaths[endIndex];
    if (!nextPath.isIfStatement() || nextPath.node.alternate) break;
    const info = getCaseInfo(t, nextPath.node.test);
    if (!info || normalizeCode(info.discriminant) !== discriminantCode) break;
    cases.push({
      test: t.cloneNode(info.caseValue, true),
      statements: toCaseStatements(t, nextPath.node.consequent),
    });
    endIndex += 1;
  }

  if (cases.length < 2) return null;

  return {
    startIndex,
    endIndex,
    switchNode: buildSwitchStatementFromChain(t, {
      discriminant: t.cloneNode(firstInfo.discriminant, true),
      cases,
      defaultStatements: null,
    }),
  };
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath[]} statementPaths
 */
function rewriteStatementList(t, statementPaths) {
  if (!Array.isArray(statementPaths) || statementPaths.length < 2) return null;

  const nextBody = [];
  let changed = false;

  for (let index = 0; index < statementPaths.length; ) {
    const run = collectConsecutiveIfCases(t, statementPaths, index);
    if (!run) {
      nextBody.push(statementPaths[index].node);
      index += 1;
      continue;
    }
    nextBody.push(run.switchNode);
    index = run.endIndex;
    changed = true;
  }

  return changed ? nextBody : null;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function ifChainToSwitch({ types: t } = {}) {
  const stats = createStats('if-chain-to-switch');
  if (!t) throw new Error('if-chain-to-switch 需要 api.types');

  return {
    name: 'if-chain-to-switch',
    stats,
    visitor: {
      IfStatement(path) {
        stats.matched += 1;
        const chain = collectIfChain(t, path);
        if (!chain) {
          skip(stats, 'not-opcode-chain');
          return;
        }
        path.replaceWith(buildSwitchStatementFromChain(t, chain));
        stats.changed += 1;
      },
      Program: {
        exit(path) {
          const nextBody = rewriteStatementList(t, path.get('body'));
          if (nextBody) {
            path.node.body = nextBody;
            stats.changed += 1;
          }
        },
      },
      BlockStatement: {
        exit(path) {
          if (path.parentPath.isSwitchCase()) return;
          const nextBody = rewriteStatementList(t, path.get('body'));
          if (nextBody) {
            path.node.body = nextBody;
            stats.changed += 1;
          }
        },
      },
      SwitchCase: {
        exit(path) {
          const nextConsequent = rewriteStatementList(t, path.get('consequent'));
          if (nextConsequent) {
            path.node.consequent = nextConsequent;
            stats.changed += 1;
          }
        },
      },
    },
  };
}
