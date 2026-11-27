#!/usr/bin/env node
'use strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createJar } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'cookie-jar.js'));

const jar = createJar();
jar.setCookie('sid=1; Path=/app');
jar.setCookie('ok=1; Path=/');
const atOther = jar.getCookie('/other');
const atApp = jar.getCookie('/app/x');
const ok = !/(?:^|;\s*)sid=/.test(atOther) && /(?:^|;\s*)ok=/.test(atOther) && /(?:^|;\s*)sid=/.test(atApp);
const report = { ok, atOther, atApp, mode: 'formal', websiteAccepted: false };
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 2);
