'use strict';
/**
 * Minimal DOM milestone fixture runner (D10).
 * Uses jsdom page-inline classic sync scripts (runScripts: "dangerously").
 * Document order applies ONLY to this fixture — not a general page scheduler.
 * outside-only + external eval must NOT be treated as passing this milestone.
 * Trusted local fixture only; untrusted pages need OS/external isolation (see workflow.md).
 */
const fs = require('node:fs');
const path = require('node:path');

function runDomMilestone(options = {}) {
  const { JSDOM } = options.jsdom || require('jsdom');
  const htmlPath = options.htmlPath || path.join(__dirname, 'jsdom-dom-milestone.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://milestone.test/app/',
    runScripts: 'dangerously',
    resources: 'usable',
  });
  const m = dom.window.__milestone || {};
  const result = {
    nodeQuery: !!(m.node && m.node.id === 'probe'),
    relativeUrl: m.rel === 'https://milestone.test/app/asset.js',
    sharedRealm: m.fromFirst === 'from-s1' && m.sameWindow === true,
    currentScript: m.s1Current === 's1' && m.s2Current === 's2',
    raw: {
      s1Current: m.s1Current,
      s2Current: m.s2Current,
      fromFirst: m.fromFirst,
      rel: m.rel,
      nodeId: m.node && m.node.id,
    },
  };
  result.ok = result.nodeQuery && result.relativeUrl && result.sharedRealm && result.currentScript;
  dom.window.close();
  return result;
}

if (require.main === module) {
  const result = runDomMilestone();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { runDomMilestone };
