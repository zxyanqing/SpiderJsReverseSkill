'use strict';

/**
 * Probe run inside run_eval_agent_isolated (script must live under SKILL_CLEAN / AGENT_WS).
 * Prints one JSON line with readability flags (see evals/isolation.md).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function canRead(p) {
  if (!p) return false;
  try {
    fs.readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

const agentWs = process.env.EVAL_AGENT_WS;
const skillClean = process.env.EVAL_SKILL_CLEAN;
const hiddenHint = process.env.EVAL_SKILL_ROOT_DENIED_HINT;
const externalHint = process.env.EVAL_EXTERNAL_ANSWER_HINT || '';
const privateTmpHint = process.env.EVAL_PRIVATE_TMP_ANSWER_HINT || '';
const systemTmpHint = process.env.EVAL_SYSTEM_TMP_ANSWER_HINT || '';

if (!agentWs || !skillClean || !hiddenHint) {
  console.error('missing EVAL_AGENT_WS / EVAL_SKILL_CLEAN / EVAL_SKILL_ROOT_DENIED_HINT');
  process.exit(2);
}

const prompt = path.join(agentWs, 'prompt.md');
const skillMd = path.join(skillClean, 'SKILL.md');
const hiddenFile = path.join(hiddenHint, 'E01', 'fault.yaml');
const scoringFile = path.join(path.dirname(hiddenHint), 'scoring-rules.v1.md');
const symlinkHidden = path.join(agentWs, '_leak_symlink_fault.yaml');
const symlinkPrivateTmp = path.join(agentWs, '_leak_symlink_private_tmp.yaml');
const symlinkSystemTmp = path.join(agentWs, '_leak_symlink_system_tmp.yaml');

function resetSymlink(linkPath, target) {
  try {
    if (fs.lstatSync(linkPath)) fs.unlinkSync(linkPath);
  } catch {
    /* absent */
  }
  if (target) fs.symlinkSync(target, linkPath);
}

resetSymlink(symlinkHidden, hiddenFile);
if (privateTmpHint) resetSymlink(symlinkPrivateTmp, privateTmpHint);
if (systemTmpHint) resetSymlink(symlinkSystemTmp, systemTmpHint);

function childCanRead(target) {
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const fs=require('fs');try{fs.readFileSync(process.argv[1]);console.log('1')}catch{console.log('0')}`,
      target,
    ],
    { encoding: 'utf8' }
  );
  return String(child.stdout || '').trim() === '1';
}

const report = {
  agentWsOk: canRead(prompt),
  skillCleanOk: canRead(skillMd),
  hiddenOk: canRead(hiddenFile),
  scoringOk: canRead(scoringFile),
  symlinkOk: canRead(symlinkHidden),
  childHiddenOk: childCanRead(hiddenFile),
  externalAnswerOk: externalHint ? canRead(externalHint) : null,
  childExternalOk: externalHint ? childCanRead(externalHint) : null,
  privateTmpAnswerOk: privateTmpHint ? canRead(privateTmpHint) : null,
  childPrivateTmpOk: privateTmpHint ? childCanRead(privateTmpHint) : null,
  privateTmpSymlinkOk: privateTmpHint ? canRead(symlinkPrivateTmp) : null,
  systemTmpAnswerOk: systemTmpHint ? canRead(systemTmpHint) : null,
  childSystemTmpOk: systemTmpHint ? childCanRead(systemTmpHint) : null,
  systemTmpSymlinkOk: systemTmpHint ? canRead(symlinkSystemTmp) : null,
  nodeBinOk: canRead(process.execPath),
};

console.log(JSON.stringify(report));

try {
  fs.unlinkSync(symlinkHidden);
} catch {
  /* ignore */
}
try {
  if (privateTmpHint) fs.unlinkSync(symlinkPrivateTmp);
} catch {
  /* ignore */
}
try {
  if (systemTmpHint) fs.unlinkSync(symlinkSystemTmp);
} catch {
  /* ignore */
}
