#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { compare, requiredKeys } = require(path.join(dir, 'compare.js'));

const actual = { sign: 'abc', ts: 1 };
const fixtureA = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-a.json'), 'utf8'));
const fixtureB = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-b.json'), 'utf8'));

const reportA = compare(fixtureA, actual);
const reportB = compare(fixtureB, actual);

const aRejected = reportA.ok === false && reportA.status !== 'passed';
const ok = aRejected && reportB.ok === true;
const report = {
  ok,
  reportA,
  reportB,
  requiredKeys,
  mode: 'formal',
  websiteAccepted: false,
};
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
