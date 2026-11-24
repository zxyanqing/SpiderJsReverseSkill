/**
 * C5 · 对象映射表折叠插件（object-map）
 *
 * 功能：在证明「对象内容只读」后，把静态数据属性访问（table.token / table['token']）
 *       替换为对象字面量中的对应 value。
 * 不做：成员写入、delete、递增、对象逃逸；不折叠函数属性（避免 table.method() 丢失 this）。
 *
 * 策略：先全量预检并收集替换计划；任一引用不安全则整表跳过，禁止部分替换。
 *
 * 对照教程：docs/06-解混淆模式库/06-对象映射表折叠.md
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * 从只读成员访问中提取静态属性名。
 * @param {import('@babel/traverse').NodePath} memberPath `table.key` 或 `table['key']`
 * @returns {string|null} 可查表的字符串键；动态键返回 null
 */
function staticPropertyName(memberPath) {
  const property = memberPath.get('property');
  // 非计算成员 table.token：键名来自 Identifier.name
  if (!memberPath.node.computed && property.isIdentifier()) {
    return property.node.name;
  }
  // 计算成员 table['token']：只有字符串字面量才能静态确定
  if (memberPath.node.computed && property.isStringLiteral()) {
    return property.node.value;
  }
  return null;
}

/**
 * 判断属性 value 是否为函数形态（本 Pass 明确不折叠，留给处理 this 的独立规则）。
 * @param {import('@babel/traverse').NodePath} valuePath ObjectProperty 的 value Path
 * @returns {boolean}
 */
function isFunctionValue(valuePath) {
  return (
    valuePath.isFunctionExpression() ||
    valuePath.isArrowFunctionExpression() ||
    valuePath.isClassExpression()
  );
}

/**
 * 判断对象名字的引用是否处于写入或未知逃逸上下文。
 * 返回 true 表示不能再信任初始化属性值，整张表应跳过。
 * @param {import('@babel/traverse').NodePath} reference Binding 上的 Identifier 引用
 * @returns {boolean}
 */
function isWriteOrUnknownContext(reference) {
  const member = reference.parentPath;

  // 对象名不是成员访问的 object（如 fn(table)、return table）：视为未知逃逸
  if (!member.isMemberExpression() || member.get('object') !== reference) {
    return true;
  }

  const container = member.parentPath;
  // table.key = ... / table.key++ / delete table.key 都会破坏映射表稳定性
  return (
    container.isAssignmentExpression({ left: member.node }) ||
    container.isUpdateExpression() ||
    container.isUnaryExpression({ operator: 'delete' })
  );
}

/**
 * 插件工厂：每次调用创建独立 stats，供多轮收敛使用。
 * @param {{types: typeof import('@babel/types')}} api Babel types
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function objectMap({ types: t } = {}) {
  // 本轮统计：matched=候选声明数；changed=真实替换次数；skipped/reasons=整表跳过原因
  const stats = createStats('object-map');

  // 未传入 types 时无法 cloneNode；属接口错误，应尽早失败
  if (!t || typeof t.cloneNode !== 'function') {
    throw new Error('object-map 需要 api.types（@babel/types）');
  }

  return {
    name: 'object-map',
    stats,
    visitor: {
      /**
       * 处理一个变量声明项：证明只读后，折叠静态数据属性成员访问。
       * @param {import('@babel/traverse').NodePath} path VariableDeclarator
       */
      VariableDeclarator(path) {
        const declaration = path.parentPath;
        const id = path.get('id');
        const init = path.get('init');

        // ---------- 形态粗筛：非简单标识符 + 对象字面量，直接忽略 ----------
        if (!id.isIdentifier() || !init.isObjectExpression()) return;

        stats.matched += 1;

        // ---------- guard 1：只处理 const ----------
        if (!declaration.isVariableDeclaration({ kind: 'const' })) {
          skip(stats, 'not-const');
          return;
        }

        // ---------- guard 2：Binding 恒定（名字仍指向原对象）----------
        // 注意：constant 只证明「没被重新绑定」，不等于对象内容只读
        const binding = path.scope.getBinding(id.node.name);
        if (
          !binding ||
          binding.path !== path ||
          !binding.constant ||
          binding.constantViolations.length !== 0
        ) {
          skip(stats, 'binding-or-object-not-constant');
          return;
        }

        // ---------- guard 3：建立「静态键 → value 节点」查找表 ----------
        // 任一属性形态不支持则整表失败，避免只改一部分
        const properties = new Map();

        for (const property of init.get('properties')) {
          // 只接受普通、非计算 ObjectProperty；方法简写、展开、计算键一律拒绝
          if (!property.isObjectProperty() || property.node.computed) {
            skip(stats, 'unsupported-property');
            return;
          }

          // 键可能是 Identifier 或 StringLiteral；取静态文本作为 Map 键
          const keyNode = property.node.key;
          const key = keyNode.name ?? keyNode.value;
          if (typeof key !== 'string') {
            skip(stats, 'unsupported-key');
            return;
          }

          const valuePath = property.get('value');
          // 函数属性：table.method() 有隐式 this，改成独立函数调用会丢 this
          // 本 Pass 只折叠数据属性；函数包装器留给独立规则
          if (isFunctionValue(valuePath)) {
            skip(stats, 'function-property-this-risk');
            return;
          }

          // 保存裸 value 节点；真正替换时再 cloneNode
          properties.set(key, valuePath.node);
        }

        // ---------- 全量预检：先收集替换计划 ----------
        const replacements = [];

        for (const reference of binding.referencePaths) {
          // 引用可能已被其它 Pass 改掉；只处理仍指向该名字的 Identifier
          if (!reference.node || !reference.isIdentifier({ name: id.node.name })) {
            continue;
          }

          // 写入 / 逃逸：旧属性值不能再当常量
          if (isWriteOrUnknownContext(reference)) {
            skip(stats, 'write-or-unknown-context');
            return;
          }

          const member = reference.parentPath;

          // 额外保险：若成员访问本身是调用的 callee（table.x()），即便 value 不是函数
          // 也不在本 Pass 折叠——调用语义超出「数据属性展开」边界
          if (member.parentPath.isCallExpression({ callee: member.node })) {
            skip(stats, 'member-call-not-data-fold');
            return;
          }

          const key = staticPropertyName(member);
          // 动态键或不存在的键不能猜
          if (!key || !properties.has(key)) {
            skip(stats, 'dynamic-or-missing-property');
            return;
          }

          replacements.push({
            member,
            value: properties.get(key),
          });
        }

        // 无引用：无需替换；声明删除交给 cleanup Pass
        if (replacements.length === 0) {
          skip(stats, 'no-references');
          return;
        }

        // ---------- 全量预检通过：统一执行替换 ----------
        for (const item of replacements) {
          // 深克隆：同一属性可能被多处访问，禁止共享同一 AST 节点
          item.member.replaceWith(t.cloneNode(item.value, true));
          stats.changed += 1;
        }
      },
    },
  };
}
