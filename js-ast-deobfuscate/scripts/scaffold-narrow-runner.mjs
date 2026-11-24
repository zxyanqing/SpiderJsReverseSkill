#!/usr/bin/env node
/**
 * Scaffold a sample-scoped scheme-B narrow runner directory.
 *
 * Usage:
 *   node scripts/scaffold-narrow-runner.mjs \
 *     --id gcaptcha4 \
 *     --morphology encoded-bootstrap-dispatcher \
 *     --out-dir ./narrow/gcaptcha4
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const templatePath = path.join(__dirname, 'templates', 'narrow-runner.mjs.template');

function parseArgs(argv) {
  const out = { id: null, morphology: 'unknown', outDir: null, help: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--id') out.id = rest[++i];
    else if (a === '--morphology') out.morphology = rest[++i];
    else if (a === '--out-dir') out.outDir = rest[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function notesTemplate(sampleId, morphology) {
  return `# Narrow notes — ${sampleId}

## morphology_id

\`${morphology}\`

## Evidence (fill)

- 

## Guards (fill)

- 

## Child-process eval

Reuse \`tools/deobfuscator/src/lib/evaluate-in-child.js\`.

## Out of scope

- Browser / env fabrication
- Promoting into REGISTRY without user request
`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.id || !args.outDir) {
    console.log(`Usage:
  node scaffold-narrow-runner.mjs --id <sample_id> --morphology <id> --out-dir <dir>

skill root: ${skillRoot}
`);
    process.exit(args.help ? 0 : 1);
  }

  if (!fs.existsSync(templatePath)) {
    console.error(`missing template: ${templatePath}`);
    process.exit(1);
  }

  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const runnerPath = path.join(outDir, 'runner.mjs');
  const notesPath = path.join(outDir, 'notes.md');
  if (fs.existsSync(runnerPath)) {
    console.error(`refusing to overwrite existing ${runnerPath}`);
    process.exit(1);
  }

  const runnerSrc = fs
    .readFileSync(templatePath, 'utf8')
    .replaceAll('__SAMPLE_ID__', args.id)
    .replaceAll('__MORPHOLOGY_ID__', args.morphology);

  fs.writeFileSync(runnerPath, runnerSrc, 'utf8');
  fs.writeFileSync(notesPath, notesTemplate(args.id, args.morphology), 'utf8');
  fs.chmodSync(runnerPath, 0o755);
  console.log(
    JSON.stringify({
      ok: true,
      outDir,
      runnerPath,
      notesPath,
      morphology: args.morphology,
    }),
  );
}

main();
