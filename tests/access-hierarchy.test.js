'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {identity,mayManage,OWNER_EMAIL}=require('../api/_access.js');
const {assignAccount,changeStaff,perform,listing}=require('../api/access-management.js').__test;
const root=path.join(__dirname,'..');
function mk(users={},registry={diandioly:{nom:'Diandioly',active:true},'keur-moussa':{nom:'Keur Moussa',active:true}},superadmins={}){
const state={db_users:structuredClone(users),villages_registry:structuredClone(registry),superadmins:structuredClone(superadmins),villages:{}};
const byPath=(p)=>p.split('/').filter(Boolean);
const locate=(p)=>byPath(p).reduce((o,k)=>o&&o[k],state);
const set=(p,value)=>{const ss=byPath(p);let cur=state;while(ss.length>1){let k=ss.shift();cur=cur[k]??(cur[k]={})}cur[ss[0]]=value};
return {state,ref:(p)=>({path:p,set:async v=>{set(p,v)},once:async()=>({val:()=>locate(p),exists:()=>!!locate(p)}),transaction:async fn=>{const result=fn(locate(p)??null);if(result===undefined)return {committed:false};set(p,result);return {committed:true}}})};}
const user=(uid,email='staff@example.test')=>({uid,email});
test('Superadmin: compte UID inscrit et email exact seulement',async()=>{
 const db=mk({boss:{role:'superadmin',active:true}},{diandioly:{active:true}},{boss:{active:true,email:OWNER_EMAIL}});
 assert.equal((await identity(db,user('boss',OWNER_EMAIL))).global,true);
 await assert.rejects(identity(db,user('boss','fraud@example.test')),/globaux|confirmé/i);
 await assert.rejects(identity(db,user('attacker',OWNER_EMAIL)),/Compte suspendu/);
 db.state.db_users.boss.active=false;
 await assert.rejects(identity(db,user('boss',OWNER_EMAIL)),/suspendu/);
});
test('Rôles: administrateur local ne peut nommer un administrateur ni agir dans un autre village',()=>{
 const local={global:false,role:'admin',villageId:'diandioly'};
 assert.doesNotThrow(()=>mayManage(local,'caissier','diandioly'));
 assert.throws(()=>mayManage(local,'admin','diandioly'),/équipe/);
 assert.throws(()=>mayManage(local,'caissier','keur-moussa'),/équipe/);
 assert.throws(()=>mayManage({...local,role:'caissier'},'tresorier','diandioly'),/équipe/);
 assert.doesNotThrow(()=>mayManage({global:true},'admin','keur-moussa'));
 assert.throws(()=>mayManage({global:true},'icp','keur-moussa'),/gère/);
});
test('API: impossible de muter un utilisateur d’un autre village ou rôle admin local',async()=>{
 const db=mk({local:{role:'admin',active:true,village_id:'diandioly'},foreign:{role:'caissier',active:true,village_id:'keur-moussa'},protected:{role:'admin',active:true,village_id:'diandioly'},agent:{role:'caissier',active:true,village_id:'diandioly'}});
 const actor=await identity(db,user('local'));
 await assert.rejects(changeStaff(db,actor,{uid:'foreign-aaaaaaaa',mode:'revoke'}),/équipe|Accès/);
 // UID validation => local check, then foreign real UID path rejected by transaction.
 await assert.rejects(changeStaff(db,actor,{uid:'foreign'.padEnd(18,'_'),mode:'revoke'}),/équipe/);
 await assert.rejects(changeStaff(db,actor,{uid:'protected'.padEnd(18,'_'),mode:'revoke'}),/équipe/);
 assert.equal(db.state.db_users.foreign.active,true);
});
test('API création village réservée au superadmin et refuse tout écrasement',async()=>{
 const db=mk({owner:{role:'superadmin',active:true},admin:{role:'admin',active:true,village_id:'diandioly'}},undefined,{owner:{active:true,email:OWNER_EMAIL}});
 const superActor=await identity(db,user('owner',OWNER_EMAIL));
 const local=await identity(db,user('admin'));
 await assert.rejects(perform(db,{},local,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau',duree:'1a'}),/Accès/);
 const result=await perform(db,{},superActor,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau',duree:'1a'});
 assert.equal(result.villageId,'new-post');
 await assert.rejects(perform(db,{},superActor,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau',duree:'1a'}),/existant/);
 assert.equal(db.state.villages_registry['new-post'].active,true);
});
test('Création de village : accès jusqu’au 18 (abonnement), prolongation API conservée',async()=>{
 const db=mk({owner:{role:'superadmin',active:true}},{},{owner:{active:true,email:OWNER_EMAIL}});
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 const {echeanceInitiale}=require('../api/access-management.js').__test;
 const r=await perform(db,{},owner,{action:'createVillage',villageId:'keur-moussa',nom:'Keur Moussa'});
 assert.ok(r.expires_ts>Date.now());
 assert.equal(new Date(r.expires_ts).getUTCDate(),19);
 // Créé le 5 : accès jusqu'au 18 du mois ; créé le 25 : jusqu'au 18 du mois suivant.
 assert.equal(new Date(echeanceInitiale(Date.UTC(2026,10,5))).toISOString(),'2026-11-19T00:00:00.000Z');
 assert.equal(new Date(echeanceInitiale(Date.UTC(2026,11,25))).toISOString(),'2027-01-19T00:00:00.000Z');
 const reg=db.state.villages_registry['keur-moussa'];
 assert.equal(reg.duree,'abonnement');
 const avant=reg.expires_ts;
 const r2=await perform(db,{},owner,{action:'renewVillage',villageId:'keur-moussa',duree:'1a'});
 assert.ok(r2.expires_ts>avant);
 await assert.rejects(perform(db,{},owner,{action:'renewVillage',villageId:'inconnu',duree:'1m'}),/introuvable/);
 // Date précise : future acceptée, passée refusée.
 await assert.rejects(perform(db,{},owner,{action:'renewVillage',villageId:'keur-moussa',date:'2000-01-01'}),/futur/);
 const r3=await perform(db,{},owner,{action:'renewVillage',villageId:'keur-moussa',date:'2030-06-15'});
 assert.equal(new Date(r3.expires_ts).getFullYear(),2030);
 assert.equal(db.state.villages_registry['keur-moussa'].duree,'perso');
});
test('Accès du village expiré : le personnel est bloqué, le super administrateur non',async()=>{
 const passe=Date.now()-86400000;
 const db=mk({owner:{role:'superadmin',active:true},cash:{role:'caissier',active:true,village_id:'diandioly'}},
   {diandioly:{nom:'Diandioly',active:true,expires_ts:passe}},{owner:{active:true,email:OWNER_EMAIL}});
 await assert.rejects(identity(db,user('cash')),/expiré/i);
 assert.equal((await identity(db,user('owner',OWNER_EMAIL))).global,true);
 // Après prolongation, l'accès est rétabli.
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 await perform(db,{},owner,{action:'renewVillage',villageId:'diandioly',duree:'6m'});
 assert.equal((await identity(db,user('cash'))).role,'caissier');
});
test('API: désactivation du village, lecture limitée aux admins',async()=>{
 const db=mk({owner:{role:'superadmin',active:true},admin:{role:'admin',active:true,village_id:'diandioly'},cash:{role:'caissier',active:true,village_id:'diandioly'}},undefined,{owner:{active:true,email:OWNER_EMAIL}});
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 const admin=await identity(db,user('admin'));
 const cashier=await identity(db,user('cash'));
 await assert.rejects(listing(db,{},cashier,'team'),/Accès/);
 await assert.rejects(perform(db,{},admin,{action:'deactivateVillage',villageId:'diandioly',motif:'Impayé'}),/Accès/);
 await assert.rejects(perform(db,{},owner,{action:'deactivateVillage',villageId:'diandioly'}),/motif/i);
 const revoked=[];
 await perform(db,{revokeRefreshTokens:async u=>{revoked.push(u)}},owner,{action:'deactivateVillage',villageId:'diandioly',motif:'Impayé'});
 assert.equal(db.state.villages_registry.diandioly.suspension.motif,'Impayé');
 assert.deepEqual(revoked.sort(),['admin','cash']);
 await assert.rejects(identity(db,user('cash')),/Village inactif/);
 await perform(db,{},owner,{action:'activateVillage',villageId:'diandioly'});
 assert.equal(db.state.villages_registry.diandioly.suspension,undefined);
 assert.equal((await identity(db,user('cash'))).role,'caissier');
});
test('Les règles RTDB bloquent les mutations des rôles et les comptes suspendus',()=>{
 const r=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8')).rules;
 assert.equal(r.db_users.$uid['.write'],false);assert.equal(r.superadmins.$uid['.write'],false);
 assert.equal(r.villages_registry.$villageId['.write'],false);
 assert.equal(r.villages.$villageId.ticket_dbase['.write'],false);
 assert.equal(r.villages.$villageId.db_depenses['.write'],false);
 assert.equal(r.villages.$villageId.db_pharmacie_stock.$id['.write'],false);
 assert.match(r.villages.$villageId.db_pharmacie_stock['.read'],/active.*!== false/);
 assert.doesNotMatch(r.villages.$villageId.db_pharmacie_stock['.read'],/superadmins/); // management ≠ clinical data
});
test('Interface superadmin et gestion équipe: écrans présents',()=>{
 for(const page of ['accueil/menu_superadmin.html','accueil/equipe.html']) assert.ok(fs.existsSync(path.join(root,page)));
 const main=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(main,/superadmin:\s*'accueil\/menu_superadmin.html'/);
 assert.doesNotMatch(main,/password-alternative/);
});

test('Attribution sécurisée: création du compte par e-mail et interdiction de transférer entre villages',async()=>{
 const local={uid:'local',role:'admin',villageId:'diandioly',global:false};
 const db=mk({local:{role:'admin',village_id:'diandioly'}});
 const table={};
 const fakeAuth={
  async getUserByEmail(email){if(!table[email])throw Object.assign(new Error('Unknown'),{code:'auth/user-not-found'});return table[email]},
  async createUser(obj){const rec={uid:'new_staff_account_00001',email:obj.email,disabled:false};table[obj.email]=rec;return rec},
  async updateUser(){throw Error('Not expected')}
 };
 const result=await assignAccount(db,fakeAuth,local,{email:'new@example.test',role:'caissier',villageId:'diandioly'});
 assert.equal(result.created,true);
 assert.equal(db.state.db_users[result.uid].active,true);
 assert.equal(db.state.db_users[result.uid].role,'caissier');
 await assert.rejects(assignAccount(db,fakeAuth,{...local,villageId:'keur-moussa'},{email:'new@example.test',role:'caissier',villageId:'keur-moussa'}),/Conflit|appartient/);
 await assert.rejects(assignAccount(db,fakeAuth,local,{email:'new@example.test',role:'admin',villageId:'diandioly'}),/équipe/);
});

test('Changement de rôle : une promotion concurrente ne peut être écrasée', async () => {
 const actor={uid:'admin',role:'admin',villageId:'diandioly',global:false};
 let state={role:'caissier',active:true,village_id:'diandioly'};
 const db={ref:()=>({async transaction(fn){
  assert.equal(fn(state).active,false);
  // Firebase retries after another writer promotes this account.
  state={...state,role:'admin'};
  const result=fn(state);
  assert.equal(result,undefined);
  return {committed:false};
 }})};
 await assert.rejects(changeStaff(db,actor,{uid:'agent',mode:'revoke'}),e=>e.status===403);
 assert.equal(state.role,'admin');
 assert.equal(state.active,true);
});

test('Les UID courts valides peuvent être gérés, les chemins Firebase sont refusés', async () => {
 const actor={uid:'admin',role:'admin',villageId:'diandioly',global:false};
 const db=mk({agent:{role:'caissier',active:true,village_id:'diandioly'}});
 await changeStaff(db,actor,{uid:'agent',mode:'revoke'});
 assert.equal(db.state.db_users.agent.active,false);
 const result=await changeStaff(db,actor,{uid:'agent',mode:'reactivate'});
 assert.equal(result.active,true);
 for(const uid of ['a/b','a.b','a#b','a$b','a[b]','a\u0000b'])
  await assert.rejects(changeStaff(db,actor,{uid,mode:'revoke'}),e=>e.status===403);
 await assert.rejects(changeStaff(db,actor,{uid:'agent',mode:'unknown'}),e=>e.status===422);
});

test('Une date civile impossible ne prolonge pas un village', async () => {
 const db=mk();
 await assert.rejects(perform(db,{}, {global:true,uid:'owner'}, {action:'renewVillage',villageId:'diandioly',date:'2030-02-30'}),e=>e.status===422);
 assert.equal(db.state.villages_registry.diandioly.expires_ts,undefined);
});

test('Une prolongation concurrente conserve la suspension du village', async () => {
 let state={nom:'Village',active:true,expires_ts:Date.now()+86400000};
 const db={ref:()=>({async transaction(fn){
  fn(state);
  state={...state,active:false,suspension:{motif:'Contrôle nécessaire'}};
  state=fn(state);
  return {committed:true};
 }})};
 await perform(db,{}, {global:true,uid:'owner'}, {action:'renewVillage',villageId:'diandioly',duree:'1m'});
 assert.equal(state.active,false);
 assert.equal(state.suspension.motif,'Contrôle nécessaire');
});
test('Abonnement Wave : visibilité du 10 au 18, validation true/false par le superadmin, coupure automatique après le 18',async(t)=>{
 const {ABONNEMENT,moisCourant}=require('../api/access-management.js').__test;
 const db=mk({owner:{role:'superadmin',active:true},admin:{role:'admin',active:true,village_id:'diandioly'},cash:{role:'caissier',active:true,village_id:'diandioly'}},
   {diandioly:{nom:'Diandioly',active:true},'keur-moussa':{nom:'Keur Moussa',active:true}},{owner:{active:true,email:OWNER_EMAIL}});
 db.state.db_users.owner.role='superadmin';
 const authMock={revokeRefreshTokens:async()=>{}};
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 const admin=await identity(db,user('admin'));
 const cash=await identity(db,user('cash'));
 const mois=moisCourant();
 assert.equal(ABONNEMENT.montant,22000);
 assert.match(ABONNEMENT.wave_url,/^https:\/\/pay\.wave\.com\/.*amount=22000$/);
 // Plus de déclaration côté admin : seul le superadmin valide true/false.
 await assert.rejects(perform(db,authMock,admin,{action:'declareSubscription'}),/non reconnue/);
 let vue=await listing(db,authMock,admin,'abonnement');
 assert.equal(vue.abonnement.paye,null);
 await assert.rejects(perform(db,authMock,admin,{action:'setSubscription',villageId:'diandioly',mois,paye:true}),/Accès/);
 await assert.rejects(perform(db,authMock,owner,{action:'setSubscription',villageId:'diandioly',mois,paye:'oui'}),/true/);
 await perform(db,authMock,owner,{action:'setSubscription',villageId:'diandioly',mois,paye:true});
 vue=await listing(db,authMock,admin,'abonnement');
 assert.equal(vue.abonnement.paye,true);
 // Carte visible uniquement du 10 au 18 du mois.
 const {carteVisible}=require('../api/access-management.js').__test;
 assert.equal(carteVisible(Date.parse(mois+'-09T23:00:00Z')),false);
 assert.equal(carteVisible(Date.parse(mois+'-10T00:00:00Z')),true);
 assert.equal(carteVisible(Date.parse(mois+'-18T23:59:00Z')),true);
 assert.equal(carteVisible(Date.parse(mois+'-19T00:00:00Z')),false);
 // Payé en novembre : accès jusqu'au 18 du mois suivant (coupure le 19 à 0 h).
 const {echeance}=require('../api/access-management.js').__test;
 assert.equal(db.state.villages_registry.diandioly.expires_ts,echeance(mois,1));
 assert.equal(new Date(echeance('2026-11',1)).toISOString(),'2026-12-19T00:00:00.000Z');
 assert.equal(new Date(echeance('2026-12',1)).toISOString(),'2027-01-19T00:00:00.000Z');
 assert.equal((await identity(db,user('cash'))).role,'caissier');
 // Coupure AUTOMATIQUE : sans paiement, l'accès tombe le 19 à 0 h, sans action du superadmin.
 t.mock.timers.enable({apis:['Date'],now:Date.parse(mois+'-18T20:00:00Z')});
 db.state.villages_registry['keur-moussa'].expires_ts=echeance(mois,0);
 db.state.db_users.km={role:'caissier',active:true,village_id:'keur-moussa'};
 assert.equal((await identity(db,user('km'))).role,'caissier');
 t.mock.timers.setTime(Date.parse(mois+'-19T00:00:01Z'));
 await assert.rejects(identity(db,user('km')),/expiré/i);
 await assert.rejects(perform(db,authMock,owner,{action:'cutUnpaidSubscriptions'}),/non reconnue/);
 // « Oui, payé » rétablit l'accès immédiatement.
 const rv=await perform(db,authMock,owner,{action:'setSubscription',villageId:'keur-moussa',mois,paye:true});
 assert.equal(rv.reactive,true);
 assert.equal((await identity(db,user('km'))).role,'caissier');
 // « Non, impayé » après le 18 : échéance ramenée au 19 du mois → accès coupé tout de suite.
 const rf=await perform(db,authMock,owner,{action:'setSubscription',villageId:'diandioly',mois,paye:false});
 assert.equal(rf.suspendu,true);
 await assert.rejects(identity(db,user('cash')),/expiré/i);
 t.mock.timers.reset();
});
test('Transactions : un premier appel avec cache vide (null) ne donne plus « Village introuvable »',async()=>{
 const db=mk({owner:{role:'superadmin',active:true},admin:{role:'admin',active:true,village_id:'diandioly'},cash:{role:'caissier',active:true,village_id:'diandioly'}},
   {diandioly:{nom:'Diandioly',active:true}},{owner:{active:true,email:OWNER_EMAIL}});
 // Comme le SDK Firebase : 1er appel avec le cache local (null) ; abandon si undefined,
 // sinon le serveur refuse (valeur différente) et relance avec la vraie valeur.
 const ref0=db.ref;
 db.ref=p=>{const r=ref0(p);const tx=r.transaction;return {...r,transaction:async fn=>{
  const reel=p.split('/').filter(Boolean).reduce((o,k)=>o&&o[k],db.state)??null;
  const premier=fn(null);
  if(premier===undefined) return {committed:false};
  if(reel===null) return tx(fn);
  return tx(fn);
 }};};
 const authMock={revokeRefreshTokens:async()=>{}};
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 const admin=await identity(db,user('admin'));
 const {moisCourant}=require('../api/access-management.js').__test;
 const r=await perform(db,authMock,owner,{action:'setSubscription',villageId:'diandioly',mois:moisCourant(),paye:true});
 assert.equal(r.paye,true);
 assert.equal(db.state.villages_registry.diandioly.abonnements[moisCourant()].paye,true);
 await perform(db,authMock,owner,{action:'renewVillage',villageId:'diandioly',duree:'1m'});
 assert.ok(db.state.villages_registry.diandioly.expires_ts>Date.now());
 await perform(db,authMock,owner,{action:'deactivateVillage',villageId:'diandioly',motif:'Test coupure'});
 assert.equal(db.state.villages_registry.diandioly.active,false);
 await perform(db,authMock,owner,{action:'activateVillage',villageId:'diandioly'});
 assert.equal(db.state.villages_registry.diandioly.active,true);
 await perform(db,authMock,admin,{action:'revokeStaff',uid:'cash'});
 assert.equal(db.state.db_users.cash.active,false);
 await assert.rejects(perform(db,authMock,owner,{action:'setSubscription',villageId:'inconnu',mois:moisCourant(),paye:true}),/introuvable/);
});
