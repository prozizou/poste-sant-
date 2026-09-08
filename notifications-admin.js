// ═══════════════════════════════════════════════════════════════════════
//  notifications-admin.js — Notifications caisse en temps réel (admin)
//  Poste de Santé de Diandioly
//
//  Dès qu'un(e) caissier(ère) encaisse un ticket de consultation ou une
//  vente de médicaments (voir facturation/script.js), une entrée est écrite
//  dans le nœud RTDB "notifications_caisse". Ce module, importé sur les
//  pages administrateur, écoute ce nœud en temps réel et :
//    1. Affiche une cloche avec compteur dans la barre de navigation
//       (panneau déroulant listant les dernières opérations de caisse) ;
//    2. Déclenche, tant que l'application est ouverte (onglet actif ou
//       arrière-plan — équivalent web d'un « foreground service »), une
//       notification système via le Service Worker, avec un bouton d'action
//       « Annuler et retourner » qui ouvre directement la fiche d'annulation
//       correspondante.
//
//  N'active rien pour un(e) caissier(ère) : les notifications de caisse ne
//  concernent que l'administration.
// ═══════════════════════════════════════════════════════════════════════

import { app, db, auth } from './firebase-config.js';
import { ref, query, orderByChild, limitToLast, onValue, update }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// firebase-messaging.js est chargé dynamiquement (voir activerNotificationsAppFermee)
// et non importé ici statiquement : un import statique qui échoue (réseau,
// domaine bloqué, navigateur non supporté) ferait échouer TOUT ce module —
// y compris la cloche/le panneau temps réel, qui eux fonctionnent partout.

// ⚠️ À renseigner avant que les notifications « application fermée »
// fonctionnent : Firebase Console → ⚙️ Paramètres du projet → onglet
// Cloud Messaging → section « Certificats Web Push » → Générer une paire
// de clés. Colle ici la clé publique générée (une longue chaîne unique).
// Tant que cette valeur n'est pas remplacée, le reste de l'app continue
// de fonctionner normalement (seule cette fonctionnalité reste inactive).
const VAPID_KEY = 'REMPLACE_PAR_TA_CLE_VAPID_PUBLIQUE';

const ICON_BELL = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const ICON_TICKET = '<svg class="icon" viewBox="0 0 24 24"><path d="M2 9a3 3 0 1 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>';
const ICON_MED    = '<svg class="icon" viewBox="0 0 24 24"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>';
const ICON_UNDO    = '<svg class="icon" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';
const ICON_CHECK   = '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}
function fcfa(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA'; }
function tempsEcoule(ts) {
    const diff = Date.now() - ts;
    if (diff < 45000) return "à l'instant";
    const min = Math.floor(diff / 60000);
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const j = Math.floor(h / 24);
    return `il y a ${j} j`;
}

let injected = false;
function injectStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
        .ncx-btn{position:relative;}
        .ncx-badge{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:#e74c3c;color:#fff;font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px var(--primary,#1a3a5c);}
        .ncx-panel{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-width:92vw;background:#fff;border:1px solid #d8e0e8;border-radius:12px;box-shadow:0 12px 32px rgba(20,30,45,.2);z-index:800;display:none;overflow:hidden;color:#1e2a38;font-family:'Plus Jakarta Sans',sans-serif;}
        .ncx-panel.open{display:block;}
        .ncx-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eef1f4;}
        .ncx-head h4{font-size:.85rem;font-weight:800;color:#1a3a5c;}
        .ncx-head button{background:none;border:none;font-family:inherit;font-size:.72rem;font-weight:700;color:#1a3a5c;cursor:pointer;text-decoration:underline;}
        .ncx-list{max-height:420px;overflow-y:auto;}
        .ncx-empty{padding:26px 16px;text-align:center;font-size:.8rem;color:#6b7a8d;}
        .ncx-item{padding:11px 14px;border-bottom:1px solid #f3f5f7;display:flex;gap:10px;align-items:flex-start;}
        .ncx-item.unread{background:#eaf0f6;}
        .ncx-item-icon{width:32px;height:32px;border-radius:9px;background:#eaf0f6;color:#1a3a5c;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
        .ncx-item-icon .icon{width:1.05em;height:1.05em;}
        .ncx-item.med .ncx-item-icon{background:#fdf1f0;color:#c0392b;}
        .ncx-item-body{flex:1;min-width:0;}
        .ncx-item-top{display:flex;justify-content:space-between;gap:8px;}
        .ncx-item-nom{font-size:.83rem;font-weight:700;color:#1e2a38;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .ncx-item-montant{font-size:.83rem;font-weight:800;color:#1a3a5c;white-space:nowrap;}
        .ncx-item-detail{font-size:.74rem;color:#6b7a8d;margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
        .ncx-item-meta{font-size:.68rem;color:#8a97a8;margin-top:4px;}
        .ncx-item-actions{display:flex;gap:6px;margin-top:8px;}
        .ncx-item-actions button{font-family:inherit;font-size:.72rem;font-weight:700;border-radius:7px;padding:6px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;border:none;white-space:nowrap;}
        .ncx-item-actions button .icon{width:.95em;height:.95em;}
        .ncx-btn-annuler{background:#fdf1f0;color:#c0392b;}
        .ncx-btn-annuler:hover{background:#c0392b;color:#fff;}
        .ncx-btn-lu{background:#f4f6f8;color:#6b7a8d;}
        .ncx-btn-lu:hover{background:#e6f7f1;color:#0b7d54;}
        ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px;}
    `;
    document.head.appendChild(style);
}

function buildUI(insertParent, insertBefore) {
    injectStyles();
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';
    wrap.innerHTML = `
        <button type="button" class="icon-btn ncx-btn" id="ncx-bell-btn" title="Notifications caisse" aria-label="Notifications caisse">
            ${ICON_BELL}<span class="ncx-badge" id="ncx-badge" hidden>0</span>
        </button>
        <div class="ncx-panel" id="ncx-panel">
            <div class="ncx-head">
                <h4>Notifications caisse</h4>
                <button type="button" id="ncx-tout-lu">Tout marquer lu</button>
            </div>
            <div class="ncx-list" id="ncx-list"><div class="ncx-empty">Aucune notification pour le moment.</div></div>
        </div>
    `;
    insertParent.insertBefore(wrap, insertBefore || null);

    const btn   = wrap.querySelector('#ncx-bell-btn');
    const panel = wrap.querySelector('#ncx-panel');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) panel.classList.remove('open');
    });
    return wrap;
}

export function initNotifCaisseAdmin() {
    onAuthStateChanged(auth, (user) => {
        if (!user) return;
        const role = sessionStorage.getItem('userRole') || localStorage.getItem('savedRole') || '';
        if (role !== 'admin') return; // notifications réservées à l'administration
        demarrer(user.email || '', user.uid);
    });
}

// ── Abonnement push « application fermée » ──────────────────────────────
// Enregistre un jeton FCM lié à cet appareil/navigateur dans le nœud
// "fcm_tokens_admin". Un Cloudflare Worker (voir cloudflare-worker/) lit ce
// nœud pour envoyer une vraie notification push (barre de statut du
// téléphone) à chaque nouvelle entrée de "notifications_caisse" — cela
// fonctionne même si l'application est totalement fermée, contrairement au
// chemin temps réel ci-dessous qui exige que le Service Worker soit encore
// actif en mémoire.
async function activerNotificationsAppFermee(monEmail, monUid) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!VAPID_KEY || VAPID_KEY.startsWith('REMPLACE_')) {
        console.warn('[notif] Clé VAPID non configurée — notifications « application fermée » désactivées pour le moment.');
        return;
    }
    try {
        const reg = await navigator.serviceWorker.ready;
        const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
        if (!token) return;
        // Le jeton sert de base à la clé RTDB (un jeton = un appareil, pas de
        // doublon en se reconnectant) — on neutralise les rares caractères
        // interdits par Firebase dans une clé ('.', '#', '$', '[', ']', '/').
        // Le jeton exact est aussi stocké comme champ "token" : c'est LUI que
        // le Cloudflare Worker utilise pour l'envoi FCM (la clé n'est qu'un
        // identifiant d'entrée, pas forcément identique au jeton d'origine).
        const cle = token.replace(/[.#$[\]/]/g, '_');
        await update(ref(db, 'fcm_tokens_admin/' + cle), {
            token, email: monEmail, uid: monUid || null, ts: Date.now(), ua: navigator.userAgent.slice(0, 120),
        });
    } catch (e) {
        console.warn('[notif] Abonnement push (application fermée) impossible :', e?.message || e);
    }
}

function demarrer(monEmail, monUid) {
    // Cible en priorité la zone d'actions de la topbar (".topbar-right"),
    // où la cloche s'insère en premier élément (avant conn-badge / menu).
    // À défaut (page sans ".topbar-right", ex. menu_admin.html), on
    // l'insère juste avant le bouton menu (".menu-wrap"), en conservant
    // celui-ci comme dernier élément de la barre.
    const topbarRight = document.querySelector('.topbar-right');
    const menuWrap = document.querySelector('.menu-wrap');
    let insertParent, insertBefore;
    if (topbarRight) { insertParent = topbarRight; insertBefore = topbarRight.firstChild; }
    else if (menuWrap && menuWrap.parentElement) { insertParent = menuWrap.parentElement; insertBefore = menuWrap; }
    else return;

    const wrap = buildUI(insertParent, insertBefore);
    const listEl  = wrap.querySelector('#ncx-list');
    const badgeEl = wrap.querySelector('#ncx-badge');
    const panel   = wrap.querySelector('#ncx-panel');

    // Demande la permission de notification système une seule fois, sans bloquer,
    // puis abonne l'appareil au push « application fermée » si accordée.
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            activerNotificationsAppFermee(monEmail, monUid);
        } else if (Notification.permission === 'default') {
            // Laisse l'utilisateur voir l'écran avant de solliciter la permission.
            setTimeout(() => {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') activerNotificationsAppFermee(monEmail, monUid);
                }).catch(() => {});
            }, 1500);
        }
    }

    const sessionStartTs = Date.now();
    let ready = false;
    const seenKeys = new Set();
    let items = []; // { key, ...data }

    const notifRef = query(ref(db, 'notifications_caisse'), orderByChild('ts'), limitToLast(40));
    onValue(notifRef, (snap) => {
        const fresh = [];
        snap.forEach((c) => {
            const d = c.val();
            fresh.push({ key: c.key, ...d });
            if (ready && !seenKeys.has(c.key) && d.ts >= sessionStartTs && d.caissier_email !== monEmail) {
                notifierSysteme(d, c.key);
            }
            seenKeys.add(c.key);
        });
        fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        items = fresh;
        render();
        ready = true;
    });

    function render() {
        const nonLues = items.filter(n => !n.lu && n.caissier_email !== monEmail).length;
        if (nonLues > 0) { badgeEl.hidden = false; badgeEl.textContent = nonLues > 9 ? '9+' : String(nonLues); }
        else badgeEl.hidden = true;

        if (!items.length) { listEl.innerHTML = '<div class="ncx-empty">Aucune notification pour le moment.</div>'; return; }

        listEl.innerHTML = items.map(n => {
            const nonLu = !n.lu && n.caissier_email !== monEmail;
            const caissier = (n.caissier_email || '').split('@')[0] || '—';
            return `
            <div class="ncx-item ${n.type === 'med' ? 'med' : ''} ${nonLu ? 'unread' : ''}">
                <div class="ncx-item-icon">${n.type === 'med' ? ICON_MED : ICON_TICKET}</div>
                <div class="ncx-item-body">
                    <div class="ncx-item-top">
                        <span class="ncx-item-nom">${esc(n.patient_nom || '—')}</span>
                        <span class="ncx-item-montant">${esc(fcfa(n.montant))}</span>
                    </div>
                    <div class="ncx-item-detail">${esc(n.detail || '—')}</div>
                    <div class="ncx-item-meta">${n.type === 'med' ? 'Vente médicaments' : 'Ticket consultation'} · ${esc(tempsEcoule(n.ts))} · par ${esc(caissier)}</div>
                    <div class="ncx-item-actions">
                        <button type="button" class="ncx-btn-annuler" data-act="annuler" data-type="${n.type}" data-key="${esc(n.ref_key)}" data-nkey="${esc(n.key)}">${ICON_UNDO}Annuler et retourner</button>
                        ${nonLu ? `<button type="button" class="ncx-btn-lu" data-act="lu" data-nkey="${esc(n.key)}">${ICON_CHECK}Marquer lu</button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        listEl.querySelectorAll('[data-act="annuler"]').forEach(b => b.addEventListener('click', () => {
            marquerLu(b.dataset.nkey);
            window.location.href = `../annulation/annulation.html?annuler=${encodeURIComponent(b.dataset.type)}&key=${encodeURIComponent(b.dataset.key)}`;
        }));
        listEl.querySelectorAll('[data-act="lu"]').forEach(b => b.addEventListener('click', () => marquerLu(b.dataset.nkey)));
    }

    function marquerLu(nkey) {
        if (!nkey) return;
        update(ref(db, 'notifications_caisse/' + nkey), { lu: true }).catch(() => {});
    }

    wrap.querySelector('#ncx-tout-lu').addEventListener('click', () => {
        items.forEach(n => { if (!n.lu && n.caissier_email !== monEmail) marquerLu(n.key); });
    });

    // ── Notification système (Service Worker) ──────────────────────────
    // Fonctionne tant que l'application (ou son Service Worker) est active —
    // équivalent web d'un « foreground service » : pas besoin que l'onglet
    // Admin soit au premier plan pour que la notification s'affiche.
    function notifierSysteme(n, nkey) {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        const titre = n.type === 'med' ? '💊 Vente de médicaments encaissée' : '🎫 Ticket de consultation encaissé';
        const corps = `${n.patient_nom || 'Patient'} · ${fcfa(n.montant)}\n${n.detail || ''}`;
        navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification(titre, {
                body: corps,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-96x96.png',
                tag: 'caisse-' + nkey,
                data: { type: n.type, key: n.ref_key, nkey },
                actions: [
                    { action: 'annuler', title: 'Annuler et retourner' },
                    { action: 'voir',    title: 'Voir le détail' },
                ],
            }).catch(() => {});
        }).catch(() => {});
    }
}
