'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
// Chargement des fonctions pures sans Firebase en production ni connexion réseau.
const originalLoad = Module._load;
Module._load = function(id, parent, isMain) {
  if (id === 'firebase-admin/app') return { initializeApp(){}, cert(){}, getApps(){ return []; } };
  if (id === 'firebase-admin/auth') return { getAuth(){} };
  if (id === 'firebase-admin/database') return { getDatabase(){} };
  return originalLoad.apply(this, arguments);
};
const { _testing: logic } = require('../api/pharmacie-operations.js');
Module._load = originalLoad;
const today = new Date().toISOString().slice(0,10);
const tomorrow = '2099-12-31';
const lastYear = '2020-01-01';
const med = (quantite, date = tomorrow) => ({nom:'Antibiotique', quantite, prix_unitaire: 200, date_peremption:date});

test('Refuse les unités négatives, fractionnaires et nulles', () => {
  for (const qty of [0,-2,1.5,Infinity,NaN])
    assert.throws(() => logic.positiveInteger(qty,'Quantité'));
  assert.equal(logic.positiveInteger(1,'Quantité'),1);
});
test('Refuse les doublons de médicament dans la commande', () => {
  assert.throws(() => logic.getRows([
    {stock_key:'med-001',qte:1},{stock_key:'med-001',qte:1}
  ]));
});
test('Une quantité supérieure au stock bloque sans créer de mise à jour', () => {
  const updates = {};
  assert.throws(() => logic.applyStockDeltas({'med-001':med(2)},new Map([['med-001',-3]]),updates),/Stock insuffisant/);
  assert.deepEqual(updates,{});
});
test('Un produit périmé bloque la délivrance', () => {
  assert.throws(() => logic.applyStockDeltas({'med-001':med(5,lastYear)},new Map([['med-001',-1]]),{}),/périmé|Stock délivrable|lot non daté/);
});
test('Un produit sans date bloque la délivrance', () => {
  assert.throws(() => logic.applyStockDeltas({'med-001':med(5,'')},new Map([['med-001',-1]]),{}));
});
test('Un lot périmé encore disponible bloque la délivrance', () => {
  const s=med(10);s.lots={a:{date_peremption:lastYear,qte_recue:5},b:{date_peremption:tomorrow,qte_recue:5}};
  assert.throws(() => logic.qtyFromLots(s),/lot non daté ou périmé/i);
});
test('Lots FEFO: ne compte pas un lot ancien déjà consommé', () => {
  const s=med(5);s.lots={a:{date_peremption:lastYear,qte_recue:5},b:{date_peremption:tomorrow,qte_recue:5}};
  assert.equal(logic.qtyFromLots(s).allowed,5);
});
test('Retour en stock de deux lignes agrégées', () => {
  const old=[{stock_key:'med-001',qte:2},{stock_key:'med-001',qte:3}];
  const deltas=logic.buildStockDeltas(old, []);
  const updates={};
  logic.applyStockDeltas({'med-001':med(0)},deltas,updates);
  assert.equal(updates['db_pharmacie_stock/med-001/quantite'],5);
});
test('Retrait pour restauration impossible si stock insuffisant', () => {
  const updates={};
  assert.throws(() => logic.applyStockDeltas({'med-001':med(0)},new Map([['med-001',-1]]),updates));
  assert.deepEqual(updates,{});
});
test('Interdit les produits archivés', () => {
  const s=med(10);s.archive=true;
  assert.throws(() => logic.applyStockDeltas({'med-001':s},new Map([['med-001',-2]]),{}));
});

test('Les dates de péremption impossibles ou non canoniques bloquent la délivrance', () => {
  for(const date of ['2099-02-30','2099-13-01','zzz','2099-1-01']) {
    assert.throws(()=>logic.applyStockDeltas({'med-001':med(5,date)},new Map([['med-001',-1]]),{}));
    const s=med(5);s.lots={a:{qte_recue:5,date_peremption:date}};
    assert.throws(()=>logic.qtyFromLots(s));
  }
});

test('Des lignes nulles ou primitives renvoient une erreur métier explicite', () => {
  for(const line of [null,1,'medicament',[]])
    assert.throws(()=>logic.getRows([line]),e=>e.status===422);
});
