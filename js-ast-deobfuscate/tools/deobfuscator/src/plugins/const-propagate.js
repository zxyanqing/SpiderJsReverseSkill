/**
 * C3 · 字面量传播插件（const-propagate）
 *
 * 功能：沿真实 Binding，把「const + 基础字面量」的引用替换成字面量本身。
 * 不做：对象/数组/函数传播、let/var、有 violation 的绑定、声明前引用。
 *
 * 对照教程：docs/06-解混淆模式库/05-常量传播与别名.md
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * 判断初始化 Path 是否属于本插件允许传播的基础字面量白名单。
 * @param {import('@babel/traverse').NodePath} path 初始化表达式的 NodePath
 * @returns {boolean} true 只代表节点类型安全；Binding / 引用顺序仍需其它 guard
 */
function isSupportedLiteral(path) {
  // 字符串 / 数字 / 布尔 / null：有 Babel 字面量节点，复制后语义不变
  // 对象、数组、函数涉及引用身份或调用语义，本阶段明确拒绝
  return (
    path.isStringLiteral() ||
    path.isNumericLiteral() ||
    path.isBooleanLiteral() ||
    path.isNullLiteral()
  );
}

/**
 * 过滤出「当前 AST 上仍指向该名字」的 Identifier 引用。
 * 替换后 Binding.referencePaths 可能过期；只保留仍是目标名字的 Identifier，避免虚增 changed。
 * @param {object} binding Babel Binding
 * @param {string} name 变量名
 * @returns {import('@babel/traverse').NodePath[]}
 */
function liveIdentifierRefs(binding, name) {
  return binding.referencePaths.filter(
    (ref) => ref.node && ref.isIdentifier({ name })
  );
}

/**
 * 保守判断：所有引用是否都出现在声明结束位置之后（防 TDZ / 声明前误替换）。
 * @param {import('@babel/traverse').NodePath} declaratorPath VariableDeclarator
 * @param {import('@babel/traverse').NodePath[]} refs 已过滤的引用列表
 * @returns {boolean}
 */
function allRefsAfterDeclaration(declaratorPath, refs) {
  const declarationEnd = declaratorPath.node.end;
  // 没有位置信息时不猜，视为不能证明「引用在声明之后」
  if (typeof declarationEnd !== 'number') return false;
  return refs.every(
    (ref) =>
      typeof ref.node.start === 'number' && ref.node.start >= declarationEnd
  );
}

/**
 * 插件工厂：每次调用创建独立 stats，供多轮收敛循环使用。
 * @param {{types: typeof import('@babel/types')}} api Babel types（与脚手架其它插件一致）
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function constPropagate({ types: t } = {}) {
  // 本轮统计：matched 命中声明数；changed 真实替换次数；skipped/reasons 记录 guard 拦截
  const stats = createStats('const-propagate');

  // 未传入 types 时无法 cloneNode；这是接口错误，应尽早失败
  if (!t || typeof t.cloneNode !== 'function') {
    throw new Error('const-propagate 需要 api.types（@babel/types）');
  }

  return {
    name: 'const-propagate',
    stats,
    visitor: {
      /**
       * 处理一个变量声明项：通过全部 guard 后，把它的安全引用替换成 init 字面量。
       * @param {import('@babel/traverse').NodePath} path VariableDeclarator
       */
      VariableDeclarator(path) {
        // matched 只表示碰到候选声明；是否改写还要看后续 guard
        stats.matched += 1;

        // declaration：外层 const/let/var；id：变量名；init：初始化表达式
        const declaration = path.parentPath;
        const id = path.get('id');
        const init = path.get('init');

        // ---------- guard 1：只处理 const ----------
        // let/var 可能被再赋值或存在提升语义，本阶段不碰
        if (!declaration.isVariableDeclaration({ kind: 'const' })) {
          skip(stats, 'not-const');
          return;
        }

        // ---------- guard 2：简单标识符 + 基础字面量 ----------
        // 拒绝解构、缺失 init、对象/数组/函数/调用等非白名单形态
        if (!id.isIdentifier() || !init.node || !isSupportedLiteral(init)) {
          skip(stats, 'not-supported-init');
          return;
        }

        const name = id.node.name;

        // ---------- guard 3：Binding 身份与恒定性 ----------
        // 必须用 getBinding，不能按名字全文替换（会误伤内层同名）
        const binding = path.scope.getBinding(name);
        // binding.path 必须就是当前 declarator，防止解析到错误声明
        if (!binding || binding.path !== path) {
          skip(stats, 'binding-mismatch');
          return;
        }
        // constant + 无 violation：排除再赋值、++ 等破坏初始值的情况
        if (!binding.constant || binding.constantViolations.length !== 0) {
          skip(stats, 'not-constant');
          return;
        }

        // 只保留当前仍是该名字的 Identifier 引用（声明本身不在 referencePaths）
        const refs = liveIdentifierRefs(binding, name);

        // ---------- guard 4：引用必须在声明之后 ----------
        // 防止把 TDZ 报错或「声明前读取」错误改成字面量
        if (!allRefsAfterDeclaration(path, refs)) {
          skip(stats, 'reference-before-declaration-or-unknown-order');
          return;
        }

        // 没有可读引用：无需替换；声明删除交给 cleanup Pass
        if (refs.length === 0) {
          skip(stats, 'no-references');
          return;
        }

        // ---------- transform：逐个引用深克隆替换 ----------
        for (const reference of refs) {
          // 对象简写 { token }：value 换成字面量后必须关闭 shorthand
          // reference.key === 'value'：确保改的是属性值，不是键名
          if (
            reference.parentPath.isObjectProperty() &&
            reference.parentPath.node.shorthand &&
            reference.key === 'value'
          ) {
            reference.parentPath.node.shorthand = false;
          }

          // 每个引用各自一份深克隆，禁止多处共享同一 AST 节点
          reference.replaceWith(t.cloneNode(init.node, true));
          stats.changed += 1;
        }
      },
    },
  };
}
