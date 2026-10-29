'use strict';

// Load the shared browser/server ES module at an asynchronous boundary. Vercel's
// CommonJS loader does not support require(ESM), even on some Node 24 runtimes.
let values;
async function loadDomainValues() {
  values = await import('../domain-values.mjs');
  return values;
}
function call(name, args) {
  if (!values) throw new Error('Domain values must be loaded before a synchronous transaction callback.');
  return values[name](...args);
}
module.exports = {
  loadDomainValues,
  amount: (...args) => call('amount', args),
  civilDate: (...args) => call('civilDate', args),
  recordTimestamp: (...args) => call('recordTimestamp', args),
  sumAmounts: (...args) => call('sumAmounts', args),
};
