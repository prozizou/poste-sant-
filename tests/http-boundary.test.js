'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readJsonBody, privateResponse } = require('../api/_http.js');
const requestAdmin = require('../api/request-admin.js');

test('JSON : mêmes validations pour texte, Buffer et objet déjà parsé', () => {
  for (const body of ['{"action":"test"}', Buffer.from('{"action":"test"}'), { action: 'test' }])
    assert.deepEqual(readJsonBody({ body }), { action: 'test' });
  for (const body of ['{', 'null', '[]', 'true', null, 2, [], Buffer.from('invalid')])
    assert.throws(() => readJsonBody({ body }), e => e.status === 400);
  for (const body of ['{"x":"longue valeur"}', { x: 'longue valeur' }])
    assert.throws(() => readJsonBody({ body }, 10), e => e.status === 413);
});

test('Les réponses privées interdisent le cache et le sniffing MIME', () => {
  const headers = {};
  privateResponse({ setHeader: (name, value) => { headers[name] = value; } });
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});

test('La demande publique refuse un JSON malformé avant de contacter Firebase', async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; } };
  await requestAdmin({ method: 'POST', body: '{', headers: {} }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('La nouvelle API financière refuse une requête anonyme avant toute initialisation Firebase', async () => {
  const handler=require('../api/business-operations.js');
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}};
  await handler({method:'POST',headers:{},body:{action:'depense_creer'}},res);
  assert.equal(res.code,401);assert.equal(res.headers['Cache-Control'],'no-store');
  await handler({method:'GET',headers:{}},res);assert.equal(res.code,405);
});

function requestsDb(initial = {}) {
  let state = structuredClone(initial);
  let seq = 0;
  const ref = {
    push: () => ({ key: 'request-' + ++seq }),
    async transaction(fn) {
      const result = fn(state);
      if (result === undefined) return { committed: false };
      state = result;
      return { committed: true };
    },
  };
  return { db: { ref: () => ref }, state: () => state };
}
const request = n => ({ prenom: 'Agent', nom: 'Test', village: 'Village', whatsapp: '+22177' + String(n).padStart(7, '0'), status: 'nouveau' });

test('Demande publique : un doublon ne peut pas remplacer l’identité déposée', async () => {
  const original = request(1);
  const store = requestsDb({ existing: original });
  await requestAdmin.__test.submitRequest(store.db, { ...original, prenom: 'Usurpé', whatsapp: original.whatsapp.slice(1) });
  assert.deepEqual(store.state(), { existing: original });
});

test('Demandes concurrentes : le plafond reste respecté et les doublons restent idempotents', async () => {
  const pending = Object.fromEntries(Array.from({ length: 299 }, (_, i) => ['key-' + i, request(i)]));
  const store = requestsDb(pending);
  const result = await Promise.allSettled([
    requestAdmin.__test.submitRequest(store.db, request(300)),
    requestAdmin.__test.submitRequest(store.db, request(301)),
  ]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.status, 429);
  assert.equal(Object.keys(store.state()).length, 300);
  await requestAdmin.__test.submitRequest(store.db, request(0));
  assert.equal(Object.keys(store.state()).length, 300);
});
