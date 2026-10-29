'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8')).rules;
// Evaluate the actual boolean grants at each ancestor. This is a local policy
// check, not a substitute for Firebase Emulator's full validation semantics.
function snapshot(value){return {val:()=>value??null,exists:()=>value!=null,child:p=>snapshot(p.split('/').reduce((v,k)=>v?.[k],value))};}
function allowedWrite(target,auth,data){
 const segments=target.split('/');let node=rules;const bindings={auth,root:snapshot(data),now:Date.now(),newData:snapshot('new value'),data:snapshot(null)};
 const granted=()=>{
  const rule=node?.['.write'];
  if(typeof rule==='boolean')return rule;
  if(typeof rule!=='string')return false;
  return !!new Function(...Object.keys(bindings),'return ('+rule+');')(...Object.values(bindings));
 };
 if(granted())return true;
 for(const segment of segments){
  if(!node)return false;
  const wildcard=Object.keys(node).find(k=>k.startsWith('$'));
  if(Object.hasOwn(node,segment))node=node[segment];
  else if(wildcard){bindings[wildcard]=segment;node=node[wildcard];}
  else return false;
  if(granted())return true;
 }
 return false;
}
function state(role='admin'){
 return {db_users:{user:{role,active:true,village_id:'alpha'}},villages_registry:{alpha:{active:true,expires_ts:Date.now()+86400000},beta:{active:true}},villages:{alpha:{db_pharmacie_stock:{med1:{quantite:5}}},beta:{db_pharmacie_stock:{med1:{quantite:5}}}}};
}
test('Les règles interdisent les mutations financières directes, même à un administrateur',()=>{
 for(const role of ['admin','caissier','tresorier','icp']){
  const db=state(role),auth={uid:'user',token:{email:'agent@example.test'}};
  for(const p of ['ticket_dbase/x','db_depenses/x','vente_medicaments/x','compteurs/attente_2026-10-29','db_pharmacie_stock/med1','db_pharmacie_stock/med1/quantite','db_pharmacie_stock/med1/prix_unitaire','db_pharmacie_stock/med1/lots/lot1','db_pharmacie_reappro/x','business_operations/x','business_audit/x'])
   assert.equal(allowedWrite('villages/alpha/'+p,auth,db),false,role+':'+p);
 }
});
test('Les images restent modifiables uniquement par un administrateur actif de son village',()=>{
 const auth={uid:'user',token:{email:'agent@example.test'}},db=state();
 assert.equal(allowedWrite('villages/alpha/db_pharmacie_stock/med1/image_url',auth,db),true);
 assert.equal(allowedWrite('villages/beta/db_pharmacie_stock/med1/image_url',auth,db),false);
 assert.equal(allowedWrite('villages/alpha/db_pharmacie_stock/absent/image_url',auth,db),false);
 assert.equal(allowedWrite('villages/alpha/db_pharmacie_stock/med1/image_url',null,db),false);
 for(const kind of ['staff','suspended','expired','disabled']){
  const altered=state(kind==='staff'?'caissier':'admin');
  if(kind==='suspended')altered.villages_registry.alpha.active=false;
  if(kind==='expired')altered.villages_registry.alpha.expires_ts=1;
  if(kind==='disabled')altered.db_users.user.active=false;
  assert.equal(allowedWrite('villages/alpha/db_pharmacie_stock/med1/image_url',auth,altered),false,kind);
 }
});

test('Les écrans métier ne conservent pas de chemin d’écriture directe de caisse ou de stock',()=>{
 for(const file of ['facturation/script.js','annulation/annulation.html','approvisionnement/stock.html','planif_rapport/rapports.html','planif_rapport/depenses.html']){
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.doesNotMatch(source,/\b(?:push|set|update|remove|runTransaction)\((?:ticketRef|depenseRef|compteurRef)/,file);
  assert.doesNotMatch(source,/\b(?:push|set|update|remove|runTransaction)\(villageRef\(db,\s*['"`](?:ticket_dbase|db_depenses|compteurs|db_pharmacie_reappro)/,file);
 }
});
