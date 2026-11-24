/**
 * Phase 1 迁入插件回归
 * 运行：cd tools/deobfuscator && npm run test:phase1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform, DEFAULT_PLUGINS, OPTIONAL_PLUGINS } from '../src/transform.js';
import { generateCode } from '../src/generate.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

function normalize(code) {
  return code.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').replace(/\r\n/g, '\n').trim() + '\n';
}

function run(source, plugins) {
  const ast = parseCode(source);
  transform(ast, plugins);
  return generateCode(ast, source).code;
}

let failed = 0;
function check(title, ok, detail = '') {
  if (ok) console.log(`✓ ${title}`);
  else {
    failed += 1;
    console.error(`✗ ${title}${detail ? `\n${detail}` : ''}`);
  }
}

function suite(name, fixtureDir, plugin) {
  const dir = path.join(root, fixtureDir);
  const posIn = fs.readFileSync(path.join(dir, '01-positive-input.js'), 'utf8');
  const posOut = run(posIn, [plugin]);
  const posExp = fs.readFileSync(path.join(dir, '01-positive-expected.js'), 'utf8');
  check(`${name} positive`, normalize(posOut) === normalize(posExp), `got:\n${posOut}`);

  const negIn = fs.readFileSync(path.join(dir, '02-negative-input.js'), 'utf8');
  const negOut = run(negIn, [plugin]);
  const negExp = fs.readFileSync(path.join(dir, '02-negative-expected.js'), 'utf8');
  check(`${name} negative`, normalize(negOut) === normalize(negExp), `got:\n${negOut}`);

  const again = run(posOut, [plugin]);
  check(`${name} idempotent`, normalize(again) === normalize(posOut));
}

suite('normalize-structure', 'normalize-structure', 'normalize-structure');
suite('inline-dispatchers', 'inline-dispatchers', 'inline-dispatchers');
suite('if-chain-to-switch', 'if-chain-to-switch', 'if-chain-to-switch');
suite('flatten-array-control-flow', 'flatten-array-cf', 'flatten-array-control-flow');
suite('inline-literals', 'inline-literals', 'inline-literals');
suite('rename-identifiers', 'rename-identifiers', 'rename-identifiers');
suite('dead-branch-compare', 'dead-branch-compare', 'dead-branch');

check(
  'rename not in DEFAULT_PLUGINS',
  !DEFAULT_PLUGINS.includes('rename-identifiers') && OPTIONAL_PLUGINS.has('rename-identifiers'),
);

check(
  'new plugins in DEFAULT_PLUGINS',
  [
    'normalize-structure',
    'inline-literals',
    'inline-dispatchers',
    'if-chain-to-switch',
    'flatten-array-control-flow',
  ].every((name) => DEFAULT_PLUGINS.includes(name)),
);

if (failed) {
  console.error(`失败 ${failed}`);
  process.exit(1);
}
console.log('全部通过（phase1）');
