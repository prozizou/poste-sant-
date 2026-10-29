'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const origin = 'https://poste.example';

function worker() {
  const listeners = {}, stores = new Map(), reads = [], writes = [];
  let online = true;
  let cacheControl = '';
  const key = request => typeof request === 'string' ? new URL(request, origin).href : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { reads.push(key(request)); return store.get(key(request))?.clone(); },
        async put(request, response) { writes.push(key(request)); store.set(key(request), response.clone()); },
      };
    },
    async match(request) {
      reads.push(key(request));
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone();
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  vm.runInNewContext(source, {
    self: { location: { origin }, addEventListener: (name, fn) => { listeners[name] = fn; }, clients: { claim() {} } },
    caches, URL, Response, console: { log() {}, warn() {} },
    importScripts() { throw new Error('FCM désactivé pour ce test'); },
    fetch: async () => {
      if (!online) throw new Error('offline');
      return new Response('network', { headers: { 'Cache-Control': cacheControl } });
    },
  });
  return {
    caches, stores, reads, writes,
    offline() { online = false; },
    privateResponse() { cacheControl = 'private, no-store'; },
    async request(route, headers = {}) {
      const pending = [];
      let response;
      listeners.fetch({ request: new Request(origin + route, { headers }), respondWith(p) { response = p; }, waitUntil(p) { pending.push(p); } });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
    async activate() { let pending; listeners.activate({ waitUntil(p) { pending = p; } }); await pending; },
  };
}

test('Une API hors ligne ne relit jamais une réponse privée anciennement cachée', async () => {
  const w = worker();
  await (await w.caches.open('ps-diandioly-dynamic-ancienne')).put(origin + '/api/access-management?scope=overview', new Response('données privées'));
  w.reads.length = 0; w.writes.length = 0;
  w.offline();
  await assert.rejects(w.request('/api/access-management?scope=overview'), /offline/);
  assert.deepEqual(w.reads, []);
  assert.deepEqual(w.writes, []);
});

test('Les requêtes authentifiées et les ressources inconnues ne sont pas mises en cache', async () => {
  const w = worker();
  await w.request('/index.html', { Authorization: 'Bearer test' });
  await w.request('/api/image-medoc');
  await w.request('/export-confidentiel.json');
  assert.deepEqual(w.writes, []);
});

test('Une ressource publique connue reste disponible hors ligne', async () => {
  const w = worker();
  assert.equal(await (await w.request('/record-actions.js')).text(), 'network');
  assert.equal(w.writes.length, 1);
  w.offline();
  assert.equal(await (await w.request('/record-actions.js')).text(), 'network');
});

test('Le serveur peut interdire le cache même pour une ressource connue', async () => {
  const w = worker(); w.privateResponse();
  await w.request('/index.html');
  assert.deepEqual(w.writes, []);
});

test('Activation : les anciens caches dynamiques contenant des données privées sont supprimés', async () => {
  const w = worker();
  await w.caches.open('ps-diandioly-dynamic-ancienne');
  await w.caches.open('autre-application');
  await w.activate();
  assert.equal(w.stores.has('ps-diandioly-dynamic-ancienne'), false);
  assert.equal(w.stores.has('autre-application'), true);
});

test('Google Fonts utilise effectivement son cache spécifique', async () => {
  const listeners = {};
  let opened;
  vm.runInNewContext(source, {
    self: { location: { origin }, addEventListener: (n, f) => { listeners[n] = f; } },
    importScripts() { throw Error('disabled'); }, console: { warn() {} }, URL,
    caches: { async open(name) { opened = name; return { async match() { return new Response('cached-font'); } }; } },
    fetch() { throw Error('fonts devraient utiliser le cache'); },
  });
  let result;
  listeners.fetch({ request: new Request('https://fonts.googleapis.com/css2?family=Test'), respondWith(p) { result = p; } });
  assert.equal(await (await result).text(), 'cached-font');
  assert.match(opened, /fonts/);
});
