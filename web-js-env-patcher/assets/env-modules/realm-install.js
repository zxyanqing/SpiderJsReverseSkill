'use strict';
// Host-only registry: never attach a host bridge to a target-visible object.
const realms = new WeakMap();
function registerRealm(scope, installer) { realms.set(scope, installer); }
function unregisterRealm(scope) { realms.delete(scope); }
function installInRealm(scope, moduleName, fixture, options) {
  const installer = realms.get(scope);
  return installer ? { handled: true, value: installer(moduleName, fixture, options) } : { handled: false };
}
module.exports = { registerRealm, unregisterRealm, installInRealm };
