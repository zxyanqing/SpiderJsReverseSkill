/**
 * C2 · 收敛循环验收（runUntilStable）
 *
 * ---------------------------------------------------------------------------
 * 验收目标（对应 10-练习题 C2）：
 *   输入：const a = 1; const b = a + 1; console.log(b);
 *   至少两轮得到 console.log(2)；再完整跑一遍结果不变（幂等）
 *
 * 本文件内嵌「教学用」传播 / 折叠 / 清理三个工厂，只服务本验收，
 * 不替代正式插件；正式传播见 const-propagate.js。
 *
 * ---------------------------------------------------------------------------
 * 运行目录：tools/deobfuscator
 * 运行命令：
 *   node scripts/run-c2-tests.mjs
 *   npm run test:c2
 */

import parser from '@babel/parser';
import t from '@babel/types';
import { createStats, skip } from '../src/lib/stats.js';
import { runUntilStable } from '../src/lib/run-until-stable.js';

/** 题目给定的验收输入。 */
const FIXTURE = `const a = 1; const b = a + 1; console.log(b);`;

/**
 * 教学用：把 const 绑定到数字字面量的 Identifier 引用替换成字面量。
 * 仅覆盖本验收样本，不做完整安全护栏。
 * @param {{types: typeof t}} api
 * @returns {{name: string, stats: object, visitor: object}}
 */
function teachPropagate({ types: t }) {
  const stats = createStats('teach-propagate');
  return {
    name: 'teach-propagate',
    stats,
    visitor: {
      /**
       * @param {import('@babel/traverse').NodePath} path
       */
      VariableDeclarator(path) {
        if (!path.parentPath.isVariableDeclaration({ kind: 'const' })) return;
        const id = path.get('id');
        const init = path.get('init');
        if (!id.isIdentifier() || !init.isNumericLiteral()) return;

        stats.matched += 1;
        const binding = path.scope.getBinding(id.node.name);
        if (!binding || !binding.constant) {
          skip(stats, 'not-constant');
          return;
        }

        let replaced = 0;
        for (const ref of binding.referencePaths) {
          // 只替换仍为该名字的 Identifier（避免 replaceWith 后残留虚引用）
          if (!ref.node || !ref.isIdentifier({ name: id.node.name })) continue;
          ref.replaceWith(t.cloneNode(init.node, true));
          replaced += 1;
          stats.changed += 1;
        }

        // 替换后刷新 Binding，供同轮后续 cleanup 看到「无引用」
        if (replaced > 0) path.scope.crawl();
      },
    },
  };
}

/**
 * 教学用：折叠两侧均为 NumericLiteral 的加法。
 * @param {{types: typeof t}} api
 * @returns {{name: string, stats: object, visitor: object}}
 */
function teachFold({ types: t }) {
  const stats = createStats('teach-fold');
  return {
    name: 'teach-fold',
    stats,
    visitor: {
      /**
       * exit：先处理内层，再折叠外层。
       * @param {import('@babel/traverse').NodePath} path
       */
      BinaryExpression: {
        exit(path) {
          if (path.node.operator !== '+') return;
          stats.matched += 1;
          const left = path.get('left');
          const right = path.get('right');
          if (!left.isNumericLiteral() || !right.isNumericLiteral()) {
            skip(stats, 'non-literal');
            return;
          }
          path.replaceWith(
            t.numericLiteral(left.node.value + right.node.value)
          );
          stats.changed += 1;
        },
      },
    },
  };
}

/**
 * 教学用：删除无引用且 init 为数字字面量的 const 声明项。
 * @returns {{name: string, stats: object, visitor: object}}
 */
function teachCleanup() {
  const stats = createStats('teach-cleanup');
  return {
    name: 'teach-cleanup',
    stats,
    visitor: {
      /**
       * @param {import('@babel/traverse').NodePath} path
       */
      VariableDeclarator(path) {
        if (!path.get('id').isIdentifier()) return;
        stats.matched += 1;

        // 每次重新取 Binding，避免上一 Pass 删除/替换后的过期结论
        const name = path.node.id.name;
        const binding = path.scope.getBinding(name);
        if (!binding || binding.path !== path) return;

        // 只统计仍指向该名字的 Identifier；已替换成字面量的旧 Path 不算引用
        const live = binding.referencePaths.filter(
          (ref) => ref.node && ref.isIdentifier({ name })
        );
        if (live.length !== 0) return;

        const init = path.get('init');
        if (!init.isNumericLiteral()) {
          skip(stats, 'not-numeric-init');
          return;
        }
        const scope = path.scope;
        path.remove();
        scope.crawl();
        stats.changed += 1;
      },
    },
  };
}

/**
 * 断言辅助。
 * @param {boolean} ok
 * @param {string} title
 * @param {string} [detail]
 */
function assert(ok, title, detail = '') {
  if (ok) {
    console.log(`✓ ${title}`);
    return;
  }
  console.error(`✗ ${title}`);
  if (detail) console.error(detail);
  process.exit(1);
}

/**
 * 入口：跑收敛循环，检查结果含 console.log(2)，并验证幂等。
 */
function main() {
  console.log('C2 验收 · runUntilStable\n');
  console.log('输入：', FIXTURE);

  const plugins = [teachPropagate, teachFold, teachCleanup];
  const ast = parser.parse(FIXTURE, { sourceType: 'script' });

  // ---------- 第一次完整收敛 ----------
  const first = runUntilStable(ast, plugins, 6, { types: t });
  console.log('\n各轮报告：');
  for (const round of first.reports) {
    console.log(
      `  第 ${round.round} 轮 changed=${round.changed}`,
      round.plugins.map((p) => `${p.name}:${p.changed}`).join(' ')
    );
  }
  console.log('\n第一次结果：\n' + first.code);

  assert(first.rounds >= 2, `至少两轮收敛（实际 rounds=${first.rounds}）`);
  assert(
    /console\.log\(\s*2\s*\)/.test(first.code),
    '结果包含 console.log(2)'
  );

  // ---------- 第二次完整运行：从同一输入再跑，结果应一致；对终态再跑不得再变 ----------
  const astFromInput = parser.parse(FIXTURE, { sourceType: 'script' });
  const againFromInput = runUntilStable(astFromInput, plugins, 6, { types: t });
  assert(
    againFromInput.code === first.code,
    '同一输入跑两次，收敛结果一致',
    `first:\n${first.code}\nagain:\n${againFromInput.code}`
  );

  const ast2 = parser.parse(first.code, { sourceType: 'script' });
  const second = runUntilStable(ast2, plugins, 6, { types: t });
  assert(
    second.code === first.code,
    '对终态再跑保持不变（幂等）',
    `first:\n${first.code}\nsecond:\n${second.code}`
  );

  console.log('\n全部通过（C2）');
}

main();
