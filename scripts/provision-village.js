#!/usr/bin/env node
'use strict';
// Créer un village / affecter un agent. L'utilisateur doit exister dans Firebase Auth.
// Exécution réelle uniquement avec --apply ; jamais de changement de village implicite.
const path = require('node:path');
const admin = require('firebase-admin');
const {cheminVillage} = require('../api/_village.js');
function arg(name) { const i=process.argv.indexOf('--'+name);return i<0?'':process.argv[i+1]; }
async function main() {
  const key=arg('key'),id=arg('id'),name=arg('nom'),email=arg('email'),role=arg('role')||'admin';
  if(!key || !id || !email || !['admin','caissier','tresorier','icp'].includes(role))
    throw new Error('Usage: node provision-village.js --key ./service-account.json --id village-slug --nom "Village" --email admin@exemple.sn --role admin [--apply]');
  cheminVillage(id); // valide le slug avant la moindre mutation
  const serviceAccount=require(path.resolve(key));
  admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL:process.env.FIREBASE_DATABASE_URL||'https://poste-sante-280b2-default-rtdb.firebaseio.com'});
  const db=admin.database(),record=await admin.auth().getUserByEmail(email);
  const regRef=db.ref(`villages_registry/${id}`), reg=(await regRef.once('value')).val();
  if(!reg && !name) throw new Error('Le nom du nouveau village est obligatoire.');
  if(email.toLowerCase()==='prozizou298@gmail.com') throw new Error('Le super administrateur ne peut pas être affecté à un village.');
  const userRef=db.ref(`db_users/${record.uid}`), prev=(await userRef.once('value')).val()||{};
  if(prev.village_id && prev.village_id !== id) throw new Error(`Utilisateur déjà affecté à ${prev.village_id}. Aucune mutation.`);
  if(prev.role && prev.role !== role) throw new Error(`Utilisateur déjà enregistré comme ${prev.role} : refus de changer le rôle sans procédure explicite.`);
  const active=(await db.ref(`villages/${id}`).once('value')).exists();
  if(!reg && active) throw new Error('Données du village existantes sans registre : opération refusée.');
  console.log(`Village : ${reg?.nom || name} (${id}); compte : ${email}; rôle : ${role}; mode : ${process.argv.includes('--apply')?'RÉEL':'SIMULATION'}`);
  if(!process.argv.includes('--apply')) return;
  if(!reg) await regRef.set({nom:name,active:true,created_ts:Date.now()});
  await userRef.update({role,village_id:id,active:true,email:record.email});
  console.log('Affectation enregistrée. Le compte ne voit que ce village.');
}
main().catch(e=>{console.error('CRÉATION REFUSÉE :',e.message);process.exitCode=1;});
