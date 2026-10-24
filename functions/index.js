// ═══════════════════════════════════════════════════════════════════════
//  functions/index.js — Cloud Function : relais de notifications push
//  Poste de Santé de Diandioly
//
//  Rôle : se déclenche automatiquement (quasi instantané, pas de polling)
//  à chaque nouvelle écriture dans "notifications_caisse" — c'est-à-dire
//  à chaque opération de caisse — encaissement, annulation ou modification
//  (voir facturation/script.js) — et envoie une notification push (Firebase
//  Cloud Messaging) à chaque appareil administrateur enregistré dans
//  "fcm_tokens_admin".
//
//  ⚠️ Nécessite le forfait Firebase "Blaze" (paiement à l'usage) : les
//  Cloud Functions ne se déploient pas sur le forfait gratuit "Spark".
//  Pour ce volume d'usage (un petit poste de santé), la facturation reste
//  quasi certainement à 0 F — largement dans le quota gratuit inclus dans
//  Blaze — mais Google exige une carte bancaire enregistrée sur le compte.
//  Voir README.md pour l'activer et déployer.
// ═══════════════════════════════════════════════════════════════════════

const { onValueCreated } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const INSTANCE = 'poste-sante-280b2-default-rtdb';

exports.notifierCaisseAdmin = onValueCreated(
    { ref: '/villages/{villageId}/notifications_caisse/{notifId}', instance: INSTANCE },
    async (event) => {
        const n = event.data.val();
        const notifId = event.params.notifId;
        const villageId = event.params.villageId;
        if (!n) return;

        const db = getDatabase();
        const tokensSnap = await db.ref('villages/' + villageId + '/fcm_tokens_admin').once('value');
        const tokensObj = tokensSnap.val() || {};

        // clé RTDB = jeton assaini (voir notifications-admin.js) ; le champ
        // "token" porte le jeton FCM exact à utiliser pour l'envoi.
        const possibles = Object.entries(tokensObj)
            .map(([cle, meta]) => ({ cle, token: (meta && meta.token) || cle, meta }))
            .filter(({ token, meta }) => token && meta?.uid && meta.email !== n.caissier_email);
        const autorises = await Promise.all(possibles.map(async c =>
            ((await db.ref('db_users/' + c.meta.uid).once('value')).val()?.role === 'admin' &&
              (await db.ref('db_users/' + c.meta.uid + '/active').once('value')).val() !== false &&
              (await db.ref('db_users/' + c.meta.uid + '/village_id').once('value')).val() === villageId)));
        const cibles = possibles.filter((_,i) => autorises[i]);
            // (pas de self-notification si l'admin est aussi le/la caissier(ère) ayant encaissé)

        if (!cibles.length) return;

        // Même rendu que notifications-admin.js (contenuNotification) :
        // encaissement, annulation ou modification, avec le nom du/de la
        // caissier(ère) ayant effectué l'opération.
        const caissier = (n.caissier_email || '').split('@')[0] || 'Caisse';
        const quoi = n.type === 'med' ? 'Vente de médicaments' : 'Ticket de consultation';
        let titre;
        if (n.action === 'annulation')        titre = `❌ ${quoi} annulé${n.type === 'med' ? 'e' : ''}`;
        else if (n.action === 'modification') titre = `✏️ ${quoi} modifié${n.type === 'med' ? 'e' : ''}`;
        else titre = n.type === 'med' ? '💊 Vente de médicaments encaissée' : '🎫 Ticket de consultation encaissé';
        const montantFmt = Number(n.montant || 0).toLocaleString('fr-FR') + ' FCFA';
        const corps = 'Nouvelle opération de caisse. Connectez-vous pour en consulter les détails.';

        // Messages "data-only" (jamais de champ "notification" côté FCM) :
        // c'est le Service Worker (sw.js → onBackgroundMessage) qui construit
        // et affiche lui-même la notification, avec ses boutons d'action.
        const messages = cibles.map(({ token }) => ({
            token,
            data: {
                title: titre, body: corps,
                type: n.type || '', action: n.action || 'encaissement',
                key: n.ref_key || '', nkey: notifId, tag: 'caisse-' + villageId + '-' + notifId,
            },
            webpush: { headers: { Urgency: 'high' } },
        }));

        const resp = await getMessaging().sendEach(messages);

        // Nettoyage des jetons expirés/désinstallés (l'app ne se réabonne que si nécessaire).
        const suppressions = [];
        resp.responses.forEach((r, i) => {
            if (r.success) return;
            const code = r.error && r.error.code;
            if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
                suppressions.push(db.ref('villages/' + villageId + '/fcm_tokens_admin/' + cibles[i].cle).remove());
            } else {
                console.warn('[notif] échec envoi FCM :', code, r.error && r.error.message);
            }
        });
        await Promise.all(suppressions);

        console.log(`[notif] ${notifId} : ${resp.successCount}/${messages.length} envoyé(s), ${suppressions.length} jeton(s) invalide(s) retiré(s).`);
    }
);
