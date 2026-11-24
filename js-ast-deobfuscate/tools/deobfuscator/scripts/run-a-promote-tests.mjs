/**
 * A 晋升：normalize-object-ref-state / cleanup-concat-decoy / restore-for-switch-state
 * 运行：cd tools/deobfuscator && npm run test:a-promote
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform } from '../src/transform.js';
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

suite('normalize-object-ref-state', 'object-ref-state', 'normalize-object-ref-state');
suite('cleanup-concat-decoy', 'concat-decoy', 'cleanup-concat-decoy');
suite('restore-for-switch-state', 'for-switch-state', 'restore-for-switch-state');

{
  const dir = path.join(root, 'concat-decoy');
  const multiIn = fs.readFileSync(path.join(dir, '03-multi-decl-input.js'), 'utf8');
  const multiOut = run(multiIn, ['cleanup-concat-decoy']);
  const multiExp = fs.readFileSync(path.join(dir, '03-multi-decl-expected.js'), 'utf8');
  check(
    'cleanup-concat-decoy multi-decl',
    normalize(multiOut) === normalize(multiExp),
    `got:\n${multiOut}`,
  );
}

if (failed) {
  console.error(`失败 ${failed}`);
  process.exit(1);
}
console.log('全部通过（a-promote）');
