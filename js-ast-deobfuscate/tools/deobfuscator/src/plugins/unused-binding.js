/**
 * C6 · 无用绑定清理插件（unused-binding）
 *
 * 功能：删除「无引用」且「初始化可证明纯净」的变量声明项。
 * 不做：有调用/赋值等副作用的初始化；有读引用或写 violation 的绑定；
 *       作用域内存在 direct `eval` 时的清理（eval 为停止信号）。
 *
 * 要点：无引用 ≠ 可删除；删除后对本作用域重新 crawl，后续判断必须重新 getBinding。
 *
 * 对照教程：docs/06-解混淆模式库/08-不可达代码与无用绑定.md
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * 检测某个作用域（及其子树）是否出现 direct `eval`。
 * direct eval 可能动态读写当前作用域变量，使「无引用」证据失效。
 * @param {object} scope Babel Scope
 * @returns {boolean} true 表示应停止在该作用域做无用绑定删除
 */
function scopeContainsDirectEval(scope) {
  let found = false;

  // 从作用域对应 Path 向下扫描调用；一旦发现 direct eval 立即停止
  scope.path.traverse({
    /**
     * 查找形如 eval(...) 且 callee 未被本地绑定遮蔽的调用。
     * @param {import('@babel/traverse').NodePath} callPath
     */
    CallExpression(callPath) {
      const callee = callPath.get('callee');
      // 必须是标识符名字恰好为 eval；eval.x() / window.eval 等不按 direct eval 处理
      if (!callee.isIdentifier({ name: 'eval' })) return;
      // 本地存在名为 eval 的 Binding 时，不是语言级 direct eval
      if (callPath.scope.getBinding('eval')) return;

      found = true;
      callPath.stop();
    },
  });

  return found;
}

/**
 * 插件工厂：每次调用创建独立 stats，供多轮收敛使用。
 * @param {{types?: typeof import('@babel/types')}} [_api] 保留与其它插件一致的工厂签名
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function unusedBinding(_api = {}) {
  // 本轮统计：matched=候选声明项；changed=实际删除次数；skipped/reasons=安全跳过
  const stats = createStats('unused-binding');

  return {
    name: 'unused-binding',
    stats,
    visitor: {
      /**
       * 处理一个变量声明项：仅在无引用且初始化纯净、且无 direct eval 威胁时删除。
       * @param {import('@babel/traverse').NodePath} path VariableDeclarator
       */
      VariableDeclarator(path) {
        const id = path.get('id');

        // ---------- 形态粗筛：只处理简单标识符，解构不在本阶段白名单 ----------
        if (!id.isIdentifier()) return;

        stats.matched += 1;

        // ---------- 每次重新查询 Binding（禁止沿用删除前的缓存结论）----------
        // 前一个 declarator 被删后，同作用域 Binding 表可能变化；必须用当前 scope 再取一次
        const name = id.node.name;
        const binding = path.scope.getBinding(name);

        // Binding 缺失或声明路径对不上：证据不足，保留
        if (!binding || binding.path !== path) {
          skip(stats, 'binding-mismatch');
          return;
        }

        // ---------- guard 1：仍有读引用 → 正常保留（不计跳过噪音）----------
        if (binding.referencePaths.length !== 0 || binding.referenced) {
          return;
        }

        // ---------- guard 2：存在赋值等 constantViolations → 保留 ----------
        // 例如 `let x = 0; x = 1;`：LHS 写入不在 referencePaths，但删声明会破坏后续赋值
        if (binding.constantViolations.length !== 0) {
          skip(stats, 'has-assignment-or-violation');
          return;
        }

        // ---------- guard 3：当前作用域出现 direct eval → 停止清理 ----------
        // eval 可能按名字动态读取「看似无引用」的变量，不能把无引用当充分证据
        if (scopeContainsDirectEval(path.scope)) {
          skip(stats, 'direct-eval-stop');
          return;
        }

        // ---------- guard 4：初始化必须空或纯净 ----------
        // `const x = getValue()` 即使无引用也会执行调用；非纯初始化一律保留
        const init = path.get('init');
        if (init.node && !init.isPure()) {
          skip(stats, 'unused-initializer-may-have-side-effect');
          return;
        }

        // ---------- 通过全部 guard：删除声明项 ----------
        // 先抓住 scope 再 remove：删除后 path 可能失效，但仍需刷新作用域 Binding
        const scope = path.scope;
        path.remove();

        // 删除后重新 crawl，确保后续 Visitor / 同轮其它声明看到的 Binding 是最新的
        scope.crawl();

        stats.changed += 1;
      },
    },
  };
}
