import fs from 'node:fs';
import path from 'node:path';
import { parseCode } from './parse.js';
import { transform } from './transform.js';
import { generateCode } from './generate.js';

function printHelp() {
  console.log(`用法:
  node src/index.js <input.js> [-o output.js] [--plugins a,b,c]

默认插件顺序: literal-string,constant-fold,member-simplify
不写 -o 则打印到 stdout
`);
}

function parseArgs(argv) {
  const args = { input: null, output: null, plugins: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '-o' || a === '--output') {
      args.output = rest[++i];
    } else if (a === '--plugins') {
      args.plugins = rest[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (!a.startsWith('-') && !args.input) {
      args.input = a;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const absIn = path.resolve(args.input);
const source = fs.readFileSync(absIn, 'utf8');
const ast = parseCode(source);
transform(ast, args.plugins);
const { code } = generateCode(ast, source);

if (args.output) {
  const absOut = path.resolve(args.output);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code, 'utf8');
  console.error(`wrote ${absOut}`);
} else {
  process.stdout.write(code);
  if (!code.endsWith('\n')) process.stdout.write('\n');
}
