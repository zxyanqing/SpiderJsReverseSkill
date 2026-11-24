/**
 * Stage 8 · 显式状态机自动还原（严格线性子集）
 *
 * 仅当：while(true)+switch(state)、入口与 case 标签静态、
 * 每态恰好一条无条件 goto 或终端 return/throw、无回边、case 体安全时，
 * 按入口展开为顺序语句。
 * 条件边 / 动态 state / 回边 → 失败关闭（半自动分析仍可用独立脚本）。
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
 * 去掉末尾 `state = LIT; continue;` 或单独 continue/break，返回业务体 + 转移信息。
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').SwitchCase} caseNode
 * @param {object} stateBinding
 * @returns
 *   | {ok: true, body: object[], kind: 'goto', next: string}
 *   | {ok: true, body: object[], kind: 'return'|'throw', terminal: object}
 *   | {ok: false, reason: string}
 */
function analyzeCase(t, caseNode, stateBinding) {
  const consequent = [...caseNode.consequent];
  if (consequent.length === 0) return { ok: false, reason: 'empty-case' };

  // return / throw 终端
  const last = consequent[consequent.length - 1];
  if (t.isReturnStatement(last) || t.isThrowStatement(last)) {
    const body = consequent.slice(0, -1);
    // 终端前的体不允许再含 return/throw/声明等
    if (bodyHasForbidden(t, body)) return { ok: false, reason: 'unsafe-case-body' };
    return {
      ok: true,
      body,
      kind: t.isReturnStatement(last) ? 'return' : 'throw',
      terminal: last,
    };
  }

  // 期望末尾：state = LIT; continue;
  if (consequent.length < 2) return { ok: false, reason: 'short-case' };
  const cont = consequent[consequent.length - 1];
  const assignStmt = consequent[consequent.length - 2];
  if (!t.isContinueStatement(cont) || cont.label) {
    return { ok: false, reason: 'missing-continue' };
  }
  if (!t.isExpressionStatement(assignStmt) || !t.isAssignmentExpression(assignStmt.expression)) {
    return { ok: false, reason: 'missing-state-assign' };
  }
  const assign = assignStmt.expression;
  if (assign.operator !== '=' || !t.isIdentifier(assign.left)) {
    return { ok: false, reason: 'bad-state-assign' };
  }
  // Binding 对齐（通过名字；完整 Binding 比较在调用方用 scope）
  if (assign.left.name !== stateBinding.identifier.name) {
    return { ok: false, reason: 'state-name-mismatch' };
  }
  const next = literalKey(assign.right);
  if (next === null) return { ok: false, reason: 'dynamic-next-state' };

  const body = consequent.slice(0, -2);
  if (bodyHasForbidden(t, body)) return { ok: false, reason: 'unsafe-case-body' };

  return { ok: true, body, kind: 'goto', next };
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
        t.isFunction(node)
      ) {
        bad = true;
      }
    });
    if (bad) return true;
  }
  return false;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function restoreExplicitStateMachine({ types: t } = {}) {
  const stats = createStats('restore-explicit-state-machine');
  if (!t) throw new Error('restore-explicit-state-machine 需要 api.types');

  return {
    name: 'restore-explicit-state-machine',
    stats,
    visitor: {
      WhileStatement(path) {
        if (!path.get('test').isBooleanLiteral({ value: true })) return;
        const body = path.get('body');
        if (!body.isBlockStatement()) return;

        const statements = body.get('body');
        if (statements.length !== 1 || !statements[0].isSwitchStatement()) {
          // 允许多语句时只取唯一 switch；其它形态跳过
          const switches = statements.filter((s) => s.isSwitchStatement());
          if (switches.length !== 1 || statements.length !== 1) return;
        }

        const switchPath = statements.find((s) => s.isSwitchStatement());
        if (!switchPath) return;

        const discriminant = switchPath.get('discriminant');
        if (!discriminant.isIdentifier()) return;
        const stateBinding = switchPath.scope.getBinding(discriminant.node.name);
        if (!stateBinding || !stateBinding.path.isVariableDeclarator()) return;

        const initial = literalKey(stateBinding.path.get('init').node);
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
          const analyzed = analyzeCase(t, casePath.node, stateBinding);
          if (!analyzed.ok) {
            skip(stats, analyzed.reason);
            return;
          }
          cases.set(key, analyzed);
        }

        // 从入口展开；禁止回边；每态最多访问一次
        const resultBody = [];
        const visited = new Set();
        let current = initial;
        let guard = 0;
        while (guard++ < 256) {
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
          // 成功展开
          path.replaceWithMultiple(resultBody);
          stats.changed += 1;
          return;
        }

        skip(stats, 'unroll-limit');
      },
    },
  };
}
