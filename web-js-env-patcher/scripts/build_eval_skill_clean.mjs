#!/usr/bin/env node
'use strict';

/**
 * Build SKILL_CLEAN: runnable skill copy without answer materials.
 * Physical copy only — no symlinks into evals/hidden or scoring-rules.
 *
 *   node scripts/build_eval_skill_clean.mjs --out /abs/SKILL_CLEAN
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSkillCleanIdentityFromSource } from './eval_content_identity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(__dirname, '..');

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'hidden']);
const SKIP_FILE_NAMES = new Set(['case.yaml', 'fault.yaml']);

function fail(msg) {
  console.error(`[build_eval_skill_clean] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { out: null, skillRoot: defaultSkillRoot };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--skill-root') out.skillRoot = argv[++i];
    else fail(`unknown arg ${argv[i]}`);
  }
  if (!out.out) fail('required: --out /absolute/new-dir');
  if (!path.isAbsolute(out.out)) fail('--out must be absolute');
  if (!path.isAbsolute(out.skillRoot)) fail('--skill-root must be absolute');
  return out;
}

function isAnswerPath(relPosix) {
  const parts = relPosix.split('/');
  if (parts[0] === 'evals' && parts[1] === 'hidden') return true;
  if (/^evals\/scoring-rules/i.test(relPosix)) return true;
  if (parts.includes('graders')) return true;
  if (parts[parts.length - 1] === 'case.yaml') return true;
  if (parts[parts.length - 1] === 'fault.yaml') return true;
  if (parts[parts.length - 1] === 'public-id-map.yaml') return true;
  return false;
}

function copyTree(srcRoot, destRoot) {
  const copied = [];
  const skipped = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.' || ent.name === '..') continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(srcRoot, abs).split(path.sep).join('/');
      if (ent.isSymbolicLink()) {
        skipped.push({ rel, reason: 'symlink' });
        continue;
      }
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name) && (rel === ent.name || rel.endsWith(`/${ent.name}`) || rel === `evals/${ent.name}`)) {
          // skip node_modules/.git at root; skip evals/hidden entirely
          if (ent.name === 'hidden' || ent.name === 'node_modules' || ent.name === '.git') {
            skipped.push({ rel, reason: 'skip-dir' });
            continue;
          }
        }
        if (rel === 'evals/hidden' || rel.startsWith('evals/hidden/')) {
          skipped.push({ rel, reason: 'hidden' });
          continue;
        }
        walk(abs);
        continue;
      }
      if (!ent.isFile()) {
        skipped.push({ rel, reason: 'non-file' });
        continue;
      }
      if (SKIP_FILE_NAMES.has(ent.name) || isAnswerPath(rel)) {
        skipped.push({ rel, reason: 'answer-material' });
        continue;
      }
      if (/^evals\/scoring-rules/i.test(rel)) {
        skipped.push({ rel, reason: 'scoring-rules' });
        continue;
      }
      const dest = path.join(destRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
      copied.push(rel);
    }
  };
  walk(srcRoot);
  return { copied, skipped };
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) fail(`--out already exists: ${args.out}`);
  fs.mkdirSync(args.out, { recursive: true });
  const { copied, skipped } = copyTree(args.skillRoot, args.out);

  // Guard: no hidden / scoring-rules / case.yaml slipped in
  for (const rel of copied) {
    if (isAnswerPath(rel) || rel.startsWith('evals/hidden/') || /^evals\/scoring-rules/i.test(rel)) {
      fail(`answer material copied: ${rel}`);
    }
  }
  if (fs.existsSync(path.join(args.out, 'evals', 'hidden'))) {
    fail('evals/hidden must not exist in SKILL_CLEAN');
  }

  const identity = computeSkillCleanIdentityFromSource(args.skillRoot);
  const manifest = {
    schemaVersion: 'skill-clean/v1',
    sourceSkillRoot: args.skillRoot,
    contentIdentity: identity.contentIdentity,
    builtAt: new Date().toISOString(),
    copiedCount: copied.length,
    skippedCount: skipped.length,
    note: 'No evals/hidden, scoring-rules, case.yaml, fault.yaml, graders, or symlinks into answers. contentIdentity＝源 skill 字节摘要（路径／git HEAD≠内容身份；含未提交改动）',
  };
  fs.writeFileSync(path.join(args.out, 'SKILL_CLEAN.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: args.out,
        copied: copied.length,
        skipped: skipped.length,
        contentIdentity: manifest.contentIdentity,
      },
      null,
      2
    )
  );
}

main();
