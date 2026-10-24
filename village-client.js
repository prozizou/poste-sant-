// Isolation multi-villages : le contexte vient UNIQUEMENT du compte Firebase.
// Aucune requête métier n'est autorisée tant que l'affectation n'a pas été vérifiée.
import { auth, db } from './firebase-config.js';
import { ref, get, onValue } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';

const ROLES = new Set(['superadmin','admin', 'caissier', 'tresorier', 'icp']);
const ID_OK = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
let contexte = null;
let pending = null;

function userConnecte() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); }, () => { stop(); resolve(null); });
  });
}

export async function villagePourUtilisateur(user) {
  if (!user || auth.currentUser?.uid !== user.uid) return null;
  const snap = await get(ref(db, `db_users/${user.uid}`));
  const fiche = snap.val();
  if (fiche?.active === false) return null;
  if (fiche?.role === 'superadmin') {
    if ((user.email||'').toLowerCase() !== 'prozizou298@gmail.com') return null;
    const ownerSnap = await get(ref(db, `superadmins/${user.uid}`));
    const owner = ownerSnap.val();
    if (owner?.active !== true || owner.email !== 'prozizou298@gmail.com' || auth.currentUser?.uid !== user.uid) return null;
    contexte = { id:null, nom:'Tous les villages', role:'superadmin', uid:user.uid };
    sessionStorage.setItem('userRole','superadmin');
    sessionStorage.removeItem('villageId');
    sessionStorage.removeItem('villageNom');
    return contexte;
  }
  const id = fiche?.village_id;
  if (!fiche || !ROLES.has(fiche.role) || typeof id !== 'string' || !ID_OK.test(id)) return null;
  const metaSnap = await get(ref(db, `villages_registry/${id}`));
  const meta = metaSnap.val();
  if (meta?.active !== true || typeof meta.nom !== 'string' || !meta.nom.trim()) return null;
  // Une réponse périmée d'un autre compte ne doit pas installer son contexte.
  if (auth.currentUser?.uid !== user.uid) return null;
  contexte = { id, nom: meta.nom.trim().slice(0,100), role: fiche.role, uid: user.uid };
  sessionStorage.setItem('villageId', id);
  sessionStorage.setItem('villageNom', contexte.nom);
  sessionStorage.setItem('userRole', fiche.role);
  return contexte;
}

export function villageActuel() {
  if (contexte && auth.currentUser?.uid === contexte.uid) return contexte;
  return null;
}

export async function chargerVillage() {
  if (villageActuel()) { afficherVillage(); return contexte; }
  if (pending) return pending;
  pending = (async () => {
    const user = await userConnecte();
    const ctx = user && await villagePourUtilisateur(user);
    if (!ctx) {
      contexte = null;
      sessionStorage.removeItem('villageId');
      sessionStorage.removeItem('villageNom');
      if (!location.pathname.endsWith('/index.html') && location.pathname !== '/') {
        location.replace(new URL('/index.html', location.origin));
      }
      throw new Error('Affectation à un village absente ou inaccessible : contacter l’administrateur.');
    }
    afficherVillage();
    return ctx;
  })();
  try { return await pending; } finally { pending = null; }
}

// Ne jamais prendre un village fourni par une URL, un formulaire ou le localStorage.
export function villageRef(database, chemin) {
  const ctx = villageActuel();
  if (!ctx?.id) throw new Error('Sélection de village interdite depuis ce module : accès réservé aux agents locaux.');
  const path = String(chemin || '').replace(/^\/+|\/+$/g, '');
  if (!path || path.startsWith('villages/') || path.includes('..') || path.includes('//')) {
    throw new Error('Chemin Firebase non autorisé.');
  }
  return ref(database, `villages/${ctx.id}/${path}`);
}

function afficherVillage() {
  if (typeof document === 'undefined' || !villageActuel()) return;
  const render = () => {
    if (document.getElementById('village-identite')) return;
    const node = document.createElement('div');
    node.id = 'village-identite';
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:relative;z-index:50;padding:7px 14px;background:#eef5fb;color:#15416c;border-bottom:1px solid #bdd5e9;font:600 12px/1.5 system-ui;text-align:center';
    node.textContent = `Poste de santé — ${contexte.nom}`;
    document.body.prepend(node);
    document.title = document.title.replace(/Poste de Santé de Diandioly/gi, `Poste de santé de ${contexte.nom}`);
  };
  if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once:true });
}

let arreterSurveillance = null;
onAuthStateChanged(auth, u => {
  if (arreterSurveillance) { arreterSurveillance(); arreterSurveillance = null; }
  if (u) {
    arreterSurveillance = onValue(ref(db, `db_users/${u.uid}`), snapshot => {
      const data = snapshot.val();
      if (data?.active === false) {
        contexte = null;
        sessionStorage.removeItem('userRole');
        signOut(auth).then(() => { if(location.pathname!=='/' && !location.pathname.endsWith('/index.html')) location.replace('/index.html'); });
      } else if (contexte && (contexte.role !== data?.role || (contexte.role !== 'superadmin' && contexte.id !== data?.village_id))) {
        contexte = null;
        if(location.pathname!=='/' && !location.pathname.endsWith('/index.html')) location.replace('/index.html');
      }
    }, () => { contexte = null; });
  }

  if (!u || (contexte && contexte.uid !== u.uid)) {
    contexte = null;
    sessionStorage.removeItem('villageId');
    sessionStorage.removeItem('villageNom');
  }
});
