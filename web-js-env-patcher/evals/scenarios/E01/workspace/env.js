'use strict';
function installEnv(globalObj) {
  Object.defineProperty(globalObj.navigator, 'platform', {
    value: 'MacIntel',
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
module.exports = { installEnv };
