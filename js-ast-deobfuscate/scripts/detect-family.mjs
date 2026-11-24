#!/usr/bin/env node
/**
 * F1 家族检测：输出 family id / score / reasons / 推荐 A 插件与 B hints。
 *
 * Usage:
 *   node scripts/detect-family.mjs <input.js> [hint] [output.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { detectFamily } from './family-registry.mjs';

const [, , inputPath, hint = '', outputPath = ''] = process.argv;
if (!inputPath) {
  console.error('Usage: node scripts/detect-family.mjs <input.js> [hint] [output.json]');
  process.exit(1);
}

const abs = path.resolve(inputPath);
const sourceText = fs.readFileSync(abs, 'utf8');
const result = detectFamily({ inputPath: abs, hint, sourceText });
const selected = result.selected;

const serializable = {
  mode: 'F1',
  auto_run_family_pass: false,
  inputPath: abs,
  hint,
  bestId: result.bestId,
  selected: {
    id: selected.id,
    displayName: selected.displayName,
    reference: selected.reference,
    families: selected.families,
    notes: selected.notes,
    a_plugins: selected.a_plugins,
    skip_plugins: selected.skip_plugins || [],
    optional_plugins: selected.optional_plugins || [],
    b_scaffold_hints: selected.b_scaffold_hints,
  },
  detections: result.detections,
};

const json = JSON.stringify(serializable, null, 2);
if (outputPath) {
  fs.writeFileSync(outputPath, json, 'utf8');
  console.error(`wrote ${path.resolve(outputPath)}`);
} else {
  process.stdout.write(`${json}\n`);
}
