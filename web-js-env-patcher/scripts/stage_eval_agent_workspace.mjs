#!/usr/bin/env node
'use strict';

/**
 * Prepare AGENT_WS only (prompt + workspace). NOT isolation by itself.
 * Does NOT copy hidden/, case.yaml, or scoring-rules — but cwd-only staging
 * still leaves the original $M/evals answer tree readable via absolute paths.
 * Default launch: scripts/run_eval_agent_isolated.mjs (see evals/isolation.md).
 *
 *   node scripts/stage_eval_agent_workspace.mjs --id E01 --out /abs/new-dir
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAgentPackIdentityFromSource } from './eval_content_identity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`[stage_eval_agent_workspace] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { id: null, out: null, skillRoot: defaultSkillRoot };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--id') out.id = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--skill-root') out.skillRoot = argv[++i];
    else fail(`unknown arg ${argv[i]}`);
  }
  if (!out.id || !out.out) fail('required: --id <scenario> --out /absolute/new-dir');
  if (!path.isAbsolute(out.skillRoot)) fail('--skill-root must be absolute');
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function walkFiles(dir, base = dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

function main() {
  const args = parseArgs(process.argv);
  if (!path.isAbsolute(args.out)) fail('--out must be absolute');
  if (fs.existsSync(args.out)) fail(`--out already exists: ${args.out}`);

  const evalsRoot = path.join(args.skillRoot, 'evals');
  const scenario = path.join(evalsRoot, 'scenarios', args.id);
  if (!fs.existsSync(scenario)) fail(`unknown scenario: ${args.id}`);

  const prompt = path.join(scenario, 'prompt.md');
  const workspace = path.join(scenario, 'workspace');
  if (!fs.existsSync(prompt) || !fs.existsSync(workspace)) {
    fail('scenario missing prompt.md or workspace/');
  }

  fs.mkdirSync(args.out, { recursive: true });
  fs.copyFileSync(prompt, path.join(args.out, 'prompt.md'));
  copyDir(workspace, path.join(args.out, 'workspace'));

  const visible = ['prompt.md', ...walkFiles(path.join(args.out, 'workspace')).map((p) => `workspace/${p}`)];
  const forbiddenHints = ['hidden', 'fault.yaml', 'graders', 'scoring-rules', 'case.yaml'];
  for (const rel of visible) {
    const lower = rel.toLowerCase();
    if (forbiddenHints.some((h) => lower.includes(h))) {
      fail(`refusing to stage forbidden path: ${rel}`);
    }
  }

  const identity = computeAgentPackIdentityFromSource(args.skillRoot, args.id);
  const manifest = {
    schemaVersion: 'agent-pack/v1',
    scenarioId: args.id,
    contentIdentity: identity.contentIdentity,
    stagedAt: new Date().toISOString(),
    visibleFiles: visible.sort(),
    excludedByDesign: ['hidden/**', 'case.yaml', 'scoring-rules*.md', 'compare-protocol.md'],
    note: '评分键与故障位置不在本工作区；由评分者另行持有。contentIdentity＝题包字节摘要（路径／HEAD≠内容身份）',
  };
  fs.writeFileSync(path.join(args.out, 'AGENT_PACK.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: args.out,
        files: manifest.visibleFiles.length,
        contentIdentity: manifest.contentIdentity,
      },
      null,
      2
    )
  );
}

main();
