'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const {cheminVillage, scopedDatabase, identifierVillage} = require('../api/_village.js');

function dbMock(users, registry) {
  const accesses=[];
  return {
    accesses,
    ref(p) {
      accesses.push(p);
      return {
        path:p,
        once: async () => ({ val:()=> {
          if(p.startsWith('db_users/')) return users[p.slice('db_users/'.length)] || null;
          if(p.startsWith('villages_registry/')) return registry[p.slice('villages_registry/'.length)] || null;
          return null;
        }})
      };
    }
  };
}
test('Chaque opération est scoped par village (stock, ventes, verrous, idempotence)', () => {
  const db=dbMock({},{});
  const a=scopedDatabase(db,'diandioly');
  const b=scopedDatabase(db,'keur-moussa');
  for(const p of ['db_pharmacie_stock/med1','vente_medicaments','system_locks/pharmacie','pharmacie_operations/op','/']) {
    const pa=a.ref(p).path, pb=b.ref(p).path;
    assert.equal(pa,'villages/diandioly'+(p==='/'?'':'/'+p));
    assert.equal(pb,'villages/keur-moussa'+(p==='/'?'':'/'+p));
    assert.notEqual(pa,pb);
  }
});
test('Un village ID malformé ne peut pas atteindre la racine', () => {
  for(const bad of ['/','../administration','a/b','Bad Village','', 'x..y','__admin__'])
    assert.throws(()=>cheminVillage(bad,'db_pharmacie_stock'));
  assert.throws(()=>cheminVillage('diandioly','../../db_users'));
});
test('La requête d’un compte ne peut choisir le village d’un autre compte',async()=>{
  const db=dbMock({u1:{role:'caissier',village_id:'diandioly'},u2:{role:'admin',village_id:'keur-moussa'}},
    {diandioly:{active:true,nom:'Diandioly'},'keur-moussa':{active:true,nom:'Keur Moussa'}});
  const u1=await identifierVillage(db,{uid:'u1'},['admin','caissier']);
  const u2=await identifierVillage(db,{uid:'u2'},['admin']);
  assert.equal(u1.db.ref('ticket_dbase').path,'villages/diandioly/ticket_dbase');
  assert.equal(u2.db.ref('ticket_dbase').path,'villages/keur-moussa/ticket_dbase');
  await assert.rejects(identifierVillage(db,{uid:'u1'},['admin']),e=>e.status===403);
});
test('Village désactivé ou utilisateur sans affectation = accès refusé',async()=>{
  const db=dbMock({u1:{role:'admin',village_id:'diandioly'},u2:{role:'admin'}}, {diandioly:{active:false}});
  await assert.rejects(identifierVillage(db,{uid:'u1'},['admin']),e=>e.status===403);
  await assert.rejects(identifierVillage(db,{uid:'u2'},['admin']),e=>e.status===403);
});

test('Une identité anonyme est refusée même si une affectation a été créée par erreur',async()=>{
 const db=dbMock({u1:{role:'admin',village_id:'diandioly'}},{diandioly:{active:true}});
 await assert.rejects(identifierVillage(db,{uid:'u1',firebase:{sign_in_provider:'anonymous'}}),e=>e.status===403);
});
test('Les règles n’autorisent jamais une lecture des données d’un village différent',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8')).rules;
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(rules.db_users.$uid['.write'],false);
  assert.equal(rules.villages_registry.$villageId['.write'],false);
  const village=rules.villages.$villageId;
  for(const node of ['ticket_dbase','vente_medicaments','db_pharmacie_stock','db_depenses','notifications_caisse','gallery']) {
    assert.match(village[node]['.read'],/village_id.*=== \$villageId/);
    assert.match(village[node]['.read'],/active/);
  }
  function check(node){
    if(!node||typeof node!=='object')return;
    for(const [k,v] of Object.entries(node)) {
      if(k==='.write' && typeof v==='string' && v!=='false')assert.match(v,/village_id.*=== \$villageId/);
      else if(typeof v==='object')check(v);
    }
  }
  check(village);
  assert.equal(village.vente_medicaments['.write'],false);
  assert.equal(village.pharmacie_operations['.write'],false);
  assert.equal(village.system_locks['.write'],false);
});
test('Aucun module client ne lit plus les anciennes collections racine',()=>{
  const paths=[...['accueil/menu_admin.html','accueil/menu_caissier.html','accueil/menu_tresorier.html','accueil/menu_icp.html','annulation/annulation.html','approvisionnement/stock.html','planif_rapport/depenses.html','planif_rapport/rapports.html','facturation/script.js','notifications-admin.js']];
  for(const p of paths){
    const text=fs.readFileSync(path.join(root,p),'utf8');
    assert.ok(text.includes('villageRef(db,'),p);
    assert.ok(!/\bref\(db,\s*['"`]((ticket_dbase)|(vente_medicaments)|(db_pharmacie_stock)|(db_depenses)|(notifications_caisse)|(gallery))/.test(text),p);
  }
});
