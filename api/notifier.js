// ═══════════════════════════════════════════════════════════════════════
//  api/notifier.js — Relais de notifications push (Vercel, gratuit)
//  Poste de Santé de Diandioly
//
//  Remplace la Cloud Function (functions/index.js), qui exige le forfait
//  Firebase Blaze. L'application du/de la caissier(ère) appelle ce point
//  d'accès juste après avoir écrit une entrée dans "notifications_caisse"
//  (voir push-relay.js) ; la fonction envoie alors un push FCM — gratuit sur
//  le forfait Spark — à chaque appareil admin enregistré dans
//  "fcm_tokens_admin". Affiché par sw.js, même application fermée.
//
//  Sécurité :
//    • l'appel doit porter le jeton d'identification Firebase de
//      l'utilisateur connecté (Authorization: Bearer …) ;
//    • son rôle (db_users) doit être caissier ou admin ;
//    • seul le contenu stocké en base est envoyé (jamais le corps de la
//      requête), et uniquement pour une entrée créée par ce même compte ;
//    • chaque entrée n'est envoyée qu'une fois (champ push_ts), les
//      renvois automatiques de l'application ne créent donc pas de doublon.
//
//  Variables d'environnement (Vercel → Project → Settings → Environment
//  Variables) :
//    FIREBASE_SERVICE_ACCOUNT  JSON complet de la clé du compte de service
//                              (Firebase Console → Paramètres du projet →
//                              Comptes de service → Générer une clé privée)
//    FIREBASE_DATABASE_URL     facultatif (valeur par défaut ci-dessous)
// ═══════════════════════════════════════════════════════════════════════

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';
const ROLES_AUTORISES = ['caissier', 'admin'];

function initFirebase() {
    if (getApps().length) return true;
    const brut = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!brut) return false;
    initializeApp({ credential: cert(JSON.parse(brut)), databaseURL: DATABASE_URL });
    return true;
}

// Même rendu que notifications-admin.js (contenuNotification).
function contenu(n) {
    const caissier = (n.caissier_email || '').split('@')[0] || 'Caisse';
    const quoi = n.type === 'med' ? 'Vente de médicaments' : 'Ticket de consultation';
    let titre;
    if (n.action === 'annulation')        titre = `❌ ${quoi} annulé${n.type === 'med' ? 'e' : ''}`;
    else if (n.action === 'modification') titre = `✏️ ${quoi} modifié${n.type === 'med' ? 'e' : ''}`;
    else titre = n.type === 'med' ? '💊 Vente de médicaments encaissée' : '🎫 Ticket de consultation encaissé';
    const montant = Number(n.montant || 0).toLocaleString('fr-FR') + ' FCFA';
    const corps = `Par ${caissier} · ${n.patient_nom || 'Patient'} · ${montant}` + (n.detail ? `\n${n.detail}` : '');
    return { titre, corps };
}

module.exports = async (req, res) => {
    // Appel depuis l'application (autre domaine) : CORS ouvert, la sécurité
    // repose sur le jeton Firebase, pas sur l'origine.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    // Page d'état : indique si la clé est présente ET acceptée par Google
    // (aucune donnée n'est exposée).
    if (req.method === 'GET') {
        let cleValide = false;
        try { if (initFirebase()) cleValide = !!(await getApps()[0].options.credential.getAccessToken()).access_token; } catch {}
        return res.status(200).json({ ok: true, service: 'notifier', configure: !!process.env.FIREBASE_SERVICE_ACCOUNT, cle_valide: cleValide });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    try {
        if (!initFirebase()) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT manquant' });

        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (!m) return res.status(401).json({ error: 'jeton manquant' });
        let user;
        try { user = await getAuth().verifyIdToken(m[1]); }
        catch { return res.status(401).json({ error: 'jeton invalide' }); }

        const db = getDatabase();
        const role = (await db.ref(`db_users/${user.uid}/role`).once('value')).val();
        if (!ROLES_AUTORISES.includes(role)) return res.status(403).json({ error: 'rôle non autorisé' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const nkey = String(body.nkey || '');
        if (!/^[-_A-Za-z0-9]{8,40}$/.test(nkey)) return res.status(400).json({ error: 'nkey invalide' });

        const nRef = db.ref('notifications_caisse/' + nkey);
        const n = (await nRef.once('value')).val();
        // Entrée pas encore synchronisée (opération faite hors-ligne) : 404,
        // l'application réessaiera plus tard.
        if (!n) return res.status(404).json({ error: 'entrée introuvable' });
        if ((n.caissier_email || '') !== (user.email || '')) return res.status(403).json({ error: 'entrée d\'un autre compte' });
        if (n.push_ts) return res.status(200).json({ ok: true, deja: true });

        const tokens = (await db.ref('fcm_tokens_admin').once('value')).val() || {};
        const cibles = Object.entries(tokens)
            .map(([cle, meta]) => ({ cle, token: (meta && meta.token) || cle, meta }))
            .filter(({ token, meta }) => token && !(meta && meta.email && meta.email === n.caissier_email));

        let envoyes = 0, retires = 0;
        if (cibles.length) {
            const { titre, corps } = contenu(n);
            const resp = await getMessaging().sendEach(cibles.map(({ token }) => ({
                token,
                // Message « data-only » : sw.js construit la notification.
                data: {
                    title: titre, body: corps,
                    type: n.type || '', action: n.action || 'encaissement',
                    key: n.ref_key || '', nkey, tag: 'caisse-' + nkey,
                },
                webpush: { headers: { Urgency: 'high', TTL: '86400' } },
            })));
            envoyes = resp.successCount;
            const suppressions = [];
            resp.responses.forEach((r, i) => {
                const code = !r.success && r.error && r.error.code;
                if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
                    suppressions.push(db.ref('fcm_tokens_admin/' + cibles[i].cle).remove());
                }
            });
            await Promise.all(suppressions);
            retires = suppressions.length;
        }
        await nRef.update({ push_ts: Date.now(), push_envoyes: envoyes });
        return res.status(200).json({ ok: true, envoyes, cibles: cibles.length, retires });
    } catch (e) {
        console.error('[notifier]', e);
        return res.status(500).json({ error: 'erreur serveur' });
    }
};
