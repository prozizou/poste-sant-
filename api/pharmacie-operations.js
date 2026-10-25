'use strict';
// POST /api/pharmacie-operations — vente / annulation / restauration / modification.
// Exige FIREBASE_SERVICE_ACCOUNT sur Vercel (même configuration que /api/notifier).
// Un verrou serveur RTDB sérialise les mutations pharmacie ; update(multi-chemins)
// valide ensuite vente, stock et commande en un seul commit RTDB atomique.
const crypto = require('node:crypto');
const { identifierVillage } = require('./_village.js');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';
const OPS = new Set(['encaisser', 'annuler', 'restaurer', 'modifier', 'reappro', 'supprimer', 'supprimer_ticket']);
class BusinessError extends Error { constructor(status, message) { super(message); this.status = status; } }
function err(status, message) { throw new BusinessError(status, message); }
function init() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) err(503, 'Service indisponible : configurer FIREBASE_SERVICE_ACCOUNT.');
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: DATABASE_URL });
  }
}
function positiveInteger(v, name, allowZero = false) {
  if (!Number.isSafeInteger(v) || (allowZero ? v < 0 : v <= 0)) err(422, `${name} invalide.`);
  return v;
}
function money(v, name) { return positiveInteger(v, name, true); }
function allowedDate(ts) {
  if (!Number.isFinite(ts) || ts > Date.now() + 59000 || ts < Date.now() - 366 * 24 * 3600000)
    err(422, 'Date ou heure hors période autorisée (maximum 366 jours en arrière).');
  return ts;
}
function getValidStock(s, key) {
  if (!s || typeof s !== 'object' || s.archive) err(409, `Médicament introuvable ou archivé : ${key}`);
  if (!Number.isSafeInteger(Number(s.quantite)) || Number(s.quantite) < 0)
    err(409, `Stock incohérent : ${s.nom || key}`);
  return Number(s.quantite);
}
function qtyFromLots(s) {
  const q = Number(s.quantite);
  const lots = Object.values(s.lots || {}).filter(l => l && !l.retire).map(l => ({
    count: Number(l.qte_recue), exp: l.date_peremption || ''
  }));
  if (!lots.length) return { allowed: s.date_peremption && s.date_peremption >= localYMD() ? q : 0, expiry: s.date_peremption || '' };
  if (lots.some(l => !Number.isSafeInteger(l.count) || l.count < 0)) err(409, 'Quantité de lot invalide.');
  lots.sort((a,b) => (a.exp || '0000').localeCompare(b.exp || '0000'));
  // La consommation historique a été imputée au FEFO ; restent les derniers lots.
  let restant = q;
  for (let i = lots.length - 1; i >= 0; i--) {
    lots[i].available = Math.min(lots[i].count, restant);
    restant -= lots[i].available;
  }
  if (restant > 0) err(409, 'Stock sans lot traçable : corriger la fiche avant la vente.');
  const present = lots.filter(l => l.available > 0);
  if (present.some(l => !l.exp || l.exp < localYMD())) err(409, 'Un lot non daté ou périmé est encore en stock : retirer/mettre en quarantaine avant la vente.');
  return { allowed: q, expiry: present[0]?.exp || '' };
}
function localYMD() {
  // La péremption est une date civile : UTC peut être incorrect près de minuit.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}
function getRows(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 60) err(422, 'Lignes de médicaments invalides.');
  const map = new Map();
  for (const l of list) {
    const key = String(l.stock_key || '');
    if (!/^[-_A-Za-z0-9]{5,90}$/.test(key)) err(422, 'Identifiant médicament absent ou invalide.');
    const qte = positiveInteger(Number(l.qte), 'Quantité');
    if (qte > 100000) err(422, 'Quantité excessive.');
    if (map.has(key)) err(422, 'Médicament présent plusieurs fois : fusionner les lignes.');
    map.set(key, { key, qte, prix: l.prix });
  }
  return map;
}
function requireItemStock(stock, key) { const s = stock[key]; getValidStock(s, key); return s; }
function lineItems(rows, stock, role, canCustomPrice = false) {
  return [...rows.values()].map(l => {
    const s = requireItemStock(stock, l.key);
    const currentPrice = money(Number(s.prix_unitaire), 'Prix du médicament');
    const price = canCustomPrice && role === 'admin' ? money(Number(l.prix), 'Prix modifié') : currentPrice;
    return { nom: String(s.nom || '').slice(0, 180), prix: price, qte: l.qte, stock_key: l.key };
  });
}
function verifyPayment(amount, total) {
  money(Number(amount), 'Montant remis');
  if (Number(amount) < total) err(422, 'Montant remis insuffisant : enregistrement refusé.');
}
function buildStockDeltas(oldLines, newLines) {
  const deltas = new Map();
  for (const l of oldLines) deltas.set(l.stock_key, (deltas.get(l.stock_key) || 0) + Number(l.qte));
  for (const l of newLines) deltas.set(l.stock_key, (deltas.get(l.stock_key) || 0) - Number(l.qte));
  return deltas;
}
function applyStockDeltas(stock, deltas, updates) {
  for (const [key, delta] of deltas) {
    if (!delta) continue;
    const s = requireItemStock(stock, key);
    const old = getValidStock(s, key);
    const next = old + delta;
    if (!Number.isSafeInteger(next) || next < 0) err(409, `Stock insuffisant : ${s.nom || key}.`);
    if (delta < 0) {
      const { allowed } = qtyFromLots(s);
      if (-delta > allowed) err(409, `Stock délivrable insuffisant : ${s.nom || key}.`);
    }
    updates[`db_pharmacie_stock/${key}/quantite`] = next;
  }
}
function parseSavedLines(items, stock) {
  if (!Array.isArray(items) || !items.length) err(409, 'Vente ancienne sans lignes valides : rapprochement manuel requis.');
  return items.map(l => {
    if (!l.stock_key || !stock[l.stock_key]) err(409, 'Une ligne ne possède plus sa référence de stock : correction manuelle requise.');
    positiveInteger(Number(l.qte), 'Quantité historique');
    return l;
  });
}
async function withLock(db, fn) {
  const lock = db.ref('system_locks/pharmacie');
  const owner = crypto.randomUUID();
  const acquired = await lock.transaction(cur => {
    if (cur && Number(cur.expires) > Date.now()) return;
    return { owner, expires: Date.now() + 90000 };
  }, undefined, false);
  if (!acquired.committed) err(409, 'Une opération de pharmacie est en cours. Réessayer dans un instant.');
  try { return await fn(); }
  finally {
    try { await lock.transaction(cur => cur?.owner === owner ? null : undefined, undefined, false); }
    catch (e) { console.error('Libération du verrou échouée', e); }
  }
}
async function execute(db, action, body, user, role) {
  const id = String(body.operationId || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) err(422, 'Identifiant unique de commande manquant.');
  return withLock(db, async () => {
    const opRef = db.ref(`pharmacie_operations/${id}`);
    const prior = (await opRef.once('value')).val();
    if (prior) {
      if (prior.uid !== user.uid || prior.action !== action) err(409, 'Identifiant déjà utilisé pour une autre opération.');
      return { ok: true, deja: true, key: prior.vente_key, total: prior.total, avant:prior.avant, apres:prior.apres };
    }
    const stock = (await db.ref('db_pharmacie_stock').once('value')).val() || {};
    const updates = {};
    let key, total;
    if (action === 'reappro') {
      if (role !== 'admin') err(403, 'Réapprovisionnement réservé à l’administrateur.');
      key = String(body.key || '');
      if (!/^[-_A-Za-z0-9]{5,90}$/.test(key)) err(422, 'Référence de stock invalide.');
      const s = requireItemStock(stock, key);
      const avant = getValidStock(s, key);
      const qte = positiveInteger(Number(body.qte), 'Quantité ajoutée');
      const apres = avant + qte;
      if (!Number.isSafeInteger(apres)) err(422, 'Quantité totale trop élevée.');
      const date = String(body.date_peremption || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)
        err(422, 'Date de péremption invalide.');
      const numero = String(body.numero || '').slice(0, 90);
      const fournisseur = String(body.fournisseur || '').slice(0, 150);
      const dateReception = String(body.date_reception || localYMD());
      const prixAchat = Number(body.prix_achat || 0);
      money(prixAchat, 'Prix d’achat');
      const lots = { ...(s.lots || {}) };
      if (!Object.keys(lots).length && avant > 0) {
        lots[db.ref('db_pharmacie_stock').push().key] = {
          numero: s.lot || 'Stock initial', date_peremption: s.date_peremption || '',
          qte_recue: avant, fournisseur: s.source || '', date_reception: s.date_entree || '', initial:true,
          par: s.cree_par || '', ts: s.timestamp || Date.now()
        };
      }
      let lotId = Object.keys(lots).find(k => !lots[k].retire && numero && lots[k].numero === numero && lots[k].date_peremption === date);
      if (lotId) lots[lotId] = { ...lots[lotId], qte_recue: positiveInteger(Number(lots[lotId].qte_recue), 'Lot antérieur', true) + qte };
      else {
        lotId = db.ref('db_pharmacie_stock').push().key;
        lots[lotId] = { numero, date_peremption:date, qte_recue:qte, fournisseur,
          date_reception:dateReception, prix_achat:prixAchat, par:user.email || '', ts:Date.now() };
      }
      updates[`db_pharmacie_stock/${key}/quantite`] = apres;
      updates[`db_pharmacie_stock/${key}/lots`] = lots;
      if (prixAchat > 0) updates[`db_pharmacie_stock/${key}/prix_achat`] = prixAchat;
      updates[`db_pharmacie_stock/${key}/modifie_par`] = user.email || '';
      updates[`db_pharmacie_stock/${key}/modifie_le`] = Date.now();
      updates[`db_pharmacie_reappro/${db.ref('db_pharmacie_reappro').push().key}`] = {
        type:'reappro', med_id:key, nom_medicament:String(s.nom || '').slice(0,180), quantite_ajoutee:qte,
        ancienne_quantite:avant, nouvelle_quantite:apres, lot:numero || '—', lot_id:lotId,
        nouvelle_peremption:date, source:fournisseur, observations:String(body.obs || '').slice(0,500),
        date:dateReception, timestamp:Date.now(), par:user.email || '', operation_id:id
      };
      total = 0;
      updates[`pharmacie_operations/${id}`] = {uid:user.uid, action, vente_key:key, total:0, avant, apres, ts:Date.now()};
      await db.ref('/').update(updates);
      return {ok:true,key,avant,apres};
    }
    if (action === 'supprimer_ticket') {
      // Suppression d'un ticket de consultation saisi par erreur (administrateur).
      // Le ticket est déplacé dans la corbeille du village avant d'être retiré.
      if (role !== 'admin') err(403, 'Suppression réservée à l’administrateur.');
      const tkey = String(body.key || '');
      if (!/^[-_A-Za-z0-9]{8,80}$/.test(tkey)) err(422, 'Référence de ticket invalide.');
      const motif = String(body.motif || '').trim();
      if (motif.length < 3) err(422, 'Motif de suppression obligatoire.');
      const ticket = (await db.ref(`ticket_dbase/${tkey}`).once('value')).val();
      if (!ticket) err(404, 'Ticket introuvable.');
      updates[`corbeille/${db.ref('corbeille').push().key}`] = {
        type: 'ticket_dbase', ref: tkey, donnee: ticket,
        motif: motif.slice(0, 300), etait_annule: !!ticket.annule,
        supprime_par: user.email || '', supprime_uid: user.uid, supprime_ts: Date.now()
      };
      updates[`ticket_dbase/${tkey}`] = null;
      updates[`pharmacie_operations/${id}`] = { uid:user.uid, action, vente_key:tkey, total:0, ts:Date.now() };
      await db.ref('/').update(updates);
      return { ok:true, key:tkey };
    }
    if (action === 'encaisser') {
      const rows = getRows(body.medicaments);
      const lines = lineItems(rows, stock, role);
      for (const l of lines) {
        if (Number(rows.get(l.stock_key).prix) !== l.prix) err(409, `Le prix de ${l.nom} a changé : actualisez le panier avant encaissement.`);
      }
      total = lines.reduce((acc,l) => acc + l.prix * l.qte, 0);
      money(total, 'Total');
      verifyPayment(body.argent_remis, total);
      applyStockDeltas(stock, buildStockDeltas([], lines), updates);
      key = db.ref('vente_medicaments').push().key;
      const ts = allowedDate(Number(body.date_heure_ts));
      const d = new Date(ts);
      const patient = String(body.patient_nom || '').trim();
      if (!patient || patient.length > 180) err(422, 'Nom du patient invalide.');
      updates[`vente_medicaments/${key}`] = {
        patient_nom: patient, num_attente: String(body.num_attente || '—').slice(0, 40),
        medicaments: lines, total, argent_remis: Number(body.argent_remis),
        monnaie_rendue: Number(body.argent_remis) - total,
        date: d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar' }),
        heure: d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Dakar', hour: '2-digit', minute: '2-digit' }),
        date_heure_ts: ts, saisi_par: user.email || '', saisi_uid: user.uid,
        operation_id: id, cree_ts: Date.now(),
        ...(ts < Date.now() - 60000 ? { saisie_differee: true, saisie_le: Date.now() } : {})
      };
    } else {
      key = String(body.key || '');
      if (!/^[-_A-Za-z0-9]{8,80}$/.test(key)) err(422, 'Référence de vente invalide.');
      const sale = (await db.ref(`vente_medicaments/${key}`).once('value')).val();
      if (!sale) err(404, 'Vente introuvable.');
      const old = parseSavedLines(sale.medicaments, stock);
      if (action === 'annuler') {
        if (sale.annule) err(409, 'Cette vente est déjà annulée.');
        applyStockDeltas(stock, buildStockDeltas(old, []), updates);
        const detail = old.map(l => ({ nom:l.nom, qte:l.qte, stock_key:l.stock_key, ok:true }));
        updates[`vente_medicaments/${key}/annule`] = true;
        updates[`vente_medicaments/${key}/annule_ts`] = Date.now();
        updates[`vente_medicaments/${key}/annule_par`] = user.email || '';
        updates[`vente_medicaments/${key}/annule_motif`] = String(body.motif || '').slice(0, 200);
        updates[`vente_medicaments/${key}/annule_obs`] = String(body.obs || '').slice(0, 1000);
        updates[`vente_medicaments/${key}/retour_detail`] = detail;
        updates[`vente_medicaments/${key}/retour_stock_ok`] = detail.length;
        updates[`vente_medicaments/${key}/retour_stock_echec`] = [];
        total = Number(sale.total);
      } else if (action === 'restaurer') {
        if (role !== 'admin') err(403, 'Restauration réservée à l’administrateur.');
        if (!sale.annule) err(409, 'Cette vente est déjà active.');
        // Seules les quantités effectivement restituées sont retirées.
        const retour = (sale.retour_detail || old.map(l => ({...l, ok:true}))).filter(l => l.ok);
        parseSavedLines(retour, stock);
        applyStockDeltas(stock, buildStockDeltas([], retour), updates);
        updates[`vente_medicaments/${key}/annule`] = false;
        updates[`vente_medicaments/${key}/restaure_ts`] = Date.now();
        updates[`vente_medicaments/${key}/restaure_par`] = user.email || '';
        updates[`vente_medicaments/${key}/restaure_motif`] = String(body.motif || '').slice(0, 200);
        updates[`vente_medicaments/${key}/restaure_obs`] = String(body.obs || '').slice(0, 1000);
        total = Number(sale.total);
      } else if (action === 'modifier') {
        if (sale.annule) err(409, 'Impossible de modifier une vente annulée.');
        const rows = getRows(body.medicaments);
        const lines = lineItems(rows, stock, role, true);
        total = lines.reduce((acc,l) => acc + l.prix * l.qte, 0);
        money(total, 'Total');
        verifyPayment(sale.argent_remis, total);
        applyStockDeltas(stock, buildStockDeltas(old, lines), updates);
        const history = Array.isArray(sale.modifications) ? sale.modifications : Object.values(sale.modifications || {});
        updates[`vente_medicaments/${key}/medicaments`] = lines;
        updates[`vente_medicaments/${key}/total`] = total;
        updates[`vente_medicaments/${key}/monnaie_rendue`] = Number(sale.argent_remis) - total;
        updates[`vente_medicaments/${key}/modifie_ts`] = Date.now();
        updates[`vente_medicaments/${key}/modifie_par`] = user.email || '';
        updates[`vente_medicaments/${key}/modifications`] = [...history, {
          ts:Date.now(), par:user.email || '', motif: String(body.motif || '').slice(0,200),
          obs:String(body.obs || '').slice(0,1000), avant:old, apres:lines,
          avant_total:Number(sale.total), apres_total:total
        }];
        if (body.date_heure_ts != null) {
          if (role !== 'admin') err(403, 'Date historique modifiable uniquement par admin.');
          const ts = allowedDate(Number(body.date_heure_ts));
          const d = new Date(ts);
          updates[`vente_medicaments/${key}/date_heure_ts`] = ts;
          updates[`vente_medicaments/${key}/date`] = d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar' });
          updates[`vente_medicaments/${key}/heure`] = d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Dakar', hour:'2-digit', minute:'2-digit' });
        }
      } else if (action === 'supprimer') {
        // Suppression définitive d'une vente saisie par erreur. Réservée à l'administrateur
        // (le caissier dispose de l'annulation, qui laisse une trace vérifiable).
        if (role !== 'admin') err(403, 'Suppression réservée à l’administrateur.');
        const motif = String(body.motif || '').trim();
        if (motif.length < 3) err(422, 'Motif de suppression obligatoire.');
        // Vente encore active : on restitue d'abord le stock, comme à l'annulation.
        if (!sale.annule) applyStockDeltas(stock, buildStockDeltas(old, []), updates);
        // Déplacée dans la corbeille du village avant retrait (restauration possible).
        updates[`corbeille/${db.ref('corbeille').push().key}`] = {
          type:'vente_medicaments', ref:key, donnee:sale,
          motif:motif.slice(0,300), etait_annule:!!sale.annule,
          supprime_par:user.email || '', supprime_uid:user.uid, supprime_ts:Date.now()
        };
        updates[`vente_medicaments/${key}`] = null; // retiré de la liste active
        total = Number(sale.total) || 0;
      }
    }
    updates[`pharmacie_operations/${id}`] = { uid:user.uid, action, vente_key:key, total, ts:Date.now() };
    await db.ref('/').update(updates); // commit multi-chemins ATOMIQUE (pas de mise à jour partielle).
    return { ok:true, key, total };
  });
}
module.exports = async (req,res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Méthode non autorisée.' });
  try {
    init();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) err(401, 'Session expirée : reconnectez-vous.');
    const user = await getAuth().verifyIdToken(m[1], true).catch(() => err(401, 'Session invalide.'));
    const { db: villageDb, role } = await identifierVillage(getDatabase(),user,['admin','caissier']);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = String(body.action || '');
    if (!OPS.has(action)) err(422, 'Action non reconnue.');
    return res.status(200).json(await execute(villageDb,action,body,user,role));
  } catch (e) {
    console.error('[pharmacie]', e);
    return res.status(e.status || 500).json({ error:e.status ? e.message : 'Erreur serveur : opération non confirmée, réessayer avec le même identifiant.' });
  }
};
module.exports._testing = { getRows, applyStockDeltas, buildStockDeltas, qtyFromLots, positiveInteger };
