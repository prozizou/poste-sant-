#!/usr/bin/env node
'use strict';
// For deployments already migrated without a superadmin. Simulate by default.
// NEVER copy service-account JSON into the web root or a public repository.
const fs=require('node:fs');const path=require('node:path');
const {OWNER_EMAIL}=require('../api/_access.js');
const has=s=>process.argv.includes('--'+s);
const value=s=>{const i=process.argv.indexOf('--'+s);return i>=0?process.argv[i+1]:''};
async function main(){
 const key=value('key');if(!key)throw Error('Usage: node bootstrap-superadmin.js --key /private/service-account.json [--apply --backup-confirmed]');
 const service=JSON.parse(fs.readFileSync(path.resolve(key),'utf8'));
 if(service?.project_id!=='poste-sante-280b2')throw Error('Projet Firebase incorrect.');
 const admin=require('firebase-admin');admin.initializeApp({credential:admin.credential.cert(service),databaseURL:process.env.FIREBASE_DATABASE_URL||'https://poste-sante-280b2-default-rtdb.firebaseio.com'});
 const db=admin.database(),auth=admin.auth(),owner=await auth.getUserByEmail(OWNER_EMAIL);
 if(owner.disabled)throw Error('Compte super administrateur désactivé dans Authentication.');
 const dbUser=(await db.ref('db_users/'+owner.uid).once('value')).val();
 if(!dbUser||!['admin','superadmin'].includes(dbUser.role))throw Error('Le compte n’est pas un ancien administrateur connu : vérification manuelle obligatoire.');
 const current=(await db.ref('superadmins').once('value')).val()||{};
 if(Object.entries(current).some(([uid,v])=>uid!==owner.uid&&v?.active))throw Error('Un autre super administrateur existe déjà.');
 console.log('Compte existant vérifié dans Authentication et db_users.');
 console.log('Mode :',has('apply')?'ÉCRITURE':'SIMULATION');
 if(!has('apply'))return;
 if(!has('backup-confirmed'))throw Error('Exiger --backup-confirmed après sauvegarde RTDB complète.');
 const updates={};
 updates[`db_users/${owner.uid}/role`]='superadmin';
 updates[`db_users/${owner.uid}/active`]=true;
 updates[`db_users/${owner.uid}/village_id`]=null;
 updates[`db_users/${owner.uid}/email`]=OWNER_EMAIL;
 updates[`superadmins/${owner.uid}`]={email:OWNER_EMAIL,active:true,updated_ts:Date.now()};
 await db.ref().update(updates);
 console.log('Super administrateur activé ; autres utilisateurs inchangés.');
}
main().catch(e=>{console.error('REFUS :',e.message);process.exitCode=1});
