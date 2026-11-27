#!/usr/bin/env node
'use strict';

/**
 * Content-identity helpers for AGENT_WS / SKILL_CLEAN (Y05 / I3).
 * Path string or git HEAD alone is NOT identity — hashes must reflect file bytes
 * (including uncommitted edits in the clean input set).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'hidden']);
const SKIP_FILE_NAMES = new Set(['case.yaml', 'fault.yaml']);

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
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

/** Same skip rules as build_eval_skill_clean — files that constitute the clean copy. */
export function listSkillCleanInputFiles(skillRoot) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.' || ent.name === '..') continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(skillRoot, abs).split(path.sep).join('/');
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (ent.name === 'hidden' || ent.name === 'node_modules' || ent.name === '.git') continue;
        if (rel === 'evals/hidden' || rel.startsWith('evals/hidden/')) continue;
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (SKIP_FILE_NAMES.has(ent.name) || isAnswerPath(rel)) continue;
      if (/^evals\/scoring-rules/i.test(rel)) continue;
      files.push(rel);
    }
  };
  walk(skillRoot);
  return files.sort();
}

/**
 * Stable content identity: sha256 over sorted "rel\\0sha256\\n" lines.
 * @param {string} root
 * @param {string[]} relPaths
 */
export function hashFileSet(root, relPaths) {
  const lines = [];
  for (const rel of [...relPaths].sort()) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      lines.push(`${rel}\0MISSING`);
      continue;
    }
    lines.push(`${rel}\0${sha256File(abs)}`);
  }
  return sha256Buffer(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

export function walkFiles(dir, base = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, base, acc);
    else if (ent.isFile()) acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

/** Expected AGENT_WS identity from scenario sources under skillRoot/evals. */
export function computeAgentPackIdentityFromSource(skillRoot, scenarioId) {
  const scenarioDir = path.join(skillRoot, 'evals', 'scenarios', scenarioId);
  const prompt = path.join(scenarioDir, 'prompt.md');
  const workspace = path.join(scenarioDir, 'workspace');
  const rels = ['prompt.md'];
  if (fs.existsSync(workspace)) {
    for (const r of walkFiles(workspace)) rels.push(`workspace/${r}`);
  }
  const contentIdentity = hashFileSet(scenarioDir, rels.filter((r) => r === 'prompt.md' || r.startsWith('workspace/')));
  // hashFileSet with root=scenarioDir: prompt.md is at scenarioDir/prompt.md; workspace/* similarly.
  return {
    scenarioId,
    contentIdentity,
    visibleFiles: rels.sort(),
  };
}

/** Identity of an already-staged AGENT_WS tree (excludes AGENT_PACK.json). */
export function computeAgentPackIdentityFromStaged(agentWs) {
  const rels = walkFiles(agentWs).filter((r) => r !== 'AGENT_PACK.json');
  return {
    contentIdentity: hashFileSet(agentWs, rels),
    visibleFiles: rels.sort(),
  };
}

/** Expected SKILL_CLEAN identity from current skillRoot bytes (incl. uncommitted). */
export function computeSkillCleanIdentityFromSource(skillRoot) {
  const rels = listSkillCleanInputFiles(skillRoot);
  return {
    contentIdentity: hashFileSet(skillRoot, rels),
    fileCount: rels.length,
  };
}

/** Identity of built SKILL_CLEAN tree (excludes SKILL_CLEAN.json). */
export function computeSkillCleanIdentityFromBuilt(skillClean) {
  const rels = walkFiles(skillClean).filter((r) => r !== 'SKILL_CLEAN.json');
  return {
    contentIdentity: hashFileSet(skillClean, rels),
    fileCount: rels.length,
  };
}

/**
 * Decide whether AGENT_WS must be rebuilt.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkAgentWsIdentity(agentWs, skillRoot, scenarioId) {
  const packPath = path.join(agentWs, 'AGENT_PACK.json');
  if (!fs.existsSync(packPath)) return { ok: false, reason: 'missing-pack' };
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-pack' };
  }
  if (pack.scenarioId !== scenarioId) {
    return {
      ok: false,
      reason: `scenario-mismatch:pack=${pack.scenarioId}:want=${scenarioId}`,
    };
  }
  const expected = computeAgentPackIdentityFromSource(skillRoot, scenarioId);
  if (pack.contentIdentity !== expected.contentIdentity) {
    return { ok: false, reason: 'source-content-mismatch' };
  }
  const staged = computeAgentPackIdentityFromStaged(agentWs);
  if (staged.contentIdentity !== expected.contentIdentity) {
    return { ok: false, reason: 'staged-content-mismatch' };
  }
  return { ok: true };
}

/**
 * Decide whether SKILL_CLEAN must be rebuilt.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkSkillCleanIdentity(skillClean, skillRoot) {
  const manPath = path.join(skillClean, 'SKILL_CLEAN.json');
  if (!fs.existsSync(manPath)) return { ok: false, reason: 'missing-manifest' };
  let man;
  try {
    man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-manifest' };
  }
  const expected = computeSkillCleanIdentityFromSource(skillRoot);
  if (man.contentIdentity !== expected.contentIdentity) {
    return { ok: false, reason: 'source-content-mismatch' };
  }
  const built = computeSkillCleanIdentityFromBuilt(skillClean);
  if (built.contentIdentity !== expected.contentIdentity) {
    return { ok: false, reason: 'built-content-mismatch' };
  }
  return { ok: true };
}
