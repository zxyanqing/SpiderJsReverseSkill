'use strict';
function createRealms() {
  const main = { realmId: 'main', navigator: { platform: 'main-plat' } };
  const child = { realmId: 'child', navigator: { platform: 'child-plat' } };
  return { main, child };
}

function readPlatform(realms, which) {
  const nav = which === 'child' ? realms.child.navigator : realms.main.navigator;
  return {
    realmId: realms.main.realmId,
    platform: nav.platform,
  };
}

module.exports = { createRealms, readPlatform };
