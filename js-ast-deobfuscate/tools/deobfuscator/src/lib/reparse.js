/**
 * 结构改写后的 reparse 约定：generate → parse，刷新 Binding / scope。
 * 大改 AST 形状后推荐在外层收敛轮次之间调用。
 */

import { parseCode } from '../parse.js';
import { generateCode } from '../generate.js';

/**
 * @param {import('@babel/types').File} ast
 * @param {string} [originalSource]
 * @returns {import('@babel/types').File}
 */
export function reparseAst(ast, originalSource = '') {
  const { code } = generateCode(ast, originalSource);
  return parseCode(code);
}
