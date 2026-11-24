/**
 * 对象身份状态表正规化
 *
 * 识别：table()[i][j]（i/j 为 NumericLiteral），且 table() 在子进程中求值为
 * 「二维数组、单元格均为对象引用」（可含循环引用）。
 * 变换：同一对象身份 → 稳定递增 id，回写 NumericLiteral。
 *
 * 支持 callee：
 * - Identifier（局部函数 / 变量）
 * - MemberExpression `ns.prop`（Program 上对 ns 的属性赋值 + function ns(){} 前缀可拼闭包）
 *
 * 不做：主进程 eval；单元格非对象；动态下标；无法拼闭包时硬猜。
 */

import generatorModule from '@babel/generator';
import { createStats, skip } from '../lib/stats.js';
import { evaluateInChildSync } from '../lib/evaluate-in-child.js';

const generate = generatorModule.default ?? generatorModule;

/**
 * @param {import('@babel/types').Node} node
 * @returns {{callee: object, i: number, j: number} | null}
 */
function matchDoubleIndexCall(node) {
  // table()[i][j]
  if (node?.type !== 'MemberExpression' || !node.computed) return null;
  if (node.property?.type !== 'NumericLiteral' || !Number.isFinite(node.property.value)) {
    return null;
  }
  const mid = node.object;
  if (mid?.type !== 'MemberExpression' || !mid.computed) return null;
  if (mid.property?.type !== 'NumericLiteral' || !Number.isFinite(mid.property.value)) {
    return null;
  }
  const call = mid.object;
  if (call?.type !== 'CallExpression' || call.arguments.length !== 0) return null;
  return {
    callee: call.callee,
    i: mid.property.value,
    j: node.property.value,
  };
}

/**
 * @param {import('@babel/types').Node} callee
 * @returns {string | null}
 */
function calleeKey(callee) {
  if (callee?.type === 'Identifier') return `id:${callee.name}`;
  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.property?.type === 'Identifier'
  ) {
    return `mem:${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

/**
 * 为 Identifier 表函数拼最小闭包。
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} bindingPath
 */
function closureForIdentifierBinding(t, bindingPath) {
  if (bindingPath.isFunctionDeclaration()) {
    return { ok: true, header: generate(bindingPath.node, { compact: false }).code, callName: bindingPath.node.id.name };
  }
  if (bindingPath.isVariableDeclarator() && bindingPath.node.id.type === 'Identifier') {
    const name = bindingPath.node.id.name;
    const init = bindingPath.node.init;
    if (!init || (init.type !== 'FunctionExpression' && init.type !== 'ArrowFunctionExpression')) {
      return { ok: false, reason: 'unsupported-table-init' };
    }
    const kind = bindingPath.parent.kind || 'var';
    const decl = t.variableDeclaration(kind, [t.cloneNode(bindingPath.node, true)]);
    return { ok: true, header: generate(decl, { compact: false }).code, callName: name };
  }
  return { ok: false, reason: 'unsupported-table-binding' };
}

/**
 * 为 ns.prop 收集 Program 前缀：ns.* 赋值 + function ns(){}。
 * @param {import('@babel/traverse').NodePath} programPath
 * @param {string} nsName
 * @param {string} propName
 */
function closureForNamespaceMethod(programPath, nsName, propName) {
  const nodes = [];
  let sawProp = false;
  let sawFn = false;

  for (const stmt of programPath.get('body')) {
    if (
      stmt.isExpressionStatement() &&
      stmt.get('expression').isAssignmentExpression() &&
      stmt.get('expression.left').isMemberExpression()
    ) {
      const left = stmt.node.expression.left;
      if (
        !left.computed &&
        left.object.type === 'Identifier' &&
        left.object.name === nsName &&
        left.property.type === 'Identifier'
      ) {
        nodes.push(stmt.node);
        if (left.property.name === propName) sawProp = true;
        continue;
      }
    }
    if (stmt.isFunctionDeclaration() && stmt.node.id?.name === nsName) {
      nodes.push(stmt.node);
      sawFn = true;
      break;
    }
    // 尚未收齐前遇到无关语句 → 失败关闭（避免吞进业务 IIFE）
    if (sawProp) break;
    if (nodes.length > 0) {
      return { ok: false, reason: 'namespace-prelude-interrupted' };
    }
    return { ok: false, reason: 'namespace-prelude-missing' };
  }

  if (!sawProp || !sawFn || nodes.length === 0) {
    return { ok: false, reason: 'namespace-prelude-incomplete' };
  }

  const header = nodes.map((n) => generate(n, { compact: false }).code).join('\n');
  return { ok: true, header, callName: null, nsName, propName };
}

/**
 * @param {string} header
 * @param {{callName?: string|null, nsName?: string, propName?: string}} target
 */
function buildMappedTableBody(header, target) {
  const callExpr = target.callName
    ? `${target.callName}()`
    : `${target.nsName}.${target.propName}()`;
  // 子进程只允许回传白名单基础类型：成功时返回 JSON 字符串；失败 throw。
  return `${header}
const __table = ${callExpr};
if (!Array.isArray(__table)) throw new Error('not-array');
const __ids = new WeakMap();
let __n = 0;
function __idOf(cell) {
  if (cell === null || (typeof cell !== 'object' && typeof cell !== 'function')) {
    throw new Error('non-object-cell:' + typeof cell);
  }
  if (!__ids.has(cell)) __ids.set(cell, __n++);
  return __ids.get(cell);
}
const __mapped = [];
for (let r = 0; r < __table.length; r++) {
  const row = __table[r];
  if (!Array.isArray(row)) throw new Error('row-not-array:' + r);
  const outRow = [];
  for (let c = 0; c < row.length; c++) {
    outRow.push(__idOf(row[c]));
  }
  __mapped.push(outRow);
}
return JSON.stringify(__mapped);
`;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function normalizeObjectRefState({ types: t } = {}) {
  const stats = createStats('normalize-object-ref-state');
  if (!t) throw new Error('normalize-object-ref-state 需要 api.types');

  return {
    name: 'normalize-object-ref-state',
    stats,
    visitor: {
      Program(programPath) {
        /** @type {Map<string, {sites: object[], callee: object}>} */
        const groups = new Map();

        programPath.traverse({
          MemberExpression(path) {
            const matched = matchDoubleIndexCall(path.node);
            if (!matched) return;
            const key = calleeKey(matched.callee);
            if (!key) {
              skip(stats, 'unsupported-callee');
              return;
            }
            stats.matched += 1;
            if (!groups.has(key)) groups.set(key, { sites: [], callee: matched.callee });
            groups.get(key).sites.push({ path, i: matched.i, j: matched.j });
          },
        });

        for (const [key, group] of groups) {
          let closure;
          if (key.startsWith('id:')) {
            const name = key.slice(3);
            const binding = programPath.scope.getBinding(name);
            if (!binding) {
              skip(stats, 'missing-binding');
              continue;
            }
            closure = closureForIdentifierBinding(t, binding.path);
            if (!closure.ok) {
              skip(stats, closure.reason);
              continue;
            }
          } else if (key.startsWith('mem:')) {
            const [, rest] = key.split('mem:');
            const [nsName, propName] = rest.split('.');
            closure = closureForNamespaceMethod(programPath, nsName, propName);
            if (!closure.ok) {
              skip(stats, closure.reason);
              continue;
            }
          } else {
            skip(stats, 'bad-group-key');
            continue;
          }

          const body = buildMappedTableBody(closure.header, closure);
          const evaluated = evaluateInChildSync(body, {
            timeoutMs: 5000,
            maxOutputBytes: 256 * 1024,
          });
          if (!evaluated.ok) {
            skip(stats, `eval:${evaluated.reason}`);
            continue;
          }
          if (typeof evaluated.value !== 'string') {
            skip(stats, 'mapped-not-string');
            continue;
          }

          let mapped;
          try {
            mapped = JSON.parse(evaluated.value);
          } catch {
            skip(stats, 'mapped-bad-json');
            continue;
          }
          if (!Array.isArray(mapped) || !mapped.every((row) => Array.isArray(row))) {
            skip(stats, 'mapped-shape');
            continue;
          }

          for (const site of group.sites) {
            const row = mapped[site.i];
            if (!row || site.j < 0 || site.j >= row.length) {
              skip(stats, 'index-oob');
              continue;
            }
            const id = row[site.j];
            if (typeof id !== 'number' || !Number.isFinite(id)) {
              skip(stats, 'id-not-number');
              continue;
            }
            site.path.replaceWith(t.numericLiteral(id));
            stats.changed += 1;
          }
        }
      },
    },
  };
}
