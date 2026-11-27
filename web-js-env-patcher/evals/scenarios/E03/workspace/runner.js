'use strict';
function runJob() {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ value: 42 }), 20);
  });
}

async function runAndReport() {
  const p = runJob();
  return { done: true, result: null, pending: p };
}

module.exports = { runJob, runAndReport };
