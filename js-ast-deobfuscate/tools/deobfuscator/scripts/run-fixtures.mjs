import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/parse.js';
import { transform } from '../src/transform.js';
import { generateCode } from '../src/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认回归只扫 fixtures/ 根目录的 01/02/03；C7 样本在 fixtures/c7/，由 test:c7 专用跑
const fixturesDir = path.join(__dirname, '../fixtures');

function normalize(code) {
  return code.replace(/\r\n/g, '\n').trim() + '\n';
}

const files = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('-input.js'))
  .sort();
let failed = 0;

for (const inputName of files) {
  const id = inputName.replace(/-input\.js$/, '');
  const expectedName = `${id}-expected.js`;
  const inputPath = path.join(fixturesDir, inputName);
  const expectedPath = path.join(fixturesDir, expectedName);
  if (!fs.existsSync(expectedPath)) {
    console.error(`缺少 ${expectedName}`);
    failed++;
    continue;
  }
  const source = fs.readFileSync(inputPath, 'utf8');
  const expected = fs.readFileSync(expectedPath, 'utf8');
  const ast = parseCode(source);
  transform(ast);
  const { code } = generateCode(ast, source);
  const ok = normalize(code) === normalize(expected);
  if (ok) {
    console.log(`✓ ${id}`);
  } else {
    failed++;
    console.error(`✗ ${id}`);
    console.error('--- got ---\n' + code);
    console.error('--- expected ---\n' + expected);
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n全部通过（${files.length}）`);
