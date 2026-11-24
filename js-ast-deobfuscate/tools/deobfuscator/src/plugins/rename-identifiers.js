/**
 * 标识符可读化（可选）：重命名 `_0x…` / 单字母绑定，按 init/引用形态生成 uid。
 *
 * **不进默认 A 链**；仅当用户显式 `--plugins …,rename-identifiers` 时启用。
 */

import { createStats, skip } from '../lib/stats.js';

const typeAlias = {
  ArrayExpression: 'array',
  AssignmentExpression: 'assign',
  AwaitExpression: 'await',
  BinaryExpression: 'bin',
  BooleanLiteral: 'bool',
  CallExpression: 'call',
  ConditionalExpression: 'cond',
  FunctionExpression: 'func',
  Identifier: 'id',
  LogicalExpression: 'logic',
  MemberExpression: 'member',
  NewExpression: 'new',
  NullLiteral: 'null',
  NumericLiteral: 'num',
  ObjectExpression: 'obj',
  SequenceExpression: 'seq',
  StringLiteral: 'str',
  ThisExpression: 'this',
  UnaryExpression: 'unary',
};

/**
 * @param {string} name
 */
function shouldRename(name) {
  return /^_0x/i.test(name) || /^[a-zA-Z]$/.test(name);
}

/**
 * @param {string} scopeTag
 * @param {object | null | undefined} binding
 * @param {import('@babel/types').Node | null | undefined} init
 */
function buildName(scopeTag, binding, init) {
  const fromInit = init && typeAlias[init.type];
  const fromRef =
    binding &&
    binding.referencePaths[0] &&
    typeAlias[binding.referencePaths[0].parentPath.type];
  const base = fromInit || fromRef || 'value';
  return `${scopeTag}_${base}`;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function renameIdentifiers({ types: t } = {}) {
  const stats = createStats('rename-identifiers');
  if (!t) throw new Error('rename-identifiers 需要 api.types');

  return {
    name: 'rename-identifiers',
    stats,
    visitor: {
      VariableDeclarator(path) {
        if (!path.get('id').isIdentifier()) return;
        const name = path.node.id.name;
        stats.matched += 1;
        if (!shouldRename(name)) {
          skip(stats, 'name-ok');
          return;
        }
        const binding = path.scope.getBinding(name);
        const scopeTag = path.scope.block.type === 'Program' ? 'glb' : 'loc';
        const nextName = path.scope.generateUidIdentifier(buildName(scopeTag, binding, path.node.init))
          .name;
        path.scope.rename(name, nextName);
        stats.changed += 1;
      },
      CatchClause(path) {
        if (path.node.param && t.isIdentifier(path.node.param)) {
          stats.matched += 1;
          path.scope.rename(
            path.node.param.name,
            path.scope.generateUidIdentifier('error_msg').name,
          );
          stats.changed += 1;
        }
      },
      FunctionDeclaration: {
        exit(path) {
          renameFunctionBindings(path, stats, t);
        },
      },
      FunctionExpression: {
        exit(path) {
          renameFunctionBindings(path, stats, t);
        },
      },
      ArrowFunctionExpression: {
        exit(path) {
          renameFunctionBindings(path, stats, t);
        },
      },
    },
  };
}

/**
 * @param {import('@babel/traverse').NodePath} path
 * @param {ReturnType<typeof createStats>} stats
 * @param {import('@babel/types')} t
 */
function renameFunctionBindings(path, stats, t) {
  if (path.node.id && t.isIdentifier(path.node.id) && shouldRename(path.node.id.name)) {
    stats.matched += 1;
    path.scope.rename(path.node.id.name, path.scope.generateUidIdentifier('fn').name);
    stats.changed += 1;
  }
  path.node.params.forEach((param, index) => {
    if (t.isIdentifier(param) && shouldRename(param.name)) {
      stats.matched += 1;
      path.scope.rename(param.name, `arg_${index + 1}`);
      stats.changed += 1;
    }
  });
}
