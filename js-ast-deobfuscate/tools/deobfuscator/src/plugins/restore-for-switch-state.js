/**
 * for (; state !== EXIT;) + switch(state) 线性展平
 *
 * 在 normalize-object-ref-state（或本身已是字面量标签）之后使用。
 * 每 case：业务语句 + `state = LIT; break;`，或终端 return/throw。
 * 条件边 / 回边 / 动态标签 → skip。
 *
 * 与 restore-explicit-state-machine（while(true)+continue）互补。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types').Node | null} node
 * @returns {string | null}
 */
function literalKey(node) {
  if (node?.type === 'StringLiteral') return `string:${node.value}`;
  if (node?.type === 'NumericLiteral' && Number.isFinite(node.value)) {
    return `number:${node.value}`;
  }
  return null;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Statement[]} body
 */
function bodyHasForbidden(t, body) {
  for (const statement of body) {
    let bad = false;
    t.traverseFast(statement, (node) => {
      if (bad) return;
      if (
        t.isVariableDeclaration(node) ||
        t.isFunctionDeclaration(node) ||
        t.isClassDeclaration(node) ||
        t.isBreakStatement(node) ||
        t.isContinueStatement(node) ||
        t.isReturnStatement(node) ||
        t.isThrowStatement(node) ||
        t.isLabeledStatement(node) ||
        t.isTryStatement(node) ||
        t.isSwitchStatement(node) ||
        t.isWhileStatement(node) ||
        t.isDoWhileStatement(node) ||
        t.isForStatement(node) ||
        t.isForInStatement(node) ||
        t.isForOfStatement(node) ||
        t.isFunction(node) ||
        t.isIfStatement(node)
      ) {
        bad = true;
      }
    });
    if (bad) return true;
  }
  return false;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').SwitchCase} caseNode
 * @param {string} stateName
 */
function analyzeBreakCase(t, caseNode, stateName) {
  const consequent = [...caseNode.consequent];
  if (consequent.length === 0) return { ok: false, reason: 'empty-case' };

  const last = consequent[consequent.length - 1];
  if (t.isReturnStatement(last) || t.isThrowStatement(last)) {
    const body = consequent.slice(0, -1);
    if (bodyHasForbidden(t, body)) return { ok: false, reason: 'unsafe-case-body' };
    return {
      ok: true,
      body,
      kind: t.isReturnStatement(last) ? 'return' : 'throw',
      terminal: last,
    };
  }

  // 末尾：state = LIT; break;
  if (consequent.length < 2) return { ok: false, reason: 'short-case' };
  const brk = consequent[consequent.length - 1];
  const assignStmt = consequent[consequent.length - 2];
  if (!t.isBreakStatement(brk) || brk.label) return { ok: false, reason: 'missing-break' };
  if (!t.isExpressionStatement(assignStmt) || !t.isAssignmentExpression(assignStmt.expression)) {
    return { ok: false, reason: 'missing-state-assign' };
  }
  const assign = assignStmt.expression;
  if (assign.operator !== '=' || !t.isIdentifier(assign.left, { name: stateName })) {
    return { ok: false, reason: 'bad-state-assign' };
  }
  const next = literalKey(assign.right);
  if (next === null) return { ok: false, reason: 'dynamic-next-state' };

  const body = consequent.slice(0, -2);
  if (bodyHasForbidden(t, body)) return { ok: false, reason: 'unsafe-case-body' };
  return { ok: true, body, kind: 'goto', next };
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function restoreForSwitchState({ types: t } = {}) {
  const stats = createStats('restore-for-switch-state');
  if (!t) throw new Error('restore-for-switch-state 需要 api.types');

  return {
    name: 'restore-for-switch-state',
    stats,
    visitor: {
      ForStatement(path) {
        // for (; state !== EXIT;) { switch(state) { ... } }
        if (path.node.init !== null) return;
        if (path.node.update !== null) return;
        const test = path.get('test');
        if (!test.isBinaryExpression() || test.node.operator !== '!==') return;
        if (!test.get('left').isIdentifier()) return;
        const exitKey = literalKey(test.node.right);
        if (exitKey === null) {
          skip(stats, 'dynamic-exit');
          return;
        }

        const stateName = test.node.left.name;
        const body = path.get('body');
        if (!body.isBlockStatement() || body.node.body.length !== 1) return;
        const switchPath = body.get('body.0');
        if (!switchPath.isSwitchStatement()) return;
        if (!switchPath.get('discriminant').isIdentifier({ name: stateName })) return;

        const stateBinding = switchPath.scope.getBinding(stateName);
        if (!stateBinding || !stateBinding.path.isVariableDeclarator()) return;
        const initial = literalKey(stateBinding.path.node.init);
        if (initial === null) {
          skip(stats, 'dynamic-entry');
          return;
        }

        stats.matched += 1;

        /** @type {Map<string, object>} */
        const cases = new Map();
        for (const casePath of switchPath.get('cases')) {
          if (!casePath.node.test) {
            skip(stats, 'default-case');
            return;
          }
          const key = literalKey(casePath.node.test);
          if (key === null) {
            skip(stats, 'dynamic-case-label');
            return;
          }
          if (cases.has(key)) {
            skip(stats, 'duplicate-case');
            return;
          }
          const analyzed = analyzeBreakCase(t, casePath.node, stateName);
          if (!analyzed.ok) {
            skip(stats, analyzed.reason);
            return;
          }
          cases.set(key, analyzed);
        }

        const resultBody = [];
        const visited = new Set();
        let current = initial;
        let guard = 0;
        while (guard++ < 256) {
          if (current === exitKey) {
            // 正常离开 for
            break;
          }
          if (visited.has(current)) {
            skip(stats, 'back-edge');
            return;
          }
          visited.add(current);
          const node = cases.get(current);
          if (!node) {
            skip(stats, 'missing-case');
            return;
          }
          resultBody.push(...node.body.map((s) => t.cloneNode(s, true)));
          if (node.kind === 'goto') {
            current = node.next;
            continue;
          }
          resultBody.push(t.cloneNode(node.terminal, true));
          // 终端：替换整个 for，并尝试删除仅用于状态机的 state 声明
          path.replaceWithMultiple(resultBody);
          maybeRemoveStateDecl(stateBinding, path);
          stats.changed += 1;
          return;
        }

        if (current !== exitKey && guard >= 256) {
          skip(stats, 'unroll-limit');
          return;
        }

        path.replaceWithMultiple(resultBody);
        maybeRemoveStateDecl(stateBinding, path);
        stats.changed += 1;
      },
    },
  };
}

/**
 * @param {object} stateBinding
 * @param {import('@babel/traverse').NodePath} forPath
 */
function maybeRemoveStateDecl(stateBinding, forPath) {
  // 仅当声明紧邻且替换后无引用时由后续 unused-binding 处理；此处不强制删，避免破坏外层。
  void stateBinding;
  void forPath;
}
