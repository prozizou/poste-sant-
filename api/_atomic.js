'use strict';
const crypto = require('node:crypto');
const { sumAmounts, loadDomainValues } = require('./_domain-values.js');
const fail = (status, message) => Object.assign(new Error(message), { status });

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function fingerprint(action, body) {
  const { operationId, action: ignored, ...payload } = body;
  return crypto.createHash('sha256').update(canonical({ action, payload })).digest('hex');
}
function balance(state) {
  try {
    const result = sumAmounts(Object.values(state.ticket_dbase || {}), 'prix', true)
      + sumAmounts(Object.values(state.vente_medicaments || {}), 'total', true)
      - sumAmounts(Object.values(state.db_depenses || {}), 'montant');
    if (!Number.isSafeInteger(result)) throw Error('overflow');
    return result;
  } catch { throw fail(409, 'Données financières incohérentes : corriger les montants historiques avant cette opération.'); }
}
function applyUpdates(state, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('/');
    if (parts.some(p => !p || ['__proto__', 'prototype', 'constructor'].includes(p) || /[.#$\[\]]/.test(p))) throw Error('Chemin interne invalide');
    const key = parts.pop();
    let node = state;
    for (const part of parts) node = node[part] ??= {};
    if (value === null) delete node[key]; else node[key] = value;
  }
  return state;
}

// Une seule transaction au niveau du village : vente, stock, lots, journal,
// solde et empreinte d'idempotence sont validés sur le même état, sans bail.
async function atomicOperation(db, action, body, user, role, planner) {
  // Import before entering Firebase's synchronous, retryable callback. Both
  // pharmacy and ticket/expense/stock commands share this entry point.
  await loadDomainValues();
  const id = body.operationId;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw fail(422, 'Identifiant unique de commande invalide.');
  const hash = fingerprint(action, body), now = Date.now();
  const root = db.ref('/');
  // Prime the SDK cache before a synchronous transaction callback. The callback
  // is pure and can run again against a newer server snapshot on contention.
  await root.once('value');
  let result, error;
  const committed = await root.transaction(current => {
    error = null;
    let existing = false;
    try {
      const state = structuredClone(current || {});
      const prior = state.business_operations?.[id];
      if (prior) {
        existing = true;
        if (prior.uid !== user.uid || prior.action !== action || prior.fingerprint !== hash) throw fail(409, 'Cette commande correspond à une autre saisie. Vérifiez l’historique avant de recommencer.');
        result = { ...prior.result, deja: true };
        return; // no write, the operation is already committed
      }
      if (state.pharmacie_operations?.[id]) { existing=true;throw fail(409, 'Ancienne commande sans empreinte : vérifier son résultat dans l’historique.'); }
      let index = 0;
      const context = { now, id, nextKey: () => crypto.createHash('sha256').update(id + ':' + index++).digest('hex').slice(0, 32) };
      const plan = planner(structuredClone(state), action, body, user, role, context);
      if (plan.financial !== false) {
        const before = balance(state);
        const afterState = applyUpdates(structuredClone(state), plan.updates);
        const after = balance(afterState);
        if (after < 0 && after < before) throw fail(409, 'Solde insuffisant : opération refusée, aucune donnée modifiée.');
      }
      applyUpdates(state, plan.updates);
      result = plan.result;
      state.business_operations ??= {};
      state.business_operations[id] = { uid: user.uid, action, fingerprint: hash, result, ts: now };
      return state;
    } catch (e) { e.notCommitted=!existing;error = e; return; }
  }, undefined, false);
  if (error) throw error;
  if (!committed.committed && !result?.deja) throw fail(409, 'Conflit de mise à jour : réessayer la même commande.');
  return result;
}
module.exports = { atomicOperation, fingerprint, balance, applyUpdates, fail };
