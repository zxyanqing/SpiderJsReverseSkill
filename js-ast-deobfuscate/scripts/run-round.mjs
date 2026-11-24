#!/usr/bin/env node
/**
 * One Skill round: parse → runUntilStable(selected plugins) → write JS + JSON report.
 * Does not invent plugins; only names present in tools/deobfuscator REGISTRY.
 *
 * Resolves deobfuscator via (first hit wins):
 *   1) DEOBFUSCATOR_ROOT
 *   2) <skillRoot>/tools/deobfuscator   (bundled, preferred)
 *   3) AST_STUDY_ROOT/tools/deobfuscator
 *   4) sibling ../AST_Study/tools/deobfuscator
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function resolveDeobRoot() {
  if (process.env.DEOBFUSCATOR_ROOT) {
    return path.resolve(process.env.DEOBFUSCATOR_ROOT);
  }
  const candidates = [
    path.join(skillRoot, 'tools/deobfuscator'),
    process.env.AST_STUDY_ROOT
      ? path.join(path.resolve(process.env.AST_STUDY_ROOT), 'tools/deobfuscator')
      : null,
    path.resolve(skillRoot, '../AST_Study/tools/deobfuscator'),
  ].filter(Boolean);

  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'src/transform.js'))) {
      return root;
    }
  }
  return candidates[0];
}

const deobRoot = resolveDeobRoot();

function parseArgs(argv) {
  const out = {
    input: null,
    output: null,
    plugins: [],
    report: null,
    maxInner: 6,
    timeoutMs: 0,
    reparse: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--in') out.input = rest[++i];
    else if (a === '--out') out.output = rest[++i];
    else if (a === '--plugins') {
      out.plugins = String(rest[++i])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--report') out.report = rest[++i];
    else if (a === '--max-inner') out.maxInner = Number(rest[++i]);
    else if (a === '--timeout-ms') out.timeoutMs = Number(rest[++i]);
    else if (a === '--reparse') out.reparse = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node run-round.mjs --in input.js --out output.js --plugins a,b,c \\
    [--report round.json] [--max-inner 6] [--timeout-ms N] [--reparse]

skill root:     ${skillRoot}
deobfuscator:   ${deobRoot}
Override with DEOBFUSCATOR_ROOT or AST_STUDY_ROOT if needed.
`);
}

async function loadDeobModules() {
  const parseUrl = pathToFileURL(path.join(deobRoot, 'src/parse.js')).href;
  const generateUrl = pathToFileURL(path.join(deobRoot, 'src/generate.js')).href;
  const stableUrl = pathToFileURL(path.join(deobRoot, 'src/lib/run-until-stable.js')).href;
  const transformUrl = pathToFileURL(path.join(deobRoot, 'src/transform.js')).href;
  const typesUrl = pathToFileURL(path.join(deobRoot, 'node_modules/@babel/types/lib/index.js')).href;

  const [{ parseCode }, { generateCode }, { runUntilStable }, transformMod, typesMod] = await Promise.all([
    import(parseUrl),
    import(generateUrl),
    import(stableUrl),
    import(transformUrl),
    import(typesUrl),
  ]);
  const t = typesMod.default ?? typesMod;

  const reparseUrl = pathToFileURL(path.join(deobRoot, 'src/lib/reparse.js')).href;
  const { reparseAst } = await import(reparseUrl);

  const factories = {};
  for (const name of transformMod.listPlugins()) {
    const mod = await import(
      pathToFileURL(path.join(deobRoot, 'src/plugins', `${name}.js`)).href
    );
    factories[name] = mod.default;
  }

  return {
    parseCode,
    generateCode,
    runUntilStable,
    reparseAst,
    listPlugins: transformMod.listPlugins,
    listDefaultPlugins: transformMod.listDefaultPlugins,
    factories,
    t,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input || !args.output || args.plugins.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!fs.existsSync(path.join(deobRoot, 'src/transform.js'))) {
    console.error(`deobfuscator not found at ${deobRoot}`);
    console.error('Run: cd tools/deobfuscator && npm install');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(deobRoot, 'node_modules/@babel/types'))) {
    console.error(`Babel deps missing under ${deobRoot}`);
    console.error('Run: cd tools/deobfuscator && npm install');
    process.exit(1);
  }

  const callerCwd = process.cwd();
  const resolveCaller = (p) => path.resolve(callerCwd, p);
  const absOut = resolveCaller(args.output);
  const absReport = args.report ? resolveCaller(args.report) : null;
  const absInResolved = resolveCaller(args.input);

  process.chdir(deobRoot);
  const {
    parseCode,
    generateCode,
    runUntilStable,
    reparseAst,
    factories,
    listPlugins,
    t,
  } = await loadDeobModules();
  const known = new Set(listPlugins());

  for (const name of args.plugins) {
    if (!known.has(name) || !factories[name]) {
      console.error(`Unknown or unavailable plugin: ${name}`);
      console.error(`Available: ${[...known].join(',')}`);
      process.exit(1);
    }
  }

  const source = fs.readFileSync(absInResolved, 'utf8');
  let ast = parseCode(source);
  const selected = args.plugins.map((name) => factories[name]);
  const startedAt = Date.now();

  let result;
  if (args.timeoutMs > 0) {
    result = await Promise.race([
      Promise.resolve().then(() => runUntilStable(ast, selected, args.maxInner, { types: t })),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`run-round timeout after ${args.timeoutMs}ms`)), args.timeoutMs);
      }),
    ]);
  } else {
    result = runUntilStable(ast, selected, args.maxInner, { types: t });
  }

  if (args.reparse) {
    ast = reparseAst(ast, source);
  }

  const elapsedMs = Date.now() - startedAt;
  const { code } = generateCode(ast, source);

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code.endsWith('\n') ? code : `${code}\n`, 'utf8');

  const totalChanged = result.reports.reduce((sum, r) => sum + (r.changed ?? 0), 0);
  const report = {
    input: absInResolved,
    output: absOut,
    plugins: args.plugins,
    maxInner: args.maxInner,
    timeoutMs: args.timeoutMs || null,
    reparse: Boolean(args.reparse),
    elapsedMs,
    rounds: result.rounds,
    changed: totalChanged,
    reports: result.reports,
    deobfuscatorRoot: deobRoot,
    skillRoot,
  };

  if (absReport) {
    fs.mkdirSync(path.dirname(absReport), { recursive: true });
    fs.writeFileSync(absReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`wrote report ${absReport}`);
  }

  console.error(`wrote ${absOut}; innerRounds=${result.rounds}; changed=${totalChanged}`);
  process.stdout.write(`${JSON.stringify({ ok: true, changed: totalChanged, rounds: result.rounds })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
