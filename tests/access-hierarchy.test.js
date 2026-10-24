'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {identity,mayManage,OWNER_EMAIL}=require('../api/_access.js');
const {assignAccount,changeAdmin,changeStaff,perform,listing}=require('../api/access-management.js').__test;
const root=path.join(__dirname,'..');
function mk(users={},registry={diandioly:{nom:'Diandioly',active:true},'keur-moussa':{nom:'Keur Moussa',active:true}},superadmins={}){
const state={db_users:structuredClone(users),villages_registry:structuredClone(registry),superadmins:structuredClone(superadmins),villages:{}};
const byPath=(p)=>p.split('/').filter(Boolean);
const locate=(p)=>byPath(p).reduce((o,k)=>o&&o[k],state);
const set=(p,value)=>{const ss=byPath(p);let cur=state;while(ss.length>1){let k=ss.shift();cur=cur[k]??(cur[k]={})}cur[ss[0]]=value};
return {state,ref:(p)=>({path:p,once:async()=>({val:()=>locate(p),exists:()=>!!locate(p)}),transaction:async fn=>{const result=fn(locate(p)??null);if(result===undefined)return {committed:false};set(p,result);return {committed:true}}})};}
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
 await assert.rejects(perform(db,{},local,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau'}),/Accès/);
 const result=await perform(db,{},superActor,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau'});
 assert.equal(result.villageId,'new-post');
 await assert.rejects(perform(db,{},superActor,{action:'createVillage',villageId:'new-post',nom:'Village Nouveau'}),/existant/);
 assert.equal(db.state.villages_registry['new-post'].active,true);
});
test('API: désactivation du village, lecture limitée aux admins',async()=>{
 const db=mk({owner:{role:'superadmin',active:true},admin:{role:'admin',active:true,village_id:'diandioly'},cash:{role:'caissier',active:true,village_id:'diandioly'}},undefined,{owner:{active:true,email:OWNER_EMAIL}});
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 const admin=await identity(db,user('admin'));
 const cashier=await identity(db,user('cash'));
 await assert.rejects(listing(db,{},cashier,'team'),/Accès/);
 await assert.rejects(perform(db,{},admin,{action:'deactivateVillage',villageId:'diandioly'}),/Accès/);
 await perform(db,{},owner,{action:'deactivateVillage',villageId:'diandioly'});
 await assert.rejects(identity(db,user('cash')),/Village inactif/);
});
test('Les règles RTDB bloquent les mutations des rôles et les comptes suspendus',()=>{
 const r=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8')).rules;
 assert.equal(r.db_users.$uid['.write'],false);assert.equal(r.superadmins.$uid['.write'],false);
 assert.equal(r.villages_registry.$villageId['.write'],false);
 assert.match(r.villages.$villageId.ticket_dbase['$id']['.write'],/active.*!== false/);
 assert.match(r.villages.$villageId.db_depenses['.write'],/active.*!== false/);
 assert.doesNotMatch(r.villages.$villageId.db_pharmacie_stock['.read'],/superadmins/); // management ≠ clinical data
});
test('Interface superadmin et gestion équipe: écrans présents',()=>{
 for(const page of ['accueil/menu_superadmin.html','accueil/equipe.html']) assert.ok(fs.existsSync(path.join(root,page)));
 const main=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(main,/superadmin:\s*'accueil\/menu_superadmin.html'/);
 assert.match(main,/password-alternative/);
});

test('Seul le super administrateur peut suspendre un admin, sans toucher aux autres villages',async()=>{
 const uid='admin_local_test_000001';
 const db=mk({owner:{role:'superadmin',active:true},[uid]:{role:'admin',active:true,village_id:'diandioly'}},undefined,{owner:{active:true,email:OWNER_EMAIL}});
 const owner=await identity(db,user('owner',OWNER_EMAIL));
 await assert.rejects(changeAdmin(db,owner,{uid,villageId:'keur-moussa',action:'revokeAdmin'}),/pas administrateur/);
 await changeAdmin(db,owner,{uid,villageId:'diandioly',action:'revokeAdmin'});
 assert.equal(db.state.db_users[uid].active,false);
 await assert.rejects(identity(db,user(uid)),/suspendu/);
 await changeAdmin(db,owner,{uid,villageId:'diandioly',action:'reactivateAdmin'});
 assert.equal((await identity(db,user(uid))).role,'admin');
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
