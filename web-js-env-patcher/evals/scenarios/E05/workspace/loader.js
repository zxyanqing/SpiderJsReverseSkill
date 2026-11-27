'use strict';
function loadWithImports(required, provided) {
  const resolved = {};
  for (const key of required) {
    if (provided && Object.prototype.hasOwnProperty.call(provided, key)) {
      resolved[key] = provided[key];
    } else {
      resolved[key] = {};
    }
  }
  return { ok: true, imports: resolved };
}
module.exports = { loadWithImports };
