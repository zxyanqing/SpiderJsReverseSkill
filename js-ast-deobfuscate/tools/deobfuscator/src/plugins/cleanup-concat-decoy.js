/**
 * 解密后死壳清理 · concat-decoy 别名脚手架 + 无引用 namespace 引导壳
 *
 * 支持两种同块形态：
 *
 * A) 分句：
 *   var x = tableRef;
 *   var arr = ['$_Decoy'].concat(x);
 *   var a = arr[1];
 *   arr.shift();
 *   var b = arr[0];
 *
 * B) 多样本常见的多 declarator：
 *   var x = tableRef, arr = ['$_Decoy'].concat(x), a = arr[1];
 *   arr.shift();
 *   var b = arr[0];
 *
 * 当 a/b 不再作为 CallExpression 被调用、且模式外无活引用时删除。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 */
function isConcatDecoyInit(t, node) {
  if (!t.isCallExpression(node) || node.arguments.length !== 1) return false;
  if (!t.isMemberExpression(node.callee) || node.callee.computed) return false;
  if (!t.isIdentifier(node.callee.property, { name: 'concat' })) return false;
  if (!t.isArrayExpression(node.callee.object) || node.callee.object.elements.length !== 1) {
    return false;
  }
  return t.isStringLiteral(node.callee.object.elements[0]);
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/types').Node} node
 * @param {string} arrName
 * @param {number} index
 */
function isArrIndexInit(t, node, arrName, index) {
  return (
    t.isMemberExpression(node) &&
    node.computed &&
    t.isIdentifier(node.object, { name: arrName }) &&
    t.isNumericLiteral(node.property, { value: index })
  );
}

/**
 * @param {import('@babel/traverse').Scope} scope
 * @param {string} name
 */
function hasCallReference(scope, name) {
  const binding = scope.getBinding(name);
  if (!binding) return false;
  return binding.referencePaths.some((ref) => {
    const parent = ref.parentPath;
    return parent?.isCallExpression() && parent.get('callee') === ref;
  });
}

/**
 * @param {import('@babel/traverse').NodePath} blockPath
 * @param {string} name
 * @param {import('@babel/traverse').NodePath[]} patternPaths
 */
function refsOnlyInside(blockPath, name, patternPaths) {
  const binding = blockPath.scope.getBinding(name);
  if (!binding) return true;
  if (binding.constantViolations.length > 0) return false;
  for (const ref of binding.referencePaths) {
    const inside = patternPaths.some((stmtPath) => !!ref.findParent((p) => p === stmtPath));
    if (!inside) return false;
  }
  return true;
}

/**
 * @param {{types: typeof import('@babel/types')}} api
 */
export default function cleanupConcatDecoy({ types: t } = {}) {
  const stats = createStats('cleanup-concat-decoy');
  if (!t) throw new Error('cleanup-concat-decoy 需要 api.types');

  /**
   * Try multi-declarator form at body[i].
   * @param {import('@babel/traverse').NodePath} blockPath
   * @param {import('@babel/traverse').NodePath[]} body
   * @param {number} i
   * @returns {boolean} whether a pattern was removed (caller should rescan)
   */
  function tryMultiDeclarator(blockPath, body, i) {
    const declStmt = body[i];
    if (!declStmt.isVariableDeclaration()) return false;
    const decls = declStmt.get('declarations');
    if (decls.length < 2 || decls.length > 3) return false;

    // Find concat declarator
    let concatIdx = -1;
    for (let k = 0; k < decls.length; k += 1) {
      if (isConcatDecoyInit(t, decls[k].node.init) && decls[k].get('id').isIdentifier()) {
        concatIdx = k;
        break;
      }
    }
    if (concatIdx < 0) return false;

    const arrName = decls[concatIdx].node.id.name;
    const tableArg = decls[concatIdx].node.init.arguments[0];

    // Optional table declarator before concat in same statement
    let tableName = tableArg.type === 'Identifier' ? tableArg.name : null;
    if (concatIdx > 0) {
      const prev = decls[concatIdx - 1];
      if (
        prev.get('id').isIdentifier() &&
        tableArg.type === 'Identifier' &&
        prev.node.id.name === tableArg.name
      ) {
        tableName = prev.node.id.name;
      } else if (concatIdx !== 0) {
        // unexpected declarator before concat
        return false;
      }
    }

    // Alias [1] must be next declarator after concat
    if (concatIdx + 1 >= decls.length) return false;
    const alias1Decl = decls[concatIdx + 1];
    if (!alias1Decl.get('id').isIdentifier()) return false;
    if (!isArrIndexInit(t, alias1Decl.node.init, arrName, 1)) return false;
    const alias1Name = alias1Decl.node.id.name;

    // Next stmt: arr.shift();
    if (i + 1 >= body.length || !body[i + 1].isExpressionStatement()) return false;
    const shiftStmt = body[i + 1];
    const shiftExpr = shiftStmt.get('expression');
    if (
      !shiftExpr.isCallExpression() ||
      shiftExpr.node.arguments.length !== 0 ||
      !shiftExpr.get('callee').isMemberExpression() ||
      shiftExpr.node.callee.computed ||
      !t.isIdentifier(shiftExpr.node.callee.object, { name: arrName }) ||
      !t.isIdentifier(shiftExpr.node.callee.property, { name: 'shift' })
    ) {
      return false;
    }

    // Next: var b = arr[0];
    if (i + 2 >= body.length || !body[i + 2].isVariableDeclaration()) return false;
    const alias0Stmt = body[i + 2];
    if (alias0Stmt.node.declarations.length !== 1) return false;
    const alias0Decl = alias0Stmt.get('declarations.0');
    if (!alias0Decl.get('id').isIdentifier()) return false;
    if (!isArrIndexInit(t, alias0Decl.node.init, arrName, 0)) return false;
    const alias0Name = alias0Decl.node.id.name;

    stats.matched += 1;

    if (hasCallReference(blockPath.scope, alias0Name) || hasCallReference(blockPath.scope, alias1Name)) {
      skip(stats, 'alias-still-called');
      return false;
    }
    if (tableName && hasCallReference(blockPath.scope, tableName)) {
      skip(stats, 'table-still-called');
      return false;
    }

    const patternPaths = [declStmt, shiftStmt, alias0Stmt];
    const names = [arrName, alias0Name, alias1Name];
    if (tableName) names.push(tableName);
    if (!names.every((name) => refsOnlyInside(blockPath, name, patternPaths))) {
      skip(stats, 'live-ref-outside');
      return false;
    }

    // Remove shift + alias0 first, then rewrite or remove the multi decl
    alias0Stmt.remove();
    shiftStmt.remove();
    stats.changed += 2;

    // Remove the entire multi-declarator statement (table+concat+alias1)
    declStmt.remove();
    stats.changed += 1;
    blockPath.scope.crawl();
    return true;
  }

  /**
   * Split-statement form (fixtures).
   * @param {import('@babel/traverse').NodePath} blockPath
   * @param {import('@babel/traverse').NodePath[]} body
   * @param {number} i
   */
  function trySplitForm(blockPath, body, i) {
    const d0 = body[i];
    if (!d0.isVariableDeclaration() || d0.node.declarations.length !== 1) return false;
    const concatDecl = d0.get('declarations.0');
    if (!concatDecl.get('id').isIdentifier()) return false;
    if (!isConcatDecoyInit(t, concatDecl.node.init)) return false;

    const arrName = concatDecl.node.id.name;
    const tableArg = concatDecl.node.init.arguments[0];

    let tableDeclPath = null;
    let tableName = tableArg.type === 'Identifier' ? tableArg.name : null;
    if (i > 0 && body[i - 1].isVariableDeclaration() && body[i - 1].node.declarations.length === 1) {
      const prev = body[i - 1].get('declarations.0');
      if (
        prev.get('id').isIdentifier() &&
        tableArg.type === 'Identifier' &&
        prev.node.id.name === tableArg.name
      ) {
        tableDeclPath = body[i - 1];
        tableName = prev.node.id.name;
      }
    }

    if (i + 3 >= body.length) return false;
    const d1 = body[i + 1];
    const shiftStmt = body[i + 2];
    const d3 = body[i + 3];
    if (!d1.isVariableDeclaration() || d1.node.declarations.length !== 1) return false;
    if (!shiftStmt.isExpressionStatement()) return false;
    if (!d3.isVariableDeclaration() || d3.node.declarations.length !== 1) return false;

    const alias1 = d1.get('declarations.0');
    const alias0 = d3.get('declarations.0');
    if (!alias1.get('id').isIdentifier() || !alias0.get('id').isIdentifier()) return false;
    if (!isArrIndexInit(t, alias1.node.init, arrName, 1)) return false;
    if (!isArrIndexInit(t, alias0.node.init, arrName, 0)) return false;

    const shiftExpr = shiftStmt.get('expression');
    if (
      !shiftExpr.isCallExpression() ||
      shiftExpr.node.arguments.length !== 0 ||
      !shiftExpr.get('callee').isMemberExpression() ||
      shiftExpr.node.callee.computed ||
      !t.isIdentifier(shiftExpr.node.callee.object, { name: arrName }) ||
      !t.isIdentifier(shiftExpr.node.callee.property, { name: 'shift' })
    ) {
      return false;
    }

    const alias1Name = alias1.node.id.name;
    const alias0Name = alias0.node.id.name;
    stats.matched += 1;

    if (hasCallReference(blockPath.scope, alias0Name) || hasCallReference(blockPath.scope, alias1Name)) {
      skip(stats, 'alias-still-called');
      return false;
    }
    if (tableName && hasCallReference(blockPath.scope, tableName)) {
      skip(stats, 'table-still-called');
      return false;
    }

    const patternPaths = tableDeclPath ? [tableDeclPath, d0, d1, shiftStmt, d3] : [d0, d1, shiftStmt, d3];
    const names = [arrName, alias0Name, alias1Name];
    if (!names.every((name) => refsOnlyInside(blockPath, name, patternPaths))) {
      skip(stats, 'live-ref-outside');
      return false;
    }

    for (const p of [d3, shiftStmt, d1, d0]) {
      p.remove();
      stats.changed += 1;
    }
    if (tableDeclPath) {
      blockPath.scope.crawl();
      const tName = tableDeclPath.get('declarations.0.id').node.name;
      const tb = blockPath.scope.getBinding(tName);
      if (tb && tb.referencePaths.length === 0 && tb.constantViolations.length === 0) {
        tableDeclPath.remove();
        stats.changed += 1;
      }
    }
    blockPath.scope.crawl();
    return true;
  }

  /**
   * @param {import('@babel/traverse').NodePath} blockPath
   */
  function cleanBlock(blockPath) {
    const body = blockPath.get('body');
    for (let i = 0; i < body.length; i += 1) {
      if (tryMultiDeclarator(blockPath, body, i)) return cleanBlock(blockPath);
      if (trySplitForm(blockPath, body, i)) return cleanBlock(blockPath);
    }
  }

  /**
   * @param {import('@babel/traverse').NodePath} programPath
   */
  function stripDeadNamespaceShell(programPath) {
    const body = programPath.get('body');
    /** @type {Map<string, {fnPath: object|null, assignPaths: object[]}>} */
    const namespaces = new Map();

    for (const stmt of body) {
      if (stmt.isFunctionDeclaration() && stmt.node.id) {
        const name = stmt.node.id.name;
        if (!namespaces.has(name)) namespaces.set(name, { fnPath: stmt, assignPaths: [] });
        else namespaces.get(name).fnPath = stmt;
      }
      if (
        stmt.isExpressionStatement() &&
        stmt.get('expression').isAssignmentExpression() &&
        stmt.get('expression.left').isMemberExpression()
      ) {
        const left = stmt.node.expression.left;
        if (
          !left.computed &&
          left.object.type === 'Identifier' &&
          left.property.type === 'Identifier'
        ) {
          const name = left.object.name;
          if (!namespaces.has(name)) namespaces.set(name, { fnPath: null, assignPaths: [] });
          namespaces.get(name).assignPaths.push(stmt);
        }
      }
    }

    for (const [name, info] of namespaces) {
      if (!info.fnPath || info.assignPaths.length === 0) continue;
      const binding = programPath.scope.getBinding(name);
      if (!binding) continue;

      let live = false;
      for (const ref of binding.referencePaths) {
        const parent = ref.parentPath;
        if (
          parent?.isMemberExpression() &&
          parent.get('object') === ref &&
          parent.parentPath?.isAssignmentExpression() &&
          parent.parentPath.get('left') === parent
        ) {
          continue;
        }
        live = true;
        break;
      }
      if (live) {
        skip(stats, `ns-live:${name}`);
        continue;
      }

      stats.matched += 1;
      for (const p of info.assignPaths) {
        p.remove();
        stats.changed += 1;
      }
      info.fnPath.remove();
      stats.changed += 1;
      programPath.scope.crawl();
    }
  }

  return {
    name: 'cleanup-concat-decoy',
    stats,
    visitor: {
      BlockStatement: {
        exit(path) {
          cleanBlock(path);
        },
      },
      Program: {
        exit(path) {
          cleanBlock(path);
          stripDeadNamespaceShell(path);
        },
      },
    },
  };
}
