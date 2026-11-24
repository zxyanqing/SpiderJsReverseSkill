#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { out: '', fields: 'userAgent,platform,language,languages,hardwareConcurrency,deviceMemory,webdriver', help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i] || '';
    else if (a === '--fields') args.fields = argv[++i] || args.fields;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return args;
}

function usage() {
  return `用法：
  node scripts/generate_manual_probe.js --out probe.js
  node scripts/generate_manual_probe.js --fields userAgent,platform,language --out probe.js

生成只读浏览器探针脚本：在指定真实页面控制台执行，复制打印的 JSON 回传。
不修改页面属性；不读 Cookie/密码。非每任务前置。`;
}

function build(fields) {
  const list = fields.split(',').map((s) => s.trim()).filter(Boolean);
  const fieldLits = JSON.stringify(list);
  return `// Manual read-only probe (generate_manual_probe.js)
// Paste into the target page console. Copy the printed JSON back to the agent.
// Read-only: does not assign browser properties; does not read cookies/passwords.
(function () {
  "use strict";
  var fields = ${fieldLits};
  function probeOne(name) {
    var out = { name: name, missing: false, value: null, valueType: null, error: null };
    try {
      if (!(name in navigator)) {
        out.missing = true;
        out.valueType = "missing";
        return out;
      }
      var v = navigator[name];
      out.value = v;
      out.valueType = v === null ? "null" : typeof v;
      if (Array.isArray(v)) out.valueType = "array";
    } catch (e) {
      out.error = String(e && e.message || e);
      out.valueType = "throw";
    }
    return out;
  }
  var report = {
    href: String(location.href || ""),
    userAgent: String(navigator.userAgent || ""),
    probedAt: new Date().toISOString(),
    fields: fields.map(probeOne)
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
`;
}

try {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const content = build(args.fields);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, content, 'utf8');
    console.log(`已写入人工探针：${path.resolve(args.out)}`);
  } else {
    process.stdout.write(content);
  }
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}

module.exports = { parseArgs, build, usage };
