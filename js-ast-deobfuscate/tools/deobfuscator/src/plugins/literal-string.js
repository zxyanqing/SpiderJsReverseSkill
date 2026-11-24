/**
 * 插件：字符串字面量可读化（literal-string）
 *
 * 功能：当源码以 `\x` / `\u` / 八进制等形式书写字符串时，Parser 的 `value` 已是解码结果，
 * 但节点上常残留 `extra.raw`；generator 会优先复用 raw，再次打出转义。
 * 本插件用「仅含 value 的新 StringLiteral」替换旧节点，清掉旧 extra；
 * 对模板字符串的 TemplateElement，在 raw≠cooked 且含转义时，把 raw 改成 cooked。
 *
 * 不做：改写已经是普通明文写法的字符串；不负责 jsescOption.minimal（那是 generate 选项）。
 *
 * 对照教程：docs/05-Babel-AST基础/05-Generator.md、07-三插件实战.md
 */

import tDefault from '@babel/types';
import { createStats, skip } from '../lib/stats.js';

/**
 * 判断 extra.raw / 模板 raw 是否仍带十六进制、Unicode 或八进制转义写法。
 * @param {string} raw 源码形态字符串
 * @returns {boolean}
 */
function hasEscapeInRaw(raw) {
  // \\xNN、\\uXXXX、\\0-7 八进制：与历史脚手架规则一致
  return /\\[xu0-7]/.test(raw);
}

/**
 * 插件工厂。
 * @param {{types?: typeof import('@babel/types')}} [api]
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function literalString({ types: tFromApi } = {}) {
  const t = tFromApi ?? tDefault;
  const stats = createStats('literal-string');

  return {
    name: 'literal-string',
    stats,
    visitor: {
      /**
       * 普通字符串字面量：仅当 extra.raw 暴露了转义写法时，用新节点替换以丢掉 extra。
       * @param {import('@babel/traverse').NodePath} path StringLiteral
       */
      StringLiteral(path) {
        stats.matched += 1;

        const raw = path.node.extra?.raw;

        // guard：没有 raw，或 raw 不含目标转义 → 无需改，避免无意义 replace 抖动
        if (!raw || !hasEscapeInRaw(raw)) {
          skip(stats, 'no-escape-raw');
          return;
        }

        // transform：新 StringLiteral 默认不带旧 extra，配合 generate 的 minimal 输出明文
        path.replaceWith(t.stringLiteral(path.node.value));
        stats.changed += 1;
      },

      /**
       * 模板字符串元素：cooked 已是解码结果；若 raw 仍是转义形态，则把 raw 同步为 cooked，
       * 减轻 generator 再按 raw 打出转义的概率。
       * @param {import('@babel/traverse').NodePath} path TemplateElement
       */
      TemplateElement(path) {
        stats.matched += 1;

        const raw = path.node.value.raw;
        const cooked = path.node.value.cooked;

        // guard：cooked 缺失、或 raw 已与 cooked 一致、或 raw 无目标转义 → 跳过
        if (cooked == null || raw === cooked || !hasEscapeInRaw(raw)) {
          skip(stats, 'template-no-escape');
          return;
        }

        // transform：就地更新 value；不整体 replace 节点，避免打乱模板结构
        path.node.value = { raw: cooked, cooked };
        stats.changed += 1;
      },
    },
  };
}
