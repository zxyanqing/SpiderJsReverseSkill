'use strict';

/**
 * Prepare / refresh AGENT_WS + SKILL_CLEAN with content-identity checks (Y05 / I3).
 * Default on mismatch: destroy and rebuild (never silent reuse).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkAgentWsIdentity,
  checkSkillCleanIdentity,
} from './eval_content_identity.mjs';

/**
 * @param {object} opts
 * @param {string} opts.skillRoot
 * @param {string} opts.workRoot
 * @param {string} opts.scenario
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.fail]
 */
export function ensurePrepared(opts) {
  const { skillRoot, workRoot, scenario } = opts;
  const log = opts.log || ((msg) => console.error(msg));
  const fail =
    opts.fail ||
    ((msg) => {
      throw new Error(msg);
    });

  const agentWs = path.join(workRoot, 'AGENT_WS');
  const skillClean = path.join(workRoot, 'SKILL_CLEAN');
  fs.mkdirSync(workRoot, { recursive: true });

  const rebuilds = [];

  const agentCheck = checkAgentWsIdentity(agentWs, skillRoot, scenario);
  if (!agentCheck.ok) {
    const reason = agentCheck.reason || 'missing';
    log(`[ensure_eval_prepared] AGENT_WS identity rebuild (${reason})`);
    if (fs.existsSync(agentWs)) fs.rmSync(agentWs, { recursive: true, force: true });
    const stage = path.join(skillRoot, 'scripts', 'stage_eval_agent_workspace.mjs');
    const r = spawnSync(
      process.execPath,
      [stage, '--skill-root', skillRoot, '--id', scenario, '--out', agentWs],
      { encoding: 'utf8' }
    );
    if (r.status !== 0) fail(`stage AGENT_WS failed: ${r.stderr || r.stdout}`);
    const after = checkAgentWsIdentity(agentWs, skillRoot, scenario);
    if (!after.ok) fail(`AGENT_WS identity still invalid after rebuild: ${after.reason}`);
    rebuilds.push({ tree: 'AGENT_WS', reason });
  }

  const cleanCheck = checkSkillCleanIdentity(skillClean, skillRoot);
  if (!cleanCheck.ok) {
    const reason = cleanCheck.reason || 'missing';
    log(`[ensure_eval_prepared] SKILL_CLEAN identity rebuild (${reason})`);
    if (fs.existsSync(skillClean)) fs.rmSync(skillClean, { recursive: true, force: true });
    const build = path.join(skillRoot, 'scripts', 'build_eval_skill_clean.mjs');
    const r = spawnSync(
      process.execPath,
      [build, '--skill-root', skillRoot, '--out', skillClean],
      { encoding: 'utf8' }
    );
    if (r.status !== 0) fail(`build SKILL_CLEAN failed: ${r.stderr || r.stdout}`);
    const after = checkSkillCleanIdentity(skillClean, skillRoot);
    if (!after.ok) fail(`SKILL_CLEAN identity still invalid after rebuild: ${after.reason}`);
    rebuilds.push({ tree: 'SKILL_CLEAN', reason });
  }

  return { agentWs, skillClean, rebuilds };
}
