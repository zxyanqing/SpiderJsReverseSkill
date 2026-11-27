#!/usr/bin/env node
'use strict';

/**
 * Local (no MCP) runner for fingerprintjs-local.
 *
 *   node cases/fingerprintjs-local/run-local.mjs --assets /abs/prepared-out
 *   node cases/fingerprintjs-local/run-local.mjs --assets /abs/out --fault wrong-prototype
 *
 * Faults: baseline | wrong-prototype | wrong-resource-version | incomplete-callback
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeConsumer } from './observe.mjs';
import { runFingerprintCase, writeFakeWrongVersionDist } from './lib/load-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error(`[run-local] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { assets: null, fault: 'baseline' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--assets') out.assets = argv[++i];
    else if (a === '--fault') out.fault = argv[++i];
    else fail(`unknown arg: ${a}`);
  }
  if (!out.assets) fail('required: --assets /absolute/prepare-output');
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!path.isAbsolute(args.assets)) fail('--assets must be absolute');
  const runnablePath = path.join(args.assets, 'RUNNABLE.json');
  if (!fs.existsSync(runnablePath)) {
    fail(`missing RUNNABLE.json — run prepare.mjs first: ${runnablePath}`);
  }
  const runnable = JSON.parse(fs.readFileSync(runnablePath, 'utf8'));
  const distCjs = path.join(args.assets, runnable.distCjs);
  const distUmd = runnable.distUmd
    ? path.join(args.assets, runnable.distUmd)
    : distCjs.replace(/fp\.cjs\.js$/, 'fp.umd.js');
  const allowed = new Set([
    'baseline',
    'wrong-prototype',
    'wrong-resource-version',
    'incomplete-callback',
    'missing-matchMedia',
    'host-require-realm',
    'e09-collapse',
    'e09-object-collapse',
  ]);
  if (!allowed.has(args.fault)) fail(`unknown --fault ${args.fault}`);

  let fakeDistDir;
  if (args.fault === 'wrong-resource-version') {
    fakeDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-wrong-ver-'));
    writeFakeWrongVersionDist(fakeDistDir);
  }

  const raw = await runFingerprintCase({
    distCjs,
    distUmd,
    fault: args.fault,
    fakeDistDir,
  });
  const observation = observeConsumer(raw);
  const report = {
    caseId: 'fingerprintjs-local',
    caseDir: __dirname,
    assets: args.assets,
    fault: args.fault,
    raw,
    observation,
    boundary: {
      localSimulationOnly: true,
      websiteAccepted: false,
      text: '本地模拟通过 ≠ 真实网站接受；不得表述为绕过率',
    },
  };
  console.log(JSON.stringify(report, null, 2));
  // FingerprintJS may leave timers (audio etc.); always exit explicitly.
  let code = 0;
  if (args.fault === 'baseline' && !observation.ok) code = 2;
  if (args.fault !== 'baseline' && observation.ok) code = 3;
  process.exit(code);
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
});
