#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { loadWithImports } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'loader.js'));

let missingFailed = false;
try {
  const r = loadWithImports(['env.mem', 'env.abort'], { 'env.abort': { value: 1 } });
  if (r && r.ok === false) missingFailed = true;
} catch {
  missingFailed = true;
}

const full = loadWithImports(['env.mem'], { 'env.mem': { buffer: true } });
const ok = missingFailed === true && full && full.ok === true;
const report = { ok, missingFailed, fullOk: Boolean(full && full.ok), mode: 'formal', websiteAccepted: false };
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
