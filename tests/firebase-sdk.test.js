'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

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
