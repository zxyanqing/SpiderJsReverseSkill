/**
 * Stage 7 · 字符串解密链（受控求值）
 *
 * 识别：NumericLiteral 数组 Binding → 引用它的 FunctionDeclaration →
 *       常量数字实参调用（含一层标识符别名）。
 * 执行：拼最小闭包 → 子进程求值 → 回写基础类型字面量。
 * 不做：主进程 eval；未知全局；动态实参。
 */

import generatorModule from '@babel/generator';
import { createStats, skip } from '../lib/stats.js';
import { evaluateInChildSync } from '../lib/evaluate-in-child.js';

const generate = generatorModule.default ?? generatorModule;

const HOST_WHITELIST = new Set([
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Math',
  'JSON',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'undefined',
  'NaN',
  'Infinity',
]);

function isNumericArrayLiteral(node) {
  if (!node || node.type !== 'ArrayExpression' || node.elements.length === 0) return false;
  return node.elements.every(
    (el) => el && el.type === 'NumericLiteral' && Number.isFinite(el.value),
  );
}

function enclosingFunctionDeclaration(refPath) {
  let current = refPath.parentPath;
  while (current) {
    if (current.isFunctionDeclaration()) return current;
    current = current.parentPath;
  }
  return null;
}

function valueToLiteral(t, value) {
  if (value === null) return t.nullLiteral();
  if (typeof value === 'string') return t.stringLiteral(value);
  if (typeof value === 'boolean') return t.booleanLiteral(value);
  if (typeof value === 'number' && Number.isFinite(value)) return t.numericLiteral(value);
  return null;
}

/**
 * @param {import('@babel/types')} t
 * @param {import('@babel/traverse').NodePath} fnPath
 * @param {Set<string>} alreadyIncluded
 */
function collectFreeVarDeclarations(t, fnPath, alreadyIncluded) {
  const declSources = [];
  const seen = new Set(alreadyIncluded);
  let failure = null;

  fnPath.traverse({
    Identifier(idPath) {
      if (failure) return;
      if (!idPath.isReferencedIdentifier()) return;
      const name = idPath.node.name;
      if (seen.has(name)) return;
      if (fnPath.scope.hasOwnBinding(name)) return;

      const binding = idPath.scope.getBinding(name);
      if (!binding) {
        if (!HOST_WHITELIST.has(name)) failure = `unknown-global:${name}`;
        return;
      }
      if (binding.path === fnPath) return;

      seen.add(name);
      alreadyIncluded.add(name);

      if (binding.path.isFunctionDeclaration()) {
        declSources.push(generate(binding.path.node, { compact: false }).code);
        return;
      }
      if (binding.path.isVariableDeclarator()) {
        const kind = binding.kind || binding.path.parent.kind || 'var';
        const stmt = t.variableDeclaration(kind, [t.cloneNode(binding.path.node, true)]);
        declSources.push(generate(stmt, { compact: false }).code);
        return;
      }
      failure = `unsupported-free-binding:${name}`;
    },
  });

  if (failure) return { ok: false, reason: failure };
  return { ok: true, declSources };
}

export default function stringDecryptChain({ types: t } = {}) {
  const stats = createStats('string-decrypt-chain');
  if (!t) throw new Error('string-decrypt-chain 需要 api.types');

  /** @type {Map<string, {ok: true, value: unknown} | {ok: false, reason: string}>} */
  const evalCache = new Map();

  return {
    name: 'string-decrypt-chain',
    stats,
    visitor: {
      Program(programPath) {
        /** @type {Map<string, {closureHeader: string, decoderPath: object}>} */
        const chains = new Map();

        programPath.traverse({
          VariableDeclarator(path) {
            const id = path.get('id');
            const init = path.get('init');
            if (!id.isIdentifier() || !isNumericArrayLiteral(init.node)) return;

            const arrayBinding = path.scope.getBinding(id.node.name);
            if (!arrayBinding || arrayBinding.constantViolations.length > 0) {
              skip(stats, 'array-not-constant');
              return;
            }

            for (const ref of arrayBinding.referencePaths) {
              const fnPath = enclosingFunctionDeclaration(ref);
              if (!fnPath || !fnPath.get('id').isIdentifier()) continue;
              const decoderName = fnPath.node.id.name;
              if (chains.has(decoderName)) continue;

              stats.matched += 1;
              const included = new Set([id.node.name, decoderName]);
              const free = collectFreeVarDeclarations(t, fnPath, included);
              if (!free.ok) {
                skip(stats, free.reason);
                continue;
              }

              const kind = path.parent.kind || 'var';
              const arrayDecl = generate(
                t.variableDeclaration(kind, [t.cloneNode(path.node, true)]),
                { compact: false },
              ).code;
              const decoderDecl = generate(fnPath.node, { compact: false }).code;
              const closureHeader = [...free.declSources, arrayDecl, decoderDecl].join('\n');

              chains.set(decoderName, { closureHeader, decoderPath: fnPath });
            }
          },
        });

        if (chains.size === 0) return;

        /** @type {Map<string, string>} */
        const aliases = new Map();
        programPath.traverse({
          VariableDeclarator(aliasPath) {
            const id = aliasPath.get('id');
            const init = aliasPath.get('init');
            if (!id.isIdentifier() || !init.isIdentifier()) return;
            if (!chains.has(init.node.name)) return;
            aliases.set(id.node.name, init.node.name);
          },
        });

        programPath.traverse({
          CallExpression(callPath) {
            const callee = callPath.get('callee');
            if (!callee.isIdentifier()) return;
            const args = callPath.get('arguments');
            if (args.length !== 1 || !args[0].isNumericLiteral()) return;
            if (!Number.isFinite(args[0].node.value)) return;

            let decoderName = callee.node.name;
            if (aliases.has(decoderName)) decoderName = aliases.get(decoderName);
            const chain = chains.get(decoderName);
            if (!chain) return;
            if (callPath.findParent((p) => p.node === chain.decoderPath.node)) return;

            const argValue = args[0].node.value;
            const cacheKey = `${decoderName}::${argValue}`;
            let result = evalCache.get(cacheKey);
            if (!result) {
              const body = `${chain.closureHeader}\nreturn ${decoderName}(${JSON.stringify(argValue)});`;
              result = evaluateInChildSync(body, { timeoutMs: 1000 });
              evalCache.set(cacheKey, result);
            }

            if (!result.ok) {
              skip(stats, `eval:${result.reason}`);
              return;
            }

            const lit = valueToLiteral(t, result.value);
            if (!lit) {
              skip(stats, 'literalize-failed');
              return;
            }

            callPath.replaceWith(lit);
            stats.changed += 1;
          },
        });
      },
    },
  };
}
