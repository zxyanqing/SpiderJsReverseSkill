#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { installEnv } = require(path.join(__dirname, 'env.js'));

const nav = { platform: 'seed' };
const realm = { navigator: nav };
installEnv(realm);

const d = Object.getOwnPropertyDescriptor(realm.navigator, 'platform');
const ok =
  d &&
  d.value === 'MacIntel' &&
  d.writable === false &&
  d.enumerable === true &&
  d.configurable === true;

const report = {
  ok: Boolean(ok),
  descriptor: d,
  mode: 'formal',
  websiteAccepted: false,
  note: '本地消费观察 ≠ 网站接受',
};
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
