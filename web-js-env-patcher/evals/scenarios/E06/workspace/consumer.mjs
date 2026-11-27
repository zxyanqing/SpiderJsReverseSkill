#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { compute, installHook } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.js'));

const baseline = compute();
const hooked = installHook(compute);
const hookedValue = hooked();
const formal = compute();
const ok = baseline === 7 && formal === 7 && hookedValue === 7;
const report = {
  ok,
  baseline,
  hookedValue,
  formal,
  mode: 'formal',
  websiteAccepted: false,
};
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
