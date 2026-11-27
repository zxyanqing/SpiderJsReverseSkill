#!/usr/bin/env node
'use strict';

/**
 * Default isolated launcher for eval agents (macOS sandbox-exec).
 *
 * Default = restricted-read allow-list (NOT "allow file-read*" + deny /Users):
 *   - (deny default)
 *   - Explicit readable paths: AGENT_WS / SKILL_CLEAN / workRoot (logical + realpath),
 *     Node prefix, and a finite set of OS paths required to boot Node
 *   - Temp: writable under workRoot/tmp (TMPDIR redirected). Outside-workRoot
 *     temps (/private/tmp, os.tmpdir()/var/folders siblings) are NOT freely
 *     readable — no whole-/var or /var/folders read allow
 *   - Optional defense-in-depth denies (--skill-root / EVAL_EXTRA_DENY_READ) are NOT
 *     the completion criterion
 *
 *   node scripts/run_eval_agent_isolated.mjs \
 *     --skill-root /abs/M \
 *     --work-root /abs/work \
 *     --scenario E01 \
 *     -- node /abs/work/SKILL_CLEAN/some-probe.js
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensurePrepared } from './ensure_eval_prepared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`[run_eval_agent_isolated] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    skillRoot: defaultSkillRoot,
    workRoot: null,
    scenario: null,
    cmd: [],
  };
  let i = 2;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out.cmd = argv.slice(i + 1);
      break;
    }
    if (a === '--skill-root') out.skillRoot = argv[++i];
    else if (a === '--work-root') out.workRoot = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else fail(`unknown arg ${a}`);
  }
  if (!out.workRoot) fail('required: --work-root /abs/dir');
  if (!out.scenario) fail('required: --scenario E0x');
  if (!path.isAbsolute(out.workRoot)) fail('--work-root must be absolute');
  if (!path.isAbsolute(out.skillRoot)) fail('--skill-root must be absolute');
  if (!out.cmd.length) fail('required: -- <command>...');
  return out;
}

/** Resolve Node install prefixes that must be on the read allow-list. */
function nodeRuntimeRoots(execPath) {
  const roots = new Set();
  const add = (p) => {
    if (p && path.isAbsolute(p)) roots.add(path.resolve(p));
  };
  add(path.dirname(execPath));
  try {
    const real = fs.realpathSync(execPath);
    add(path.dirname(real));
    add(path.dirname(path.dirname(real)));
    add(path.dirname(path.dirname(execPath)));
  } catch {
    /* ignore */
  }
  return [...roots];
}

function parseExtraDenyPaths(env) {
  const raw = env.EVAL_EXTRA_DENY_READ || '';
  return raw
    .split(':')
    .map((s) => s.trim())
    .filter((s) => s && path.isAbsolute(s));
}

/** Logical path + realpath (macOS /var → /private/var) for Seatbelt subpath allows. */
function pathAllowVariants(p) {
  const out = new Set();
  if (!p || !path.isAbsolute(p)) return [];
  const resolved = path.resolve(p);
  out.add(resolved);
  try {
    out.add(fs.realpathSync(resolved));
  } catch {
    /* path may not exist yet */
  }
  return [...out];
}

function subpathAllows(paths, verb = 'file-read*') {
  const lit = (p) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return paths
    .flatMap((p) => pathAllowVariants(p))
    .map((p) => `(allow ${verb} (subpath "${lit(p)}"))`)
    .join('\n');
}

/**
 * Restricted-read Seatbelt: deny-default + explicit OS/Node/work allow-list.
 * No unconditional `(allow file-read*)`.
 * No whole-/var or /var/folders read allow — outside-workRoot os.tmpdir() answers stay denied.
 */
function writeSeatbeltProfile({
  skillRoot,
  agentWs,
  skillClean,
  workRoot,
  nodeExecPath,
  extraDenyPaths,
}) {
  const lit = (p) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const nodeRoots = nodeRuntimeRoots(nodeExecPath || process.execPath);
  const nodeAllow = nodeRoots
    .map(
      (r) =>
        `(allow file-read* (subpath "${lit(r)}"))\n(allow process-exec* (subpath "${lit(r)}"))`
    )
    .join('\n');

  const extraDeny = (extraDenyPaths || [])
    .map(
      (p) =>
        `(deny file-read* (subpath "${lit(p)}"))\n(deny file-read-metadata (subpath "${lit(p)}"))`
    )
    .join('\n');

  const workTreePaths = [workRoot, agentWs, skillClean];
  const workReadAllow = subpathAllows(workTreePaths, 'file-read*');
  const workWriteAllow = subpathAllows(workTreePaths, 'file-write*');

  const profile = `(version 1)
(deny default)

; --- process / IPC (Node spawn + child) ---
(allow process-fork)
(allow process-exec*)
(allow process-info*)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow mach-register)
(allow system-socket)
(allow file-ioctl)
(allow file-map-executable)

; --- devices ---
(allow file-read* (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/zero") (literal "/dev/dtracehelper"))
(allow file-write* (literal "/dev/null") (literal "/dev/dtracehelper"))

; --- writes: this workRoot only (+ OS folder TMP write helpers; content reads NOT opened) ---
${workWriteAllow}
(allow file-write* (subpath "/var/folders") (subpath "/private/var/folders"))

; --- finite OS read allow-list (no global file-read*; no /Users; no /private/tmp;
;     no whole /var, /private/var, /var/folders — task temps are under workRoot) ---
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read* (subpath "/.vol"))
(allow file-read* (subpath "/Applications"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Volumes"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/cores"))
(allow file-read* (subpath "/dev"))
(allow file-read* (subpath "/etc"))
(allow file-read* (subpath "/home"))
(allow file-read* (subpath "/opt"))
(allow file-read* (subpath "/pkg"))
(allow file-read* (subpath "/sbin"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/private/etc"))
(allow file-read* (subpath "/private/var/db"))

; --- Node install prefix ---
${nodeAllow}
(allow process-exec* (literal "${lit(nodeExecPath || process.execPath)}"))
(allow file-read* (literal "${lit(nodeExecPath || process.execPath)}"))

; --- prepared eval trees + workRoot (TMPDIR lives here; logical + realpath) ---
${workReadAllow}

; --- defense-in-depth (NOT the sole completion criterion) ---
(deny file-read* (subpath "${lit(skillRoot)}"))
(deny file-read-metadata (subpath "${lit(skillRoot)}"))
(deny file-read* (subpath "/private/tmp"))
(deny file-read* (subpath "/tmp"))
(deny file-read* (subpath "/Users"))
; re-assert allow-list after defense denies (Seatbelt last-match)
${nodeAllow}
${workReadAllow}
${extraDeny}
`;
  const profilePath = path.join(workRoot, 'seatbelt.sb');
  fs.writeFileSync(profilePath, profile);
  return profilePath;
}

function main() {
  if (process.platform !== 'darwin') {
    fail('default isolator requires macOS sandbox-exec (darwin)');
  }
  const sandboxExec = '/usr/bin/sandbox-exec';
  if (!fs.existsSync(sandboxExec)) fail('sandbox-exec not found at /usr/bin/sandbox-exec');

  const args = parseArgs(process.argv);
  const { agentWs, skillClean } = ensurePrepared({
    skillRoot: args.skillRoot,
    workRoot: args.workRoot,
    scenario: args.scenario,
    log: (msg) => console.error(msg),
    fail,
  });
  const cmdNode =
    args.cmd[0] && path.isAbsolute(args.cmd[0]) && /node(\.exe)?$/i.test(args.cmd[0])
      ? args.cmd[0]
      : process.execPath;

  const extraDenyPaths = parseExtraDenyPaths(process.env);

  const profilePath = writeSeatbeltProfile({
    skillRoot: args.skillRoot,
    agentWs,
    skillClean,
    workRoot: args.workRoot,
    nodeExecPath: cmdNode,
    extraDenyPaths,
  });

  // Redirect process temp away from /private/tmp so Node boots without opening tmp reads.
  const sandboxTmp = path.join(args.workRoot, 'tmp');
  fs.mkdirSync(sandboxTmp, { recursive: true });

  const env = {
    ...process.env,
    TMPDIR: sandboxTmp,
    TEMP: sandboxTmp,
    TMP: sandboxTmp,
    EVAL_AGENT_WS: agentWs,
    EVAL_SKILL_CLEAN: skillClean,
    EVAL_SKILL_ROOT_DENIED_HINT: path.join(args.skillRoot, 'evals', 'hidden'),
  };

  const r = spawnSync(sandboxExec, ['-f', profilePath, ...args.cmd], {
    encoding: 'utf8',
    env,
    cwd: agentWs,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status == null ? 1 : r.status);
}

main();
