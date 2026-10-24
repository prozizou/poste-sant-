// Autorité serveur du village : ne jamais faire confiance à un id envoyé par le navigateur.
'use strict';
const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ROLES = new Set(['admin', 'caissier', 'tresorier', 'icp']);
function cheminVillage(villageId, path = '') {
  if (typeof villageId !== 'string' || !ID.test(villageId)) throw Object.assign(new Error('Identifiant village invalide.'), {status:403});
  const clean = String(path).replace(/^\/+|\/+$/g, '');
  if (clean.includes('..') || clean.includes('//')) throw new Error('Chemin dangereux.');
  return `villages/${villageId}${clean ? '/' + clean : ''}`;
}
function scopedDatabase(db, id) {
  return { ref: path => db.ref(cheminVillage(id, path)) };
}
async function identifierVillage(db, user, roles = [...ROLES]) {
  if (!user?.uid) throw Object.assign(new Error('Authentification requise.'), {status:401});
  const fiche = (await db.ref(`db_users/${user.uid}`).once('value')).val();
  if (!fiche || fiche.active === false || !ROLES.has(fiche.role) || !roles.includes(fiche.role) || !ID.test(fiche.village_id || ''))
    throw Object.assign(new Error('Compte sans affectation valide au village ou rôle non autorisé.'), {status:403});
  const v = (await db.ref(`villages_registry/${fiche.village_id}`).once('value')).val();
  if (!v || v.active !== true) throw Object.assign(new Error('Village inactif ou non répertorié.'), {status:403});
  return {villageId:fiche.village_id, role:fiche.role, db:scopedDatabase(db,fiche.village_id)};
}
module.exports = { cheminVillage, scopedDatabase, identifierVillage };
