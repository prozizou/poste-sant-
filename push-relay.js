// ═══════════════════════════════════════════════════════════════════════
//  push-relay.js — Envoi des notifications push à l'administration,
//  avec renvoi automatique
//  Poste de Santé de Diandioly
//
//  Après chaque opération de caisse, facturation/script.js écrit une
//  entrée dans "notifications_caisse" puis appelle signalerPush(clé).
//  La clé est mise en file d'attente (localStorage, survit à la fermeture
//  de l'application) et transmise à la fonction Vercel api/notifier.js,
//  qui envoie le push FCM aux appareils admin.
//
//  Renvoi automatique : tant que la fonction n'a pas confirmé l'envoi,
//  la clé reste en file et est retentée au retour du réseau, à chaque
//  ouverture de l'application et toutes les minutes. La fonction ignore
//  une entrée déjà envoyée : un renvoi ne crée jamais de doublon.
// ═══════════════════════════════════════════════════════════════════════

import { auth } from './firebase-config.js';
import { villageActuel, chargerVillage } from './village-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Même domaine quand l'application est servie par Vercel ; adresse
// complète sinon (ex. ouverte depuis un autre hébergement).
const URL_RELAIS = location.hostname.endsWith('.vercel.app')
    ? '/api/notifier'
    : 'https://poste-health.vercel.app/api/notifier';
const CLE_FILE = 'notif_push_file'; // ancien nom, conservé sans lecture pour éviter les notifications inter-villages
function cleFile() {
    const c = villageActuel();
    return c ? `notif_push_file:${c.id}:${c.uid}` : null;
}
const AGE_MAX = 7 * 24 * 3600 * 1000;   // au-delà, l'alerte n'a plus d'intérêt
const INTERVALLE = 60 * 1000;

function lire() {
    const cle = cleFile();
    if (!cle) return [];
    try { return JSON.parse(localStorage.getItem(cle) || '[]'); } catch { return []; }
}
function ecrire(file) {
    const cle = cleFile();
    if (!cle) return;
    try { localStorage.setItem(cle, JSON.stringify(file)); } catch {}
}
function retirer(nkey) { ecrire(lire().filter(x => x.nkey !== nkey)); }

export function signalerPush(nkey) {
    if (!nkey) return;
    const file = lire();
    if (!file.some(x => x.nkey === nkey)) { file.push({ nkey, ts: Date.now() }); ecrire(file); }
    viderFile();
}

let enCours = false;
export async function viderFile() {
    if (enCours || !navigator.onLine) return;
    try { await chargerVillage(); } catch { return; }
    const user = auth.currentUser;
    if (!user || !lire().length) return;
    enCours = true;
    try {
        const jeton = await user.getIdToken();
        for (const item of lire()) {
            if (Date.now() - item.ts > AGE_MAX) { retirer(item.nkey); continue; }
            let r;
            try {
                r = await fetch(URL_RELAIS, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
                    body: JSON.stringify({ nkey: item.nkey }),
                });
            } catch { break; }   // réseau indisponible : on réessaiera plus tard
            // 2xx : envoyé (ou déjà envoyé). 400/403 : refus définitif.
            // 404 (entrée pas encore synchronisée), 401, 5xx : nouvel essai.
            if (r.ok || r.status === 400 || r.status === 403) retirer(item.nkey);
        }
    } catch (e) {
        console.warn('[push] file non vidée :', e?.message || e);
    } finally {
        enCours = false;
    }
}

window.addEventListener('online', viderFile);
setInterval(viderFile, INTERVALLE);
onAuthStateChanged(auth, (u) => { if (u) viderFile(); });
