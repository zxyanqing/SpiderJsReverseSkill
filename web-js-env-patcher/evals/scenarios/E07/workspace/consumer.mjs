#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createRealms, readPlatform } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'realms.js'));

const realms = createRealms();
const childRead = readPlatform(realms, 'child');
const mainRead = readPlatform(realms, 'main');
const ok =
  childRead.realmId === 'child' &&
  childRead.platform === 'child-plat' &&
  mainRead.realmId === 'main' &&
  mainRead.platform === 'main-plat';
const report = { ok, childRead, mainRead, mode: 'formal', websiteAccepted: false };
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
