'use strict';
function createJar() {
  const map = new Map();
  return {
    setCookie(raw) {
      const [pair, ...attrs] = String(raw).split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : '';
      let path = '/';
      for (const a of attrs) {
        const m = /^Path=(.*)$/i.exec(a);
        if (m) path = m[1] || '/';
      }
      map.set(name, { value, path });
    },
    getCookie(pagePath) {
      void pagePath;
      return [...map.entries()].map(([n, v]) => `${n}=${v.value}`).join('; ');
    },
  };
}
module.exports = { createJar };
