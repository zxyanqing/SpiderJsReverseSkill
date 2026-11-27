'use strict';
function compute() {
  return 7;
}

function installHook(fn) {
  return function hooked() {
    const v = fn.apply(this, arguments);
    return v + 1;
  };
}

module.exports = { compute, installHook };
