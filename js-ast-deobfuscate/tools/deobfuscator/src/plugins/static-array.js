/**
 * C4 · 静态字符串数组插件（static-array）
 *
 * 功能：把只读 `const` 字符串数组上的「静态整数索引」成员访问，替换为对应元素字面量。
 * 不做：动态索引、数组写入、数组逃逸（传入未知函数）、越界、非字符串元素、旋转/执行型数组。
 *
 * 策略：先对整张数组做全量预检并收集替换计划；任一引用不安全则整表跳过，禁止部分替换。
 *
 * 对照教程：docs/06-解混淆模式库/07-直接索引字符串数组.md
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * 从 MemberExpression 提取静态整数下标。
 * @param {import('@babel/traverse').NodePath} memberPath `words[index]` 形态的成员访问
 * @returns {number|null} 合法非负整数下标；动态键、点语法、非整数返回 null
 */
function staticIndex(memberPath) {
  const property = memberPath.get('property');
  // 只有 computed=true 的方括号访问才是数组索引；words.length / words.foo 不是本规则形态
  if (!memberPath.node.computed || !property.isNumericLiteral()) return null;
  const index = property.node.value;
  // 小数、NaN、Infinity 不能当安全下标
  return Number.isInteger(index) ? index : null;
}

/**
 * 判断数组名字的引用是否处于「写入」或「逃逸到未知位置」的上下文。
 * 返回 true 表示不能再信任初始化元素，整张数组应跳过。
 * @param {import('@babel/traverse').NodePath} reference Binding 上的 Identifier 引用 Path
 * @returns {boolean}
 */
function isWriteOrUnknownContext(reference) {
  const member = reference.parentPath;

  // words 不是成员访问的 object（例如 use(words)、return words）：无法证明调用方不改数组
  if (!member.isMemberExpression() || member.get('object') !== reference) {
    return true;
  }

  const outer = member.parentPath;
  // `words[0] = ...` / `words[0]++` / `delete words[0]` 会改变内容或结构
  return (
    outer.isAssignmentExpression({ left: member.node }) ||
    outer.isUpdateExpression() ||
    outer.isUnaryExpression({ operator: 'delete' })
  );
}

/**
 * 插件工厂：每次调用创建独立 stats，供多轮收敛使用。
 * @param {{types: typeof import('@babel/types')}} api Babel types
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function staticArray({ types: t } = {}) {
  // 本轮统计：matched=候选声明数；changed=真实替换次数；skipped/reasons=整表跳过原因
  const stats = createStats('static-array');

  // 未传入 types 时无法 cloneNode；属接口错误，应尽早失败
  if (!t || typeof t.cloneNode !== 'function') {
    throw new Error('static-array 需要 api.types（@babel/types）');
  }

  return {
    name: 'static-array',
    stats,
    visitor: {
      /**
       * 处理一个变量声明项：通过全量预检后，把安全的 words[整数] 换成元素字面量。
       * @param {import('@babel/traverse').NodePath} path VariableDeclarator
       */
      VariableDeclarator(path) {
        const declaration = path.parentPath;
        const id = path.get('id');
        const init = path.get('init');

        // ---------- 形态粗筛：非简单标识符 + 数组字面量，直接忽略（不计 matched） ----------
        // 解构、调用返回值、对象等不是本阶段静态字符串池候选
        if (!id.isIdentifier() || !init.isArrayExpression()) return;

        // 进入候选统计：后续任一 guard 失败都会 skip 整表
        stats.matched += 1;

        // ---------- guard 1：只处理 const ----------
        // let/var 可能被再绑定或存在提升语义；本阶段不碰
        if (!declaration.isVariableDeclaration({ kind: 'const' })) {
          skip(stats, 'not-const');
          return;
        }

        // ---------- guard 2：Binding 恒定（名字仍指向原数组）----------
        // 再赋值会破坏「初始化字面量即运行时身份」的假设
        const binding = path.scope.getBinding(id.node.name);
        if (
          !binding ||
          binding.path !== path ||
          !binding.constant ||
          binding.constantViolations.length !== 0
        ) {
          skip(stats, 'array-binding-not-constant');
          return;
        }

        // ---------- guard 3：元素必须全是字符串字面量 ----------
        // 空洞、数字、对象、函数、调用表达式等都不能当静态字符串池展开
        const elements = init.get('elements');
        if (elements.some((element) => !element.node || !element.isStringLiteral())) {
          skip(stats, 'unsupported-array-element');
          return;
        }

        // ---------- 全量预检：先收集替换计划，任一引用失败则整表放弃 ----------
        // 禁止「只展开安全下标、留下动态下标」的部分替换——会让同一数组语义分裂
        const replacements = [];

        for (const reference of binding.referencePaths) {
          // 引用节点可能已在其它 Pass 被改掉；只处理仍存在的 Identifier
          if (!reference.node || !reference.isIdentifier({ name: id.node.name })) {
            continue;
          }

          // 写入或逃逸：初始化元素不再代表运行时值
          if (isWriteOrUnknownContext(reference)) {
            skip(stats, 'array-write-or-unknown-context');
            return;
          }

          // reference 的父节点是完整的 words[index] 成员访问
          const member = reference.parentPath;
          const index = staticIndex(member);

          // 动态键、负数、越界都不能从数组字面量安全取值
          if (index === null || index < 0 || index >= elements.length) {
            skip(stats, 'dynamic-or-out-of-range-index');
            return;
          }

          // 只登记计划，等全部引用通过后再改树
          replacements.push({
            member,
            value: elements[index].node,
          });
        }

        // 无引用：无需替换；声明删除交给独立 cleanup Pass
        if (replacements.length === 0) {
          skip(stats, 'no-references');
          return;
        }

        // ---------- 全量预检通过：一次性执行替换 ----------
        for (const item of replacements) {
          // 深克隆：禁止多个访问点共享同一 StringLiteral 节点
          item.member.replaceWith(t.cloneNode(item.value, true));
          stats.changed += 1;
        }
      },
    },
  };
}
