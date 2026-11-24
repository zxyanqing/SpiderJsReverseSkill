'use strict';
// Applicable when: small DOM + sync trusted scripts (outside-only). Not a default for every project.
// Not for: page-inline currentScript/order milestone (use jsdom-dom-milestone.js); untrusted scripts;
// full browser layout/device backends; hanging Promise/I/O (use terminable process/Worker).
// DOM, selectors, cookie and Storage remain owned by the original jsdom Window.
const vm = require('node:vm');
const { createRuntime } = require('../runtime-frameworks/runtime-factory');

function createJsdomExample(options = {}) {
  const { JSDOM, CookieJar } = options.jsdom || require('jsdom');
  const timeout = options.timeoutMs ?? 1000;
  const adapter = {
    initialize({ fixture }) {
      const url = fixture.pageUrl || 'https://example.test/';
      const cookieJar = new CookieJar();
      // request.cookie is a Cookie request header, never a Set-Cookie string.
      // Its pairs have no scope metadata: seed host-only cookies at Path=/.
      const header = fixture.request?.cookie;
      if (header != null && typeof header !== 'string') throw new TypeError('request.cookie must be a Cookie request header string');
      for (const part of (header || '').split(';')) {
        const pair = part.trim();
        if (!pair) continue;
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=/.test(pair) || /[\r\n]/.test(pair)) throw new TypeError('Invalid Cookie request header pair');
        cookieJar.setCookieSync(pair + '; Path=/', url, { ignoreError: false });
      }
      // Attribute-bearing response cookies use a separate, explicit list.
      const setCookies = fixture.request?.setCookies ?? [];
      if (!Array.isArray(setCookies) || setCookies.some(value => typeof value !== 'string')) throw new TypeError('request.setCookies must be an array of Set-Cookie strings');
      for (const value of setCookies) cookieJar.setCookieSync(value, url, { ignoreError: false });
      const dom = new JSDOM(fixture.html || '<!doctype html><html><body></body></html>', {
        url, cookieJar,
        runScripts: 'outside-only',
      });
      const { window } = dom;
      for (const type of ['localStorage','sessionStorage']) {
        for (const [key, value] of Object.entries(fixture.request?.[type] || {})) window[type].setItem(key, value);
      }
      return { dom, context: dom.getInternalVMContext() };
    },
    load(state, source, meta) {
      return new vm.Script(source, { filename: meta.filename || 'target.js' }).runInContext(state.context, { timeout });
    },
    call(state, entry, args) {
      if (typeof entry !== 'string' || !entry.split('.').every(x => /^[A-Za-z_$][\w$]*$/.test(x))) throw new TypeError('entry must be a dotted identifier');
      const code = `(() => {
        const parts = ${JSON.stringify(entry.split('.'))};
        if (['window','globalThis','self'].includes(parts[0])) parts.shift();
        let receiver = globalThis;
        for (const part of parts.slice(0,-1)) receiver = receiver[part];
        const result = Reflect.apply(receiver[parts[parts.length-1]], receiver, JSON.parse(${JSON.stringify(JSON.stringify(args))}));
        if (result && typeof result.then === 'function') throw new TypeError('This example supports synchronous entries only');
        return JSON.stringify(result);
      })()`;
      const json = new vm.Script(code).runInContext(state.context, { timeout });
      return json === undefined ? undefined : JSON.parse(json);
    },
    dispose(state) { state.dom.window.close(); },
  };
  return createRuntime({ mode: 'jsEnv', adapter });
}
module.exports = { createJsdomExample };

if (require.main === module) {
  (async () => {
    const runtime = createJsdomExample();
    try {
      await runtime.initialize({ pageUrl: 'https://example.test/', html: '<p id="value" data-count="1">parsed</p>' });
      await runtime.load(`globalThis.change = value => {
        const node = document.getElementById('value');
        node.textContent = value; node.dataset.count = '2';
        document.cookie = 'phase=changed; Path=/';
        return { same: node === document.querySelector('#value'), text: node.textContent,
          count: document.querySelector('#value').getAttribute('data-count'), cookie: document.cookie };
      };`);
      console.log(JSON.stringify(await runtime.call('change', ['updated'])));
    } finally { await runtime.dispose(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
