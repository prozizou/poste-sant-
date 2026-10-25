'use strict';
// Administrative management is exclusively server-side. Client never writes db_users.
const crypto=require('node:crypto');
const { identity, mayManage, STAFF, SLUG, EMAIL, forbidden } = require('./_access.js');
const DB_URL=process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';
const fail=(status,msg)=>Object.assign(new Error(msg),{status});
function firebase(){
 const {initializeApp,cert,getApps,getApp}=require('firebase-admin/app');
 const {getAuth}=require('firebase-admin/auth');
 const {getDatabase}=require('firebase-admin/database');
 if(!getApps().length){
  if(!process.env.FIREBASE_SERVICE_ACCOUNT) throw fail(503,'Configurer FIREBASE_SERVICE_ACCOUNT sur le serveur.');
  const creds=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if(creds.project_id!=='poste-sante-280b2') throw fail(503,'Projet Firebase incorrect.');
  initializeApp({credential:cert(creds),databaseURL:DB_URL});
 }
 return {db:getDatabase(getApp()),auth:getAuth(getApp())};
}
const val=(s,max)=>String(s||'').trim().slice(0,max);
// Durées d'accès proposées au super administrateur, en mois.
const DUREES=Object.freeze({'1m':1,'3m':3,'6m':6,'1a':12});
// Ajout de mois en gardant une date valide (fin de mois ramenée au dernier jour réel).
function ajouterMois(ts,mois){
 const d=new Date(ts),jour=d.getDate();
 d.setDate(1); d.setMonth(d.getMonth()+mois);
 const dernier=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
 d.setDate(Math.min(jour,dernier));
 return d.getTime();
}
async function authActor(req,db,auth){
 const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
 if(!token) throw fail(401,'Jeton de connexion obligatoire.');
 const user=await auth.verifyIdToken(token,true);
 if(user.firebase?.sign_in_provider==='anonymous') throw forbidden();
 return identity(db,user);
}
async function userDTO(auth,uid,profile){
 let email=profile?.email || '';
 if(!email){try {email=(await auth.getUser(uid)).email||'';} catch{}}
 return {uid,email,role:profile.role,active:profile.active!==false};
}
async function listing(db,auth,actor,scope){
 if(actor.global){
  if(scope!=='overview') throw forbidden();
  const registry=(await db.ref('villages_registry').once('value')).val()||{};
  const users=(await db.ref('db_users').once('value')).val()||{};
  const villages=await Promise.all(Object.entries(registry).map(async([id,meta])=>({
   id,nom:String(meta?.nom||id),active:meta?.active===true,motif:meta?.active===true?'':String(meta?.suspension?.motif||''),
   expires_ts:Number(meta?.expires_ts)||null,duree:String(meta?.duree||''),
   admins:await Promise.all(Object.entries(users).filter(([,u])=>u?.village_id===id && u.role==='admin').map(([uid,u])=>userDTO(auth,uid,u)))
  })));
  return {villages: villages.sort((a,b)=>a.nom.localeCompare(b.nom)),scope:'overview'};
 }
 if(actor.role!=='admin'||scope!=='team') throw forbidden();
 const users=(await db.ref('db_users').once('value')).val()||{};
 const members=await Promise.all(Object.entries(users).filter(([,u])=>u?.village_id===actor.villageId && STAFF.includes(u.role)).map(([uid,u])=>userDTO(auth,uid,u)));
 return {scope:'team',villageId:actor.villageId,members:members.sort((a,b)=>a.email.localeCompare(b.email))};
}
async function assignAccount(db,auth,actor,{email,role,villageId}){
 if(!EMAIL.test(email)||email.length>254) throw fail(422,'Adresse e-mail invalide.');
 mayManage(actor,role,villageId);
 const village=(await db.ref('villages_registry/'+villageId).once('value')).val();
 if(village?.active!==true) throw fail(409,'Village absent ou désactivé.');
 let account,created=false;
 try {account=await auth.getUserByEmail(email);}catch(e){
  if(e.code!=='auth/user-not-found') throw e;
  // No default password; user must set their own via password-reset mail.
  account=await auth.createUser({email,password:crypto.randomBytes(48).toString('base64url'),emailVerified:false,disabled:false});created=true;
 }
 if(account.email?.toLowerCase()!==email) throw fail(409,'Compte e-mail incohérent.');
 if(account.uid===actor.uid) throw forbidden('Impossible de modifier ses propres droits.');
 const owner=(await db.ref('superadmins/'+account.uid).once('value')).val();
 if(owner?.active || email==='prozizou298@gmail.com') throw forbidden('Le super administrateur ne peut être réaffecté.');
 const accountRef=db.ref('db_users/'+account.uid);
 let conflicts='';
 const result=await accountRef.transaction(current=>{
  if(current?.role==='superadmin'||(current?.village_id && current.village_id!==villageId)){
   conflicts='Ce compte appartient à un autre village ou possède des droits globaux.';return;
  }
  if(!actor.global && current?.role==='admin'){
   conflicts='L’administrateur local ne peut pas modifier un administrateur.';return;
  }
  return { ...(current||{}),email,village_id:villageId,role,active:true,assigned_by:actor.uid,updated_ts:Date.now() };
 },undefined,false);
 if(!result.committed) throw fail(409,conflicts||'Conflit de mise à jour : vérifier les droits.');
 if(account.disabled) await auth.updateUser(account.uid,{disabled:false});
 return {uid:account.uid,email,role,villageId,created,needsPasswordSetup:created};
}
async function changeStaff(db,actor,{uid,role,mode}){
 if(actor.global||actor.role!=='admin') throw forbidden();
 if(typeof uid!=='string'||uid.length<16||uid.length>128||actor.uid===uid) throw forbidden();
 if(mode==='role'&&!STAFF.includes(role)) throw forbidden('Rôle interdit.');
 const accountRef=db.ref('db_users/'+uid);
 const cur=(await accountRef.once('value')).val();
 if(!cur || cur.village_id!==actor.villageId || !STAFF.includes(cur.role)) throw fail(403,'Utilisateur extérieur à votre équipe ou rôle protégé.');
 await accountRef.set({...cur,...(mode==='role'?{role}:{active:mode==='reactivate'}),updated_ts:Date.now(),updated_by:actor.uid});
 return {uid,role:mode==='role'?role:undefined,active:mode==='revoke'?false:undefined};
}
async function changeVillage(db,auth,actor,{villageId,action,motif}){
 if(!actor.global || !SLUG.test(villageId||'')) throw forbidden();
 const v=db.ref('villages_registry/'+villageId);
 if(action==='createVillage') throw fail(422,'Utiliser une création avec nom.');
 if(!['activateVillage','deactivateVillage'].includes(action)) throw fail(422,'Action invalide.');
 const raison=val(motif,300);
 if(action==='deactivateVillage' && raison.length<3) throw fail(422,'Indiquer le motif de la suspension (3 caractères minimum).');
 const activer=action==='activateVillage';
 const current=(await v.once('value')).val();
 if(!current) throw fail(404,'Village introuvable.');
 const next={...current,active:activer,updated_by:actor.uid,updated_ts:Date.now()};
 if(activer) delete next.suspension; else next.suspension={motif:raison,ts:Date.now(),by:actor.uid};
 await v.set(next);
 if(!activer){
  // Toute l'équipe est déconnectée : les jetons existants sont révoqués, et les règles
  // RTDB + les API refusent déjà tout accès tant que le village est suspendu.
  const users=(await db.ref('db_users').once('value')).val()||{};
  await Promise.allSettled(Object.entries(users).filter(([,u])=>u?.village_id===villageId).map(([uid])=>auth.revokeRefreshTokens(uid)));
 }
 return {villageId,active:activer};
}
async function perform(db,auth,actor,b){
 const action=String(b.action||'');
 if(action==='createVillage'){
  if(!actor.global) throw forbidden();
  const id=val(b.villageId,42),nom=val(b.nom,100),duree=val(b.duree,4);
  if(!SLUG.test(id)||nom.length<2) throw fail(422,'Nom ou identifiant de village invalide.');
  if(!DUREES[duree]) throw fail(422,'Durée d’accès invalide (1 mois, 3 mois, 6 mois ou 1 an).');
  if((await db.ref('villages/'+id).once('value')).exists()) throw fail(409,'Village possédant déjà des données : création refusée.');
  const now=Date.now(),expires_ts=ajouterMois(now,DUREES[duree]);
  const result=await db.ref('villages_registry/'+id).transaction(cur=>cur===null?{nom,active:true,created_by:actor.uid,created_ts:now,duree,expires_ts}:undefined,undefined,false);
  if(!result.committed) throw fail(409,'Village existant.');
  return {villageId:id,nom,expires_ts};
 }
 if(action==='renewVillage'){
  if(!actor.global||!SLUG.test(b.villageId||'')) throw forbidden();
  const duree=val(b.duree,4);
  if(!DUREES[duree]) throw fail(422,'Durée d’accès invalide.');
  const v=db.ref('villages_registry/'+b.villageId);
  const current=(await v.once('value')).val();
  if(!current) throw fail(404,'Village introuvable.');
  // Prolongation : à partir de l'échéance en cours si elle est future, sinon à partir d'aujourd'hui.
  const base=Math.max(Date.now(),Number(current.expires_ts)||0);
  const expires_ts=ajouterMois(base,DUREES[duree]);
  await v.set({...current,duree,expires_ts,updated_by:actor.uid,updated_ts:Date.now()});
  return {villageId:b.villageId,expires_ts};
 }
 if(action==='activateVillage'||action==='deactivateVillage') return changeVillage(db,auth,actor,{villageId:b.villageId,action,motif:b.motif});
 if(action==='assignAdmin'||action==='createStaff'){
  if((action==='assignAdmin')!==actor.global) throw forbidden();
  const role=action==='assignAdmin'?'admin':val(b.role,30);
  const villageId=actor.global?val(b.villageId,42):actor.villageId;
  return assignAccount(db,auth,actor,{email:val(b.email,255).toLowerCase(),role,villageId});
 }
 if(['changeStaffRole','revokeStaff','reactivateStaff'].includes(action)){
  return changeStaff(db,actor,{uid:b.uid,role:b.role,mode:action==='changeStaffRole'?'role':(action==='revokeStaff'?'revoke':'reactivate')});
 }
 throw fail(422,'Action non reconnue.');
}
// Explique à un compte authentifié pourquoi son accès est refusé (village ou compte suspendu).
// Ne vérifie pas la révocation : un jeton révoqué doit pouvoir lire son propre motif.
async function statut(req,db,auth){
 const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
 if(!token) throw fail(401,'Jeton de connexion obligatoire.');
 const user=await auth.verifyIdToken(token,false);
 const fiche=(await db.ref('db_users/'+user.uid).once('value')).val();
 if(!fiche) return {statut:'non_configure'};
 if(fiche.role==='superadmin') return {statut:'actif'};
 if(fiche.active===false) return {statut:'compte_suspendu'};
 if(!SLUG.test(fiche.village_id||'')) return {statut:'non_configure'};
 const village=(await db.ref('villages_registry/'+fiche.village_id).once('value')).val();
 if(village?.active!==true) return {statut:'village_suspendu',village:String(village?.nom||fiche.village_id),motif:String(village?.suspension?.motif||'')};
 return {statut:'actif'};
}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 try {
  if(!['GET','POST'].includes(req.method)) throw fail(405,'Méthode non autorisée.');
  const {db,auth}=firebase();
  if(req.method==='GET' && req.query?.scope==='statut') return res.status(200).json({ok:true,...await statut(req,db,auth)});
  const actor=await authActor(req,db,auth);
  const data=req.method==='GET'?await listing(db,auth,actor,req.query?.scope):await perform(db,auth,actor,req.body||{});
  res.status(200).json({ok:true,...data});
 }catch(e){
  const status=e.status||(String(e.code||'').startsWith('auth/id-token')||e.code==='auth/user-disabled'?401:500);
  if(status>=500) console.error('access-management',e);
  res.status(status).json({ok:false,error:status>=500?'Service temporairement indisponible.':e.message});
 }
}
module.exports=handler;
module.exports.__test={assignAccount,changeStaff,perform,listing};
