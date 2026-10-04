// ═══════════════════════════════════════════════════════════════════════
//  notifications-admin.js — Notifications push caisse (administration)
//  Poste de Santé de Diandioly
//
//  Chaque opération d'un(e) caissier(ère) — encaissement d'un ticket ou
//  d'une vente de médicaments, annulation, modification d'une vente — écrit
//  une entrée dans le nœud RTDB "notifications_caisse" (voir
//  facturation/script.js). L'administration en est avertie par une
//  notification système, sans cloche ni panneau dans l'interface :
//
//    1. Push Web (VAPID / Firebase Cloud Messaging) — ce module enregistre
//       le jeton de l'appareil dans "fcm_tokens_admin" ; la Cloud Function
//       (functions/index.js) envoie alors un push à chaque nouvelle entrée,
//       affiché par le Service Worker (sw.js) même application fermée.
//    2. Application ouverte — FCM ne réveille pas le Service Worker quand
//       une page de l'app est au premier plan : ce module écoute donc aussi
//       "notifications_caisse" et affiche la même notification. Le même
//       "tag" évite tout doublon si les deux chemins se déclenchent.
//
//  N'active rien pour un(e) caissier(ère) : réservé à l'administration.
// ═══════════════════════════════════════════════════════════════════════

import { app, db, auth } from './firebase-config.js';
import { ref, query, orderByChild, startAt, onValue, update }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// firebase-messaging.js est chargé dynamiquement : un import statique qui
// échoue (réseau, navigateur non supporté) ferait échouer tout le module.

// Clé publique VAPID (Firebase Console → Paramètres du projet → Cloud
// Messaging → Certificats Web Push).
const VAPID_KEY = 'BGMhZ7XD4n7XAzfZd1JqMsS5ORZneRD7fzvCnJ23EJSHcxHuryzRr07hPAAqcn-MFVJr_IZSpPZPFg58Cv2iV8Q';

function fcfa(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA'; }

// Titre / texte d'une notification — même rendu que la Cloud Function
// (functions/index.js), pour un affichage identique app ouverte ou fermée.
export function contenuNotification(n) {
    const caissier = (n.caissier_email || '').split('@')[0] || 'Caisse';
    const quoi = n.type === 'med' ? 'Vente de médicaments' : 'Ticket de consultation';
    let titre;
    if (n.action === 'annulation')        titre = `❌ ${quoi} annulé${n.type === 'med' ? 'e' : ''}`;
    else if (n.action === 'modification') titre = `✏️ ${quoi} modifié${n.type === 'med' ? 'e' : ''}`;
    else titre = n.type === 'med' ? '💊 Vente de médicaments encaissée' : '🎫 Ticket de consultation encaissé';
    const corps = `Par ${caissier} · ${n.patient_nom || 'Patient'} · ${fcfa(n.montant)}` + (n.detail ? `\n${n.detail}` : '');
    return { titre, corps };
}

export function initNotifCaisseAdmin() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;
        const role = sessionStorage.getItem('userRole') || localStorage.getItem('savedRole') || '';
        if (role !== 'admin') return;
        demarrer(user.email || '', user.uid);
    });
}

// ── Abonnement Push Web (VAPID) ─────────────────────────────────────────
// Un jeton = un appareil/navigateur : la clé RTDB dérive du jeton, donc pas
// de doublon en se reconnectant. Le jeton exact est stocké dans "token".
async function abonnerPush(monEmail, monUid) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
        const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
        if (!token) return;
        const cle = token.replace(/[.#$[\]/]/g, '_');
        await update(ref(db, 'fcm_tokens_admin/' + cle), {
            token, email: monEmail, uid: monUid || null, ts: Date.now(), ua: navigator.userAgent.slice(0, 120),
        });
    } catch (e) {
        console.warn('[notif] Abonnement push impossible :', e?.message || e);
    }
}

function demarrer(monEmail, monUid) {
    // Permission : demandée au premier geste de l'utilisateur (les
    // navigateurs ignorent ou masquent une demande faite sans interaction).
    if ('Notification' in window) {
        if (Notification.permission === 'granted') abonnerPush(monEmail, monUid);
        else if (Notification.permission === 'default') {
            const demander = () => {
                Notification.requestPermission()
                    .then(p => { if (p === 'granted') abonnerPush(monEmail, monUid); })
                    .catch(() => {});
            };
            document.addEventListener('click', demander, { once: true, capture: true });
        }
    }

    // Application ouverte : seules les opérations postérieures à
    // l'ouverture de la page sont notifiées.
    const depuis = Date.now();
    const vus = new Set();
    onValue(query(ref(db, 'notifications_caisse'), orderByChild('ts'), startAt(depuis)), (snap) => {
        snap.forEach((c) => {
            if (vus.has(c.key)) return;
            vus.add(c.key);
            const n = c.val();
            if (n && n.caissier_email !== monEmail) afficher(n, c.key);
        });
    });
}

function afficher(n, nkey) {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const { titre, corps } = contenuNotification(n);
    const actions = n.action === 'annulation'
        ? [{ action: 'voir', title: 'Voir le détail' }]
        : [{ action: 'annuler', title: 'Annuler et retourner' }, { action: 'voir', title: 'Voir le détail' }];
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(titre, {
        body: corps,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: 'caisse-' + nkey,
        data: { type: n.type, key: n.ref_key, nkey },
        actions,
    })).catch(() => {});
}
