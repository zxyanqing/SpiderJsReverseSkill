/**
 * dispatcher 对象内联：把只含字面量 / 二元·逻辑·call 包装的对象属性
 * 在 CallExpression / MemberExpression 处展开；属性全部可收集时删除声明。
 *
 * 不做：带副作用的复杂函数体、动态键、部分属性不可收集时的声明删除。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 * @param {Record<string, Record<string, object>>} dispatcherMap
 */
function collectDispatcherValue(t, node, dispatcherMap) {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
    return { type: 'literal', value: t.cloneNode(node, true) };
  }
  if (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object) &&
    !node.computed &&
    t.isIdentifier(node.property)
  ) {
    return { type: 'member', objectName: node.object.name, key: node.property.name };
  }
  if (t.isFunctionExpression(node) && node.body.body.length === 1 && t.isReturnStatement(node.body.body[0])) {
    const arg = node.body.body[0].argument;
    if (t.isBinaryExpression(arg) && t.isIdentifier(arg.left) && t.isIdentifier(arg.right)) {
      return { type: 'binary', operator: arg.operator };
    }
    if (t.isLogicalExpression(arg) && t.isIdentifier(arg.left) && t.isIdentifier(arg.right)) {
      return { type: 'logical', operator: arg.operator };
    }
    if (t.isCallExpression(arg) && t.isIdentifier(arg.callee)) {
      return { type: 'call' };
    }
    if (
      t.isCallExpression(arg) &&
      t.isMemberExpression(arg.callee) &&
      t.isIdentifier(arg.callee.object) &&
      !arg.callee.computed &&
      t.isIdentifier(arg.callee.property)
    ) {
      const target =
        dispatcherMap[arg.callee.object.name] &&
        dispatcherMap[arg.callee.object.name][arg.callee.property.name];
      if (target && (target.type === 'binary' || target.type === 'logical' || target.type === 'call')) {
        return target;
      }
    }
  }
  return null;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function inlineDispatchers({ types: t } = {}) {
  const stats = createStats('inline-dispatchers');
  if (!t) throw new Error('inline-dispatchers 需要 api.types');

  return {
    name: 'inline-dispatchers',
    stats,
    visitor: {
      Program: {
        enter(programPath) {
          const dispatcherMap = Object.create(null);
          /** @type {{path: import('@babel/traverse').NodePath, removable: boolean}[]} */
          const removableEntries = [];

          programPath.traverse({
            VariableDeclarator(path) {
              if (!path.get('id').isIdentifier() || !path.get('init').isObjectExpression()) {
                return;
              }
              const name = path.node.id.name;
              const collected = dispatcherMap[name] || Object.create(null);
              let localChanged = false;
              let supportedPropertyCount = 0;
              let collectedPropertyCount = 0;
              path.get('init.properties').forEach((propertyPath) => {
                if (!propertyPath.isObjectProperty()) return;
                supportedPropertyCount += 1;
                const keyNode = propertyPath.node.key;
                const key = t.isIdentifier(keyNode) ? keyNode.name : keyNode.value;
                const value = collectDispatcherValue(t, propertyPath.node.value, dispatcherMap);
                if (value) {
                  collected[key] = value;
                  localChanged = true;
                  collectedPropertyCount += 1;
                }
              });
              if (localChanged) {
                stats.matched += 1;
                dispatcherMap[name] = collected;
                removableEntries.push({
                  path,
                  removable: supportedPropertyCount > 0 && supportedPropertyCount === collectedPropertyCount,
                });
              }
            },
          });

          let changed = false;

          programPath.traverse({
            CallExpression(path) {
              if (!path.get('callee').isMemberExpression()) return;
              if (!path.get('callee.object').isIdentifier()) return;
              const objectName = path.node.callee.object.name;
              const key = path.node.callee.computed
                ? path.node.callee.property.value
                : path.node.callee.property.name;
              const entry = dispatcherMap[objectName] && dispatcherMap[objectName][key];
              if (!entry) return;
              const args = path.node.arguments.map((arg) => t.cloneNode(arg, true));
              if (entry.type === 'binary' && args.length >= 2) {
                path.replaceWith(t.binaryExpression(entry.operator, args[0], args[1]));
                changed = true;
                stats.changed += 1;
              } else if (entry.type === 'logical' && args.length >= 2) {
                path.replaceWith(t.logicalExpression(entry.operator, args[0], args[1]));
                changed = true;
                stats.changed += 1;
              } else if (entry.type === 'call' && args.length >= 1) {
                path.replaceWith(t.callExpression(args[0], args.slice(1)));
                changed = true;
                stats.changed += 1;
              } else {
                skip(stats, 'call-arity-mismatch');
              }
            },
            MemberExpression(path) {
              if (!path.get('object').isIdentifier()) return;
              // 不做 CallExpression 的 callee：上面已处理
              if (path.parentPath.isCallExpression() && path.parentPath.get('callee') === path) {
                return;
              }
              const objectName = path.node.object.name;
              const key = path.node.computed ? path.node.property.value : path.node.property.name;
              const entry = dispatcherMap[objectName] && dispatcherMap[objectName][key];
              if (!entry || entry.type !== 'literal') return;
              path.replaceWith(t.cloneNode(entry.value, true));
              changed = true;
              stats.changed += 1;
            },
          });

          if (changed) {
            for (const { path, removable } of removableEntries) {
              if (removable && !path.removed) {
                path.remove();
              }
            }
          }
        },
      },
    },
  };
}
