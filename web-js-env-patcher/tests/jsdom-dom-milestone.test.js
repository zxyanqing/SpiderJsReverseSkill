'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { runDomMilestone } = require('../assets/examples/jsdom-dom-milestone');

test('DOM milestone: node query, relative URL, shared realm, currentScript', () => {
  const result = runDomMilestone();
  assert.equal(result.nodeQuery, true, `nodeQuery failed: ${JSON.stringify(result.raw)}`);
  assert.equal(result.relativeUrl, true, `relativeUrl failed: ${JSON.stringify(result.raw)}`);
  assert.equal(result.sharedRealm, true, `sharedRealm failed: ${JSON.stringify(result.raw)}`);
  assert.equal(result.currentScript, true, `currentScript failed: ${JSON.stringify(result.raw)}`);
  assert.equal(result.ok, true);
});

test('outside-only + external eval must not count as DOM milestone currentScript pass', () => {
  const htmlPath = path.join(__dirname, '../assets/examples/jsdom-dom-milestone.html');
  const fs = require('node:fs');
  const html = fs.readFileSync(htmlPath, 'utf8');
  // Strip inline scripts so outside-only path cannot rely on page-inline execution.
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(stripped, {
    url: 'https://milestone.test/app/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(`
    window.__milestone = {};
    window.__milestone.s1Current = document.currentScript && document.currentScript.id;
    window.__milestone.shared = 'from-s1';
    window.__milestone.node = document.querySelector('#probe');
    window.__milestone.rel = new URL('asset.js', document.baseURI).href;
    window.__milestone.s2Current = document.currentScript && document.currentScript.id;
    window.__milestone.fromFirst = window.__milestone.shared;
    window.__milestone.sameWindow = window.__milestone.node && window.__milestone.node.ownerDocument === document;
  `);
  const m = window.__milestone;
  // May satisfy node/rel/shared under outside-only, but currentScript during external eval is not the page script elements.
  assert.notEqual(m.s1Current, 's1');
  assert.notEqual(m.s2Current, 's2');
  dom.window.close();
});
