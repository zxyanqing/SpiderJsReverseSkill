/**
 * Stage 8 · restore-explicit-state-machine 正例 / 反例 / 行为 / 幂等
 * 运行：cd tools/deobfuscator && npm run test:c8-state
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform } from '../src/transform.js';
import { generateCode } from '../src/generate.js';

const PLUGIN = 'restore-explicit-state-machine';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/c8-state');

function normalize(code) {
  return code.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '').replace(/\r\n/g, '\n').trim() + '\n';
}

function run(source) {
  const ast = parseCode(source);
  transform(ast, [PLUGIN]);
  return generateCode(ast, source).code;
}

function observe(source) {
  try {
    const value = new Function(`${source}\nreturn sample();`)();
    return { kind: 'return', value };
  } catch (error) {
    return {
      kind: 'throw',
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

let failed = 0;
function check(title, ok, detail = '') {
  if (ok) console.log(`✓ ${title}`);
  else {
    failed += 1;
    console.error(`✗ ${title}${detail ? `\n${detail}` : ''}`);
  }
}

const posIn = fs.readFileSync(path.join(dir, '01-positive-input.js'), 'utf8');
const posOut = run(posIn);
const posExp = fs.readFileSync(path.join(dir, '01-positive-expected.js'), 'utf8');
check('positive source', normalize(posOut) === normalize(posExp), `got:\n${posOut}`);
check(
  'positive behavior',
  JSON.stringify(observe(posOut)) === JSON.stringify(observe(posIn)),
);

const negIn = fs.readFileSync(path.join(dir, '02-negative-input.js'), 'utf8');
const negOut = run(negIn);
const negExp = fs.readFileSync(path.join(dir, '02-negative-expected.js'), 'utf8');
check('negative unchanged', normalize(negOut) === normalize(negExp), `got:\n${negOut}`);

const again = run(posOut);
check('idempotent', normalize(again) === normalize(posOut));

if (failed) {
  console.error(`失败 ${failed}`);
  process.exit(1);
}
console.log('全部通过（c8-state）');
