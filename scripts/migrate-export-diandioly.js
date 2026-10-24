#!/usr/bin/env node
'use strict';
/**
 * Diandioly: vérification d'un export RTDB avant copie multi-villages.
 * Sans --apply: aucune connexion ni écriture. Avec --apply: vérifie la source
 * contre les données ROOT actuellement en production, l'identité Firebase Auth
 * de chaque agent, l'absence de collision, puis copie sans suppression.
 * ATTENTION: exécuté exclusivement sur un ordinateur serveur privé.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const ROOT = Object.freeze([
  'ticket_dbase','vente_medicaments','db_pharmacie_stock',
  'db_pharmacie_reappro','db_depenses','compteurs','notifications_caisse',
  'gallery','pharmacie_operations','fcm_tokens_admin'
]);
const ROLES = new Set(['admin','caissier','tresorier','icp']);
function args(argv) {
  const ret = {apply:false, resume:false, backup:false, maintenance:false, source:'',key:'',backupOut:''};
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === '--apply') ret.apply=true;
    else if (arg === '--resume') ret.resume=true;
    else if (arg === '--backup-confirmed') ret.backup=true;
    else if (arg === '--maintenance-confirmed') ret.maintenance=true;
    else if (arg === '--source' || arg === '--key' || arg === '--backup-out') {
      if (!argv[i+1]) throw new Error(`Option sans valeur : ${arg}`);
      ret[arg === '--backup-out' ? 'backupOut' : arg.slice(2)] = argv[++i];
    } else throw new Error(`Option inconnue : ${arg}`);
  }
  return ret;
}
const canonical = value => JSON.stringify(value, function(k,v) {
  if (!v || Array.isArray(v) || typeof v !== 'object') return v;
  return Object.keys(v).sort().reduce((o,key)=>{o[key]=v[key];return o;},{});
});
const hash = value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
function loadSource(filename) {
  if (!filename) throw new Error('Indiquer --source /chemin/export-rtdb.json');
  const s = JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Export RTDB invalide : objet attendu');
  const missing = ['db_users','administration','ticket_dbase','vente_medicaments','db_pharmacie_stock'].filter(k=>!s[k]);
  if (missing.length) throw new Error('Collections obligatoires absentes : '+missing.join(', '));
  const extra = Object.keys(s).filter(k=>!ROOT.includes(k) && k!=='db_users' && k!=='administration');
  if (extra.length) throw new Error('Nouveaux noeuds inattendus : '+extra.join(', ')+' ; vérifier avant de poursuivre.');
  if (!s.administration?.auth_db || typeof s.administration.auth_db !== 'object') throw new Error('Anciens rôles absents');
  if (Object.keys(s.db_users).length < 1) throw new Error('Aucun utilisateur dans la source');
  const users = Object.entries(s.db_users);
  for (const [uid,v] of users) {
    if (!/^[\w-]{20,128}$/.test(uid) || !ROLES.has(v?.role)) throw new Error('UID ou rôle invalide dans db_users');
    if (v.village_id && v.village_id !== 'diandioly') throw new Error('Compte déjà affecté à un autre village dans la source');
  }
  const legacy = Object.values(s.administration.auth_db);
  if (!legacy.length || legacy.length !== users.length) throw new Error('Nombre de comptes différents entre auth_db et db_users');
  for (const u of legacy) {
    if (!u?.email || !ROLES.has(u.role)) throw new Error('Ancien agent sans email ou rôle reconnu');
  }
  const counts = Object.fromEntries(ROOT.filter(k=>s[k]!=null).map(k=>[k,Object.keys(s[k]).length]));
  return {source:s,counts,users,legacy,sourceHash:hash(s)};
}
function assertSame(label, a, b) {if(hash(a)!==hash(b)) throw new Error('STOP : données modifiées depuis cet export ('+label+'). Faire un nouvel export et réévaluer.');}
async function run(opt) {
  const {source,counts,users,legacy,sourceHash}=loadSource(opt.source);
  console.log('Village cible : diandioly (Diandioly)');
  console.log('Export SHA256 canonique :',sourceHash);
  console.log('Collections:',JSON.stringify(counts));
  console.log('Comptes à rattacher :',users.length,'; copies de médicaments et tickets conservées sans transformation');
  if (!opt.apply) {
    console.log('SIMULATION LOCALE — aucune connexion ni écriture. Vérification des UIDs Auth uniquement pendant --apply.');
    return;
  }
  if (!opt.backup || !opt.maintenance || !opt.key || !opt.backupOut || !path.isAbsolute(opt.backupOut)) {
    throw new Error('Écriture refusée : exiger --key CHEMIN --backup-out CHEMIN_ABSOLU --backup-confirmed --maintenance-confirmed --apply (et arrêter tous les postes clients).');
  }
  if (path.resolve(opt.backupOut).startsWith(path.resolve(__dirname,'..')+path.sep)) throw new Error('Sauvegarde privée interdite dans le répertoire web du projet');
  const account = JSON.parse(fs.readFileSync(path.resolve(opt.key),'utf8'));
  if (account?.type!=='service_account' || account.project_id !== 'poste-sante-280b2') throw new Error('Compte de service non autorisé pour ce projet.');
  // Chargement tardif : le dry-run ne nécessite pas de SDK Admin ni de réseau.
  const admin=require('firebase-admin');
  const dbURL=process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';
  admin.initializeApp({credential:admin.credential.cert(account),databaseURL:dbURL});
  const db=admin.database(), auth=admin.auth();
  // La sauvegarde du JSON SOURCE ne remplace pas une sauvegarde du LIVE récent.
  // Ne JAMAIS écrire tant que les snapshots live ne correspondent pas exactement.
  const regRef=db.ref('villages_registry/diandioly');
  const reg=(await regRef.once('value')).val();
  if (reg?.active===true) throw new Error('Migration déjà active. Aucune fusion autorisée.');
  if (reg && !opt.resume) throw new Error('Registre déjà présent : inspecter, puis --resume si nécessaire');
  const targetRef=db.ref('villages/diandioly');
  const target=(await targetRef.once('value')).val();
  const payload=Object.fromEntries(ROOT.filter(k=>source[k]!=null).map(k=>[k,source[k]]));
  if (target) {
    if (!opt.resume) throw new Error('Village cible déjà rempli : aucune copie pour éviter un écrasement');
    assertSame('village cible non conforme',target,payload);
  }
  for (const name of ROOT) {
    const live=(await db.ref(name).once('value')).val();
    assertSame(name,live,source[name]??null);
  }
  // Vérifie les UID en les résolvant depuis Firebase Authentication, pas seulement l'email.
  const currentUsers=(await db.ref('db_users').once('value')).val()||{};
  if (Object.keys(currentUsers).length !== users.length) throw new Error('Nombre de comptes live différent de celui de l’export');
  const looked=new Set();
  let ownerUID=null;
  for (const u of legacy) {
    const authUser=await auth.getUserByEmail(u.email);
    const uid=authUser.uid;
    if (looked.has(uid)) throw new Error('Plusieurs anciens comptes renvoient au même UID');
    if (u.email.toLowerCase()==='prozizou298@gmail.com') { if (u.role!=='admin') throw new Error('Le super administrateur doit être un ancien administrateur');ownerUID=uid; }
    looked.add(uid);
    if (!source.db_users[uid] || source.db_users[uid].role !== u.role) throw new Error('Discordance identité Auth / rôles pour un ancien agent. Aucune modification.');
    const live=currentUsers[uid];
    if (!live || live.role!==u.role || (live.village_id && live.village_id!=='diandioly')) throw new Error('Rôle ou affectation live incompatible. Aucune modification.');
  }
  if (looked.size!==users.length) throw new Error('Tous les UIDs exportés ne correspondent pas à un compte Firebase Authentication');
  if(!ownerUID) throw new Error('Le compte super administrateur n’est pas vérifié : migration bloquée.');
  const previousSuper = (await db.ref('superadmins').once('value')).val()||{};
  if(Object.keys(previousSuper).some(k=>k!==ownerUID && previousSuper[k]?.active===true)) throw new Error('Un autre super administrateur est déjà actif : audit manuel requis.');
  console.log('Vérification LIVE et identités Firebase Authentication : conforme.');
  // Sauvegarde supplémentaire du LIVE complet : fichier créé avec permissions 0600, sans écraser d'existant.
  const liveRoot = (await db.ref().once('value')).val();
  for (const name of ROOT) assertSame(name, liveRoot?.[name]??null, source[name]??null);
  fs.writeFileSync(path.resolve(opt.backupOut), JSON.stringify(liveRoot, null, 2), {encoding:'utf8',flag:'wx',mode:0o600});
  console.log('Sauvegarde LIVE créée et conservée hors projet :',path.resolve(opt.backupOut));
  if (!target) {
    await targetRef.set(payload); // écriture de la copie sous un seul village
    console.log('Copie des collections vers villages/diandioly : effectuée, registre toujours inactif.');
  }
  const check=(await targetRef.once('value')).val();
  assertSame('village après copie',check,payload);
  // Écriture atomique : active le village ET l'affectation de tous les comptes.
  // N'efface ni n'écrase les nœuds racine hérités ni les autres villages.
  const updates={};
  for (const [uid] of users) {
    updates[`db_users/${uid}/village_id`] = uid===ownerUID ? null : 'diandioly';
    updates[`db_users/${uid}/active`] = true;
    if(uid===ownerUID) updates[`db_users/${uid}/role`] = 'superadmin';
  }
  updates[`superadmins/${ownerUID}`] = {active:true,email:'prozizou298@gmail.com',updated_ts:Date.now()};
  updates['villages_registry/diandioly']={nom:'Diandioly',active:true,created_ts:Date.now(),migration_source_sha256:sourceHash};
  // Recontrôle en fin de copie : fail closed si un client a écrit entre-temps.
  for (const name of ROOT) assertSame(name,(await db.ref(name).once('value')).val(),source[name]??null);
  await db.ref().update(updates);
  console.log('ACTIVATION TERMINÉE. Les données originales à la racine restent en place. Déployer application + règles pendant la même maintenance.');
}
if (require.main === module) {
  run(args(process.argv.slice(2))).catch(e=>{console.error('MIGRATION REFUSÉE :',e.message);process.exitCode=1;});
}
module.exports={args,loadSource,hash,assertSame,run};
