#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { runAndReport } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner.js'));

const out = await runAndReport();
const ok = out.done === true && out.result && out.result.value === 42;
const report = { ok, out: { done: out.done, result: out.result }, mode: 'formal', websiteAccepted: false };
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
