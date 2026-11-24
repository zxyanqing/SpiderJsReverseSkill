/**
 * 插件：删除 debugger 语句（remove-debugger）
 *
 * 功能：删除 AST 中全部 DebuggerStatement 节点。
 * 不做：删除 `debugger` 字符串、标识符名、或其它含 "debug" 字样的代码。
 *
 * 对照练习：docs/05-Babel-AST基础/08-练习题.md（B2）
 */

import { createStats } from '../lib/stats.js';

/**
 * 插件工厂。
 * @param {object} [_api] 脚手架传入的 Babel API（本插件不构造新节点，可忽略）
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function removeDebugger(_api = {}) {
  const stats = createStats('remove-debugger');

  return {
    name: 'remove-debugger',
    stats,
    visitor: {
      /**
       * 命中 DebuggerStatement 即删除；该节点无副作用依赖，删除不改变其它表达式语义。
       * @param {import('@babel/traverse').NodePath} path DebuggerStatement
       */
      DebuggerStatement(path) {
        // matched：形状命中 debugger 语句
        stats.matched += 1;

        // transform：从父容器（语句列表）中移除当前语句
        path.remove();
        stats.changed += 1;
      },
    },
  };
}
