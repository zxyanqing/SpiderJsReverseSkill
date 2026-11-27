'use strict';

import fs from 'node:fs';
import path from 'node:path';

/**
 * F1.3: scan agent-visible eval packs for leak phrases / leaky path ids.
 */

export const LEAK_PATTERNS = [
  /BUG:/i,
  /\balways main\b/i,
  /descriptor is wrong/i,
  /\bBroken env\b/i,
  /empty fill/i,
  /ignores pagePath/i,
  /does not require fixture/i,
  /After fix:/i,
  /请修\b/,
  /请定位\b/,
  /fix_hint/i,
  /fault_class/i,
  /fault\.yaml/i,
  /\bdescriptor-wrong\b/,
  /\bcookie-path-visibility\b/,
  /\basync-boundary\b/,
  /\bfixture-truncated\b/,
  /\bwasm-import-missing\b/,
  /\bhook-side-effect\b/,
  /\brealm-child\b/,
];

export const LEAKY_PUBLIC_IDS = [
  'descriptor-wrong',
  'cookie-path-visibility',
  'async-boundary',
  'fixture-truncated',
  'wasm-import-missing',
  'hook-side-effect',
  'realm-child',
];

export function scanText(text, source = '') {
  const hits = [];
  const s = String(text || '');
  for (const re of LEAK_PATTERNS) {
    if (re.test(s)) hits.push({ source, pattern: String(re) });
  }
  return hits;
}

export function scanPathName(relPath) {
  const hits = [];
  const parts = String(relPath).toLowerCase().replace(/\\/g, '/').split('/');
  for (const id of LEAKY_PUBLIC_IDS) {
    if (parts.includes(id)) hits.push({ source: relPath, pattern: `path:${id}` });
  }
  return hits;
}

export function listFiles(dir) {
  const acc = [];
  const walk = (d, base) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full, base);
      else acc.push({ abs: full, rel: path.relative(base, full).split(path.sep).join('/') });
    }
  };
  walk(dir, dir);
  return acc;
}

export function scanAgentPackDir(packDir) {
  const hits = [];
  for (const { abs, rel } of listFiles(packDir)) {
    hits.push(...scanPathName(rel));
    hits.push(...scanText(fs.readFileSync(abs, 'utf8'), rel));
  }
  return hits;
}
