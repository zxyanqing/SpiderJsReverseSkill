#!/usr/bin/env node
/**
 * 残留度量：行数 / split('|') / loop-switch / opcode-if 链 / dispatcher 包装 / _0x 标识符。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deobRoot = path.resolve(__dirname, '../tools/deobfuscator');
const require = createRequire(path.join(deobRoot, 'package.json'));

function loadBabel() {
  const parser = require('@babel/parser');
  const traverse = require('@babel/traverse').default;
  const generate = require('@babel/generator').default;
  const t = require('@babel/types');
  return { parse: parser.parse.bind(parser), traverse, generate, t };
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function isLiteralLike(t, node) {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

function isOpcodeDiscriminant(t, node) {
  return t.isIdentifier(node) || t.isMemberExpression(node);
}

function printNode(generate, node) {
  return generate(node, { compact: true, comments: false, jsescOption: { minimal: true } }).code;
}

function getOpcodeIfDescriptor(t, generate, node) {
  if (!t.isIfStatement(node) || node.alternate) return null;
  const test = node.test;
  if (!t.isBinaryExpression(test) || !['==', '===', '!=', '!=='].includes(test.operator)) {
    return null;
  }
  if (isLiteralLike(t, test.left) && isOpcodeDiscriminant(t, test.right)) {
    return { discriminantKey: printNode(generate, test.right), literalKey: printNode(generate, test.left) };
  }
  if (isLiteralLike(t, test.right) && isOpcodeDiscriminant(t, test.left)) {
    return { discriminantKey: printNode(generate, test.left), literalKey: printNode(generate, test.right) };
  }
  return null;
}

function countOpcodeIfChains(t, traverse, generate, ast) {
  const statementLists = [];
  traverse(ast, {
    Program(path) {
      statementLists.push(path.node.body);
    },
    BlockStatement(path) {
      statementLists.push(path.node.body);
    },
    SwitchCase(path) {
      statementLists.push(path.node.consequent);
    },
  });

  let count = 0;
  for (const statements of statementLists) {
    for (let index = 0; index < statements.length; index += 1) {
      const firstDescriptor = getOpcodeIfDescriptor(t, generate, statements[index]);
      if (!firstDescriptor) continue;
      const seenLiterals = new Set([firstDescriptor.literalKey]);
      let chainLength = 1;
      let cursor = index + 1;
      while (cursor < statements.length) {
        const nextDescriptor = getOpcodeIfDescriptor(t, generate, statements[cursor]);
        if (!nextDescriptor || nextDescriptor.discriminantKey !== firstDescriptor.discriminantKey) {
          break;
        }
        seenLiterals.add(nextDescriptor.literalKey);
        chainLength += 1;
        cursor += 1;
      }
      if (chainLength >= 2 && seenLiterals.size >= 2) {
        count += chainLength;
        index = cursor - 1;
      }
    }
  }
  return count;
}

function getReturnArgument(t, fnNode) {
  if (t.isArrowFunctionExpression(fnNode) && !t.isBlockStatement(fnNode.body)) {
    return fnNode.body;
  }
  if (!t.isFunctionExpression(fnNode) && !t.isArrowFunctionExpression(fnNode)) return null;
  if (!t.isBlockStatement(fnNode.body) || fnNode.body.body.length !== 1) return null;
  const [statement] = fnNode.body.body;
  return t.isReturnStatement(statement) ? statement.argument : null;
}

function isThinWrapperFunction(t, traverse, fnNode) {
  const returnArgument = getReturnArgument(t, fnNode);
  if (!returnArgument) return false;
  const paramNames = new Set(
    fnNode.params.filter((param) => t.isIdentifier(param)).map((param) => param.name),
  );
  if (paramNames.size === 0) return false;

  const referencedNames = new Set();
  traverse(t.file(t.program([t.expressionStatement(t.cloneNode(returnArgument, true))])), {
    noScope: true,
    Identifier(path) {
      if (path.isReferencedIdentifier()) referencedNames.add(path.node.name);
    },
  });
  for (const name of referencedNames) {
    if (!paramNames.has(name)) return false;
  }
  if (t.isBinaryExpression(returnArgument) || t.isLogicalExpression(returnArgument)) return true;
  if (t.isUnaryExpression(returnArgument) && t.isIdentifier(returnArgument.argument)) return true;
  if (t.isCallExpression(returnArgument)) {
    return t.isIdentifier(returnArgument.callee) || t.isMemberExpression(returnArgument.callee);
  }
  return false;
}

function countDispatcherWrappers(t, traverse, ast) {
  let count = 0;
  traverse(ast, {
    ObjectExpression(path) {
      let thinWrapperCount = 0;
      let literalPropertyCount = 0;
      path.get('properties').forEach((propertyPath) => {
        if (!propertyPath.isObjectProperty()) return;
        const valuePath = propertyPath.get('value');
        if (
          valuePath.isStringLiteral() ||
          valuePath.isNumericLiteral() ||
          valuePath.isBooleanLiteral() ||
          valuePath.isNullLiteral()
        ) {
          literalPropertyCount += 1;
          return;
        }
        if (isThinWrapperFunction(t, traverse, valuePath.node)) thinWrapperCount += 1;
      });
      if (thinWrapperCount >= 2 || (thinWrapperCount >= 1 && literalPropertyCount >= 2)) {
        count += thinWrapperCount;
      }
    },
  });
  return count;
}

/**
 * @param {string} text
 * @param {ReturnType<typeof loadBabel>} babel
 */
export function collectMetrics(text, babel = loadBabel()) {
  let opcodeIfChainCount = countMatches(
    text,
    /if\s*\(\s*(?:0x[\da-f]+|\d+|["'][^"'\\]*(?:\\.[^"'\\]*)*["'])\s*={2,3}\s*[A-Za-z_$][\w$]*\s*\)/gi,
  );
  let dispatcherWrapperCount = countMatches(text, /:\s*function\s*\([^)]*\)\s*\{\s*return\b/g);

  try {
    const ast = babel.parse(text, { sourceType: 'unambiguous', plugins: ['jsx'] });
    opcodeIfChainCount = countOpcodeIfChains(babel.t, babel.traverse, babel.generate, ast);
    dispatcherWrapperCount = countDispatcherWrappers(babel.t, babel.traverse, ast);
  } catch {
    // keep regex fallbacks
  }

  return {
    lineCount: text.split(/\r?\n/).length,
    splitPipeCount: countMatches(text, /\.split\(\s*["']\|["']\s*\)/g),
    loopSwitchCount: countMatches(text, /(?:while|for)\s*\([^)]*\)\s*\{[\s\S]{0,120}?switch\s*\(/g),
    opcodeIfChainCount,
    dispatcherWrapperCount,
    hexIdentifierCount: countMatches(text, /\b_0x[a-f0-9]+\b/gi),
  };
}

/**
 * @param {string} filePath
 */
export function collectMetricsFromFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return {
    filePath: path.resolve(filePath),
    ...collectMetrics(text),
  };
}

function main() {
  const [, , inputPath, outputPath = ''] = process.argv;
  if (!inputPath) {
    console.error('Usage: node collect-residue-metrics.mjs <input.js> [output.json]');
    process.exit(1);
  }
  const result = collectMetricsFromFile(inputPath);
  const json = JSON.stringify(result, null, 2);
  if (outputPath) fs.writeFileSync(outputPath, `${json}\n`, 'utf8');
  else process.stdout.write(`${json}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
