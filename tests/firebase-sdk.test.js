'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('Les API démarrent et encaissent sans require(ESM), comme le chargeur Vercel', () => {
  execFileSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const assert = require('node:assert/strict');
    const {randomUUID} = require('node:crypto');
    const memory = require('./tests/helpers/memory-db.cjs');
    const handler = require('./api/business-operations.js');
    const {executeBusiness} = require('./api/_business.js');
    const {execute} = require('./api/pharmacie-operations.js')._testing;
    (async () => {
      const res = {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
      await handler({method:'POST',headers:{},body:{}}, res);
      assert.equal(res.code,401);
      const store = memory({db_pharmacie_stock:{'med-001':{nom:'Produit test',quantite:5,prix_unitaire:200,date_peremption:'2099-12-31'}}});
      const user={uid:'test',email:'test@example.test'};
      const command={operationId:randomUUID(),prenom:'Patient',nom:'Test',age:15,choix:'CPN – Consultation Prénatale',argent_remis:1000};
      const first=await executeBusiness(store.db,'ticket_creer',command,user,'caissier');
      assert.equal(first.ticket.prix,700);
      assert.equal(first.ticket.monnaie_rendue,300);
      assert.equal((await executeBusiness(store.db,'ticket_creer',command,user,'caissier')).deja,true);
      const sale=await execute(store.db,'encaisser',{operationId:randomUUID(),patient_nom:'Patient test',medicaments:[{stock_key:'med-001',qte:1,prix:200}],argent_remis:500,date_heure_ts:Date.now()},user,'caissier');
      assert.equal(sale.ok,true);
      assert.equal(store.state().db_pharmacie_stock['med-001'].quantite,4);
      assert.equal(Object.keys(store.state().ticket_dbase).length,1);
    })().catch(e=>{console.error(e);process.exitCode=1;});
  `], {cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
});

test('Le SDK installé initialise les interfaces Auth/RTDB/FCM utilisées par les API', async () => {
  // Clé éphémère de test, aucun compte réel et aucun appel aux services Google.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const app = initializeApp({
    credential: cert({ projectId: 'audit-local', clientEmail: 'test@audit-local.iam.gserviceaccount.com', privateKey }),
    databaseURL: 'https://audit-local.firebaseio.com',
  }, 'sdk-compatibility');
  try {
    assert.equal(typeof getDatabase(app).ref('test').transaction, 'function');
    assert.equal(typeof getMessaging(app).sendEach, 'function');
    await assert.rejects(getAuth(app).verifyIdToken('invalid-token'), e => e.code === 'auth/argument-error');
  } finally { await deleteApp(app); }
});
