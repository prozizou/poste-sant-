'use strict';
const { amount, civilDate, recordTimestamp } = require('../domain-values.mjs');
const { atomicOperation, fail } = require('./_atomic.js');

const TARIFS = Object.freeze({
  'Consultation Générale – Adulte': 500,
  'Consultation Générale – Enfant': 300,
  'CPN – Consultation Prénatale': 700,
  Pansement: 200,
  Accouchement: 5000,
});
const STOCK_FIELDS = ['nom','forme','dosage','categorie','unite','conditionnement','fabricant','amm','ordonnance','conditions_stockage','observations'];
const KEY = /^[-_A-Za-z0-9]{1,90}$/;
function text(v, max = 200) {
  if (typeof v !== 'string' || v.length > max) throw fail(422, 'Texte absent ou trop long.');
  return v.trim();
}
function key(v) { if (typeof v !== 'string' || !KEY.test(v)) throw fail(422, 'Référence invalide.'); return v; }
function roleIs(role, allowed) { if (!allowed.includes(role)) throw fail(403, 'Rôle non autorisé pour cette opération.'); }
function dateTime(value, now) {
  const ts = Number(value);
  if (!Number.isSafeInteger(ts) || ts < now - 366 * 86400000 || ts > now + 59000) throw fail(422, 'Date hors période autorisée (366 jours maximum).');
  return Math.min(ts, now);
}
function dated(ts) {
  const date = new Date(ts);
  return { date_heure_ts: ts, date: date.toLocaleDateString('fr-FR', {timeZone:'Africa/Dakar'}), heure: date.toLocaleTimeString('fr-FR', {timeZone:'Africa/Dakar',hour:'2-digit',minute:'2-digit'}) };
}
function history(current, entry) {
  return [...(Array.isArray(current.modifications) ? current.modifications : Object.values(current.modifications || {})), entry];
}
function stockFields(body, initial) {
  const fields = {};
  for (const name of STOCK_FIELDS) if (Object.hasOwn(body, name)) fields[name] = text(body[name], name === 'observations' ? 1000 : 180);
  for (const name of ['prix_unitaire','prix_achat','seuil_alerte']) if (Object.hasOwn(body, name)) fields[name] = amount(body[name], name);
  if (initial && (!fields.nom || fields.prix_unitaire == null)) throw fail(422, 'Nom et prix du produit requis.');
  if (fields.nom === '') throw fail(422, 'Nom du produit requis.');
  return fields;
}
function lotAvailability(product) {
  let remaining = amount(product.quantite, 'Stock');
  const entries = Object.entries(product.lots || {}).filter(([,l]) => l && !l.retire)
    .sort((a,b) => String(a[1].date_peremption || '').localeCompare(String(b[1].date_peremption || '')) || a[0].localeCompare(b[0]));
  const result = {};
  for (let i = entries.length - 1; i >= 0; i--) {
    const [id, lot] = entries[i];
    result[id] = Math.min(amount(lot.qte_recue, 'Quantité de lot'), remaining);
    remaining -= result[id];
  }
  result._hors = remaining;
  return result;
}
function syncExpiry(product) {
  const available = lotAvailability(product);
  const lots = Object.entries(product.lots || {}).filter(([id,l]) => !l.retire && available[id] > 0)
    .sort((a,b) => String(a[1].date_peremption || '').localeCompare(String(b[1].date_peremption || '')) || a[0].localeCompare(b[0]));
  if (lots.length) { product.date_peremption = lots[0][1].date_peremption || ''; product.lot = lots[0][1].numero || ''; }
  return product;
}

function planBusiness(state, action, b, user, role, ctx) {
  const updates = {}, now = ctx.now, actor = user.email || user.uid;
  let result, before = null, after = null, target;
  if (action.startsWith('ticket_')) {
    roleIs(role, action === 'ticket_creer' || action === 'ticket_annuler' ? ['admin','caissier'] : ['admin']);
    target = action === 'ticket_creer' ? ctx.nextKey() : key(b.key);
    before = state.ticket_dbase?.[target] || null;
    if (action !== 'ticket_creer' && !before) throw fail(404, 'Ticket introuvable.');
    if (action === 'ticket_creer' || action === 'ticket_modifier') {
      if (before?.annule) throw fail(409, 'Ticket annulé : modification refusée.');
      const prenom = text(b.prenom, 80), nom = text(b.nom, 80), choix = text(b.choix, 100);
      if (!prenom || !nom || !Object.hasOwn(TARIFS, choix)) throw fail(422, 'Patient ou prestation invalide.');
      const age = amount(b.age, 'Âge');
      if (age > 120) throw fail(422, 'Âge hors limites.');
      const prix = action === 'ticket_creer' ? TARIFS[choix] : amount(b.prix, 'Prix');
      if (action === 'ticket_creer' && b.prix != null && amount(b.prix) !== prix) throw fail(409, 'Le tarif a changé : actualisez la consultation.');
      const recu = amount(action === 'ticket_creer' ? b.argent_remis : before.argent_remis, 'Montant remis');
      if (recu < prix) throw fail(422, 'Montant remis insuffisant.');
      const ts = dateTime(b.date_heure_ts ?? now, now);
      after = { ...(before || {}), prenom, nom, name: prenom+' '+nom, age, choix, prix, argent_remis:recu, monnaie_rendue:recu-prix, ...dated(ts), validite_ts:ts+86400000 };
      if (!before) {
        const day = new Date(ts).toISOString().slice(0,10), counter = 'attente_'+day;
        let max = amount(state.compteurs?.[counter] ?? 0, 'Compteur');
        for (const t of Object.values(state.ticket_dbase || {})) if (Number.isFinite(recordTimestamp(t)) && new Date(recordTimestamp(t)).toISOString().slice(0,10) === day) {
          const m = /^N°\s*(\d+)$/.exec(String(t.num_attente || ''));
          if (m) max = Math.max(max, amount(m[1], 'Numéro d’attente'));
        }
        const num = amount(max+1,'Compteur');
        updates['compteurs/'+counter] = num;
        Object.assign(after, { num_attente:'N° '+String(num).padStart(3,'0'), saisi_par:actor, saisi_uid:user.uid, cree_ts:now, operation_id:ctx.id });
      } else {
        Object.assign(after, { modifie_par:actor, modifie_ts:now, modifications:history(before,{ts:now,par:actor,motif:text(b.motif || 'Modification administration'),avant:{prix:before.prix,date_heure_ts:before.date_heure_ts},apres:{prix,date_heure_ts:ts}}) });
      }
    } else if (action === 'ticket_annuler' || action === 'ticket_restaurer') {
      const cancelled = action === 'ticket_annuler';
      if (!!before.annule === cancelled) throw fail(409, cancelled ? 'Ticket déjà annulé.' : 'Ticket déjà actif.');
      const prefix = cancelled ? 'annule' : 'restaure';
      after = { ...before, annule:cancelled, [prefix+'_ts']:now, [prefix+'_par']:actor, [prefix+'_motif']:text(b.motif || ''), [prefix+'_obs']:text(b.obs || '',1000) };
    } else throw fail(422, 'Action ticket inconnue.');
    updates['ticket_dbase/'+target] = after;
    result = {ok:true,key:target,ticket:after};
  } else if (action.startsWith('depense_')) {
    roleIs(role,['admin','tresorier']);
    target = action === 'depense_creer' ? ctx.nextKey() : key(b.key);
    before = state.db_depenses?.[target] || null;
    if (action !== 'depense_creer' && !before) throw fail(404,'Dépense introuvable.');
    if (action === 'depense_supprimer') after = null;
    else if (action === 'depense_creer' || action === 'depense_modifier') {
      const montant = amount(b.montant,'Dépense',true), categorie = text(b.categorie,100), libelle = text(b.libelle,200);
      if (!categorie || !libelle) throw fail(422,'Catégorie et justificatif requis.');
      const date = b.date_iso || (Number.isSafeInteger(b.date_ts) ? new Date(b.date_ts).toISOString().slice(0,10) : '');
      if (!civilDate(date) || date > new Date(now).toISOString().slice(0,10)) throw fail(422,'Date de dépense invalide ou future.');
      const ts = Math.min(Date.parse(date+'T12:00:00Z'),now);
      after = { ...(before || {}), montant,categorie,libelle,date_ts:ts,date:new Date(ts).toLocaleDateString('fr-FR',{timeZone:'Africa/Dakar'}),
        ...(before ? {modifie_par:actor,modifie_ts:now} : {cree_par:actor,cree_uid:user.uid,cree_le:now,operation_id:ctx.id}) };
    } else throw fail(422,'Action dépense inconnue.');
    updates['db_depenses/'+target] = after;
    result = {ok:true,key:target};
  } else if (action.startsWith('stock_')) {
    roleIs(role,['admin']);
    target = action === 'stock_creer' ? ctx.nextKey() : key(b.key);
    before = state.db_pharmacie_stock?.[target] || null;
    if (action !== 'stock_creer' && !before) throw fail(404,'Produit introuvable.');
    after = structuredClone(before || {});
    const avant = before ? amount(before.quantite,'Stock') : 0;
    let type = 'modification', motif = text(b.motif || '',1000);
    if (b.expectedQuantity != null && amount(b.expectedQuantity,'Stock attendu') !== avant) throw fail(409,'Le stock a changé pendant la saisie : rechargez la fiche avant de corriger.');
    if (action === 'stock_creer') {
      const p = b.produit || {}, q = amount(p.quantite,'Quantité'), date = p.date_peremption;
      if (!civilDate(date)) throw fail(422,'Date de péremption invalide.');
      const fields = stockFields(p,true), lot = ctx.nextKey();
      after = { ...fields, quantite:q,date_peremption:date,lot:text(p.lot || '',90),source:text(p.source || '',150),cree_par:actor,timestamp:now,
        date_entree:new Date(now).toISOString().slice(0,10),lots:{[lot]:{numero:text(p.lot || '',90),date_peremption:date,qte_recue:q,fournisseur:text(p.source || '',150),par:actor,ts:now}} };
      type = 'entree';
    } else if (action === 'stock_modifier') {
      Object.assign(after,stockFields(b.champs || {},false));
      if (b.date_peremption != null) {
        if (Object.keys(after.lots || {}).length) throw fail(422,'Modifier la péremption dans la fiche du lot.');
        if (!civilDate(b.date_peremption)) throw fail(422,'Péremption invalide.');
        after.date_peremption=b.date_peremption;
      }
    } else if (action === 'stock_ajuster') {
      if (b.expectedQuantity == null || !motif) throw fail(422,'Stock attendu et motif requis.');
      Object.assign(after,stockFields(b.champs || {},false));
      after.quantite=amount(b.quantite,'Quantité');type='ajustement';
      if (Object.keys(after.lots || {}).length && lotAvailability(after)._hors>0) throw fail(409,'Quantité sans lot traçable : enregistrer un réapprovisionnement avec sa péremption.');
    } else if (action === 'stock_retirer_lot') {
      const id=key(b.lotId), q=lotAvailability(after)[id];
      if (!q || !motif) throw fail(409,'Lot vide, absent ou motif manquant.');
      after.quantite=avant-q;
      if (id!=='_hors') Object.assign(after.lots[id],{retire:true,qte_retiree:q,retire_motif:motif,retire_par:actor,retire_ts:now});
      type='retrait';
    } else if (action === 'stock_modifier_lot') {
      const id=key(b.lotId), lot=after.lots?.[id];
      if (!lot || lot.retire || !civilDate(b.date_peremption)) throw fail(422,'Lot ou date invalide.');
      Object.assign(lot,{numero:text(b.numero || '',90),date_peremption:b.date_peremption,fournisseur:text(b.fournisseur || '',150)});
    } else if (action === 'stock_archiver' || action === 'stock_restaurer') {
      if (action==='stock_archiver' && avant!==0) throw fail(409,'Le stock doit être nul pour archiver ce produit.');
      after.archive=action==='stock_archiver';after.archive_ts=now;after.archive_par=actor;
      type=after.archive?'suppression':'restauration';
    } else throw fail(422,'Action stock inconnue.');
    if (action==='stock_ajuster' && b.date_peremption!=null && !Object.keys(after.lots || {}).length) {
      if (!civilDate(b.date_peremption)) throw fail(422,'Date de péremption invalide.');
      after.date_peremption=b.date_peremption;
    }
    Object.assign(after,{modifie_par:actor,modifie_le:now});
    syncExpiry(after);
    updates['db_pharmacie_stock/'+target]=after;
    updates['db_pharmacie_reappro/'+ctx.nextKey()]={type,med_id:target,nom_medicament:after.nom,quantite_ajoutee:after.quantite-avant,ancienne_quantite:avant,nouvelle_quantite:after.quantite,observations:motif,date:new Date(now).toISOString().slice(0,10),timestamp:now,par:actor,operation_id:ctx.id};
    result={ok:true,key:target,avant,apres:after.quantite};
  } else throw fail(422,'Action métier inconnue.');
  updates['business_audit/'+ctx.nextKey()]={action,key:target,uid:user.uid,par:actor,ts:now,operation_id:ctx.id,avant:before,apres:after};
  return {updates,result,financial:!action.startsWith('stock_')};
}
function executeBusiness(db,action,body,user,role) { return atomicOperation(db,action,body,user,role,planBusiness); }
module.exports={executeBusiness,planBusiness,TARIFS,lotAvailability,syncExpiry};
