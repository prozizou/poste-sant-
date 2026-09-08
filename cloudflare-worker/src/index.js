// ═══════════════════════════════════════════════════════════════════════
//  cloudflare-worker/src/index.js
//  Poste de Santé de Diandioly — Relais de notifications push
//
//  Rôle : toutes les minutes (Cron Trigger), interroge le nœud RTDB
//  "notifications_caisse" pour les entrées écrites depuis le dernier
//  passage, puis envoie une notification push (Firebase Cloud Messaging)
//  à chaque appareil administrateur enregistré dans "fcm_tokens_admin".
//
//  Ce Worker remplace une Cloud Function Firebase (qui exigerait le
//  forfait payant "Blaze") : il utilise uniquement des API HTTP standard
//  (RTDB REST + FCM HTTP v1), gratuites sur le forfait Firebase "Spark".
//  Cloudflare Workers reste gratuit jusqu'à 100 000 requêtes/jour, très
//  largement suffisant ici (1 requête/minute ≈ 1 440/jour).
//
//  Authentification : un compte de service Google (voir README.md pour le
//  générer) signe lui-même un jeton d'accès OAuth2 — ce jeton contourne les
//  règles de sécurité RTDB (accès de type "administrateur"), exactement
//  comme le ferait le SDK Admin Firebase côté serveur.
// ═══════════════════════════════════════════════════════════════════════

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(traiterNotifications(env));
    },

    // Déclenchement manuel (tests) : GET /run?secret=<RUN_SECRET>
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/run') {
            if (!env.RUN_SECRET || url.searchParams.get('secret') !== env.RUN_SECRET) {
                return new Response('Non autorisé', { status: 401 });
            }
            try {
                const resultat = await traiterNotifications(env);
                return new Response(JSON.stringify(resultat, null, 2), { headers: { 'content-type': 'application/json' } });
            } catch (e) {
                return new Response('Erreur : ' + (e?.message || e), { status: 500 });
            }
        }
        return new Response('Poste de Santé de Diandioly — relais de notifications actif.', { status: 200 });
    },
};

async function traiterNotifications(env) {
    const dbUrl = `https://${env.FIREBASE_DB_HOST}`;
    const accessToken = await getAccessToken(env);

    const lastTs = parseInt((await env.NOTIF_STATE.get('last_ts')) || '0', 10);

    // Nouvelles notifications de caisse depuis le dernier passage.
    const notifResp = await fetch(
        `${dbUrl}/notifications_caisse.json?orderBy=%22ts%22&startAt=${lastTs + 1}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!notifResp.ok) throw new Error(`Lecture notifications_caisse échouée : ${notifResp.status} ${await notifResp.text()}`);
    const notifs = (await notifResp.json()) || {};
    const entries = Object.entries(notifs).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    if (!entries.length) return { traite: 0, envoyes: 0 };

    // Jetons des appareils administrateur enregistrés.
    const tokensResp = await fetch(`${dbUrl}/fcm_tokens_admin.json`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!tokensResp.ok) throw new Error(`Lecture fcm_tokens_admin échouée : ${tokensResp.status} ${await tokensResp.text()}`);
    const tokensObj = (await tokensResp.json()) || {};
    // clé RTDB = jeton assaini (voir notifications-admin.js) ; le champ
    // "token" porte le jeton FCM exact, c'est celui-ci qu'il faut utiliser
    // pour l'envoi — la clé ne sert qu'à identifier l'entrée à supprimer.
    const tokens = Object.entries(tokensObj)
        .map(([cle, meta]) => ({ cle, token: meta?.token || cle, meta }))
        .filter((t) => t.token);

    let envoyes = 0, maxTs = lastTs;
    const clesInvalides = new Set();

    for (const [nkey, n] of entries) {
        maxTs = Math.max(maxTs, n.ts || 0);
        const titre = n.type === 'med' ? '💊 Vente de médicaments encaissée' : '🎫 Ticket de consultation encaissé';
        const montantFmt = Number(n.montant || 0).toLocaleString('fr-FR') + ' FCFA';
        const corps = `${n.patient_nom || 'Patient'} · ${montantFmt}` + (n.detail ? `\n${n.detail}` : '');

        for (const { cle, token, meta } of tokens) {
            // Pas de self-notification si l'administrateur est aussi le/la caissier(ère) ayant encaissé.
            if (meta && meta.email && meta.email === n.caissier_email) continue;

            const statut = await envoyerFCM(env, accessToken, token, {
                title: titre, body: corps, type: n.type || '', key: n.ref_key || '', nkey, tag: 'caisse-' + nkey,
            });
            if (statut === 'invalide') clesInvalides.add(cle);
            else if (statut === true) envoyes++;
        }
    }

    // Nettoyage des jetons expirés/désinstallés (l'app ne se réabonne que si nécessaire).
    for (const cle of clesInvalides) {
        await fetch(`${dbUrl}/fcm_tokens_admin/${encodeURIComponent(cle)}.json`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
    }

    await env.NOTIF_STATE.put('last_ts', String(maxTs));
    return { traite: entries.length, envoyes, jetons_invalides_retires: clesInvalides.size };
}

// Envoie un message "data-only" (jamais de champ "notification" côté FCM) —
// c'est le Service Worker (sw.js → onBackgroundMessage) qui construit et
// affiche lui-même la notification avec ses boutons d'action.
async function envoyerFCM(env, accessToken, token, d) {
    const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: {
                token,
                data: { title: d.title, body: d.body, type: d.type, key: d.key, nkey: d.nkey, tag: d.tag },
                webpush: { headers: { Urgency: 'high' } },
            },
        }),
    });
    if (resp.ok) return true;
    const errText = await resp.text();
    if (resp.status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(errText)) return 'invalide';
    console.log('[FCM] échec envoi', resp.status, errText);
    return false;
}

// ── Jeton d'accès Google (compte de service), avec mise en cache KV ────
async function getAccessToken(env) {
    const cached = await env.NOTIF_STATE.get('access_token');
    const cachedExp = parseInt((await env.NOTIF_STATE.get('access_token_exp')) || '0', 10);
    if (cached && Date.now() < cachedExp) return cached;

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
        iss: env.FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
    const cryptoKey = await importPrivateKey(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));
    const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, cryptoKey, new TextEncoder().encode(unsigned));
    const jwt = `${unsigned}.${base64urlFromArrayBuffer(signature)}`;

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
    });
    const json = await resp.json();
    if (!json.access_token) throw new Error('Échec authentification Google : ' + JSON.stringify(json));

    await env.NOTIF_STATE.put('access_token', json.access_token);
    await env.NOTIF_STATE.put('access_token_exp', String(Date.now() + (json.expires_in - 60) * 1000));
    return json.access_token;
}

function base64url(input) {
    return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlFromArrayBuffer(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return base64url(binary);
}
function pemToArrayBuffer(pem) {
    const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
async function importPrivateKey(pem) {
    const der = pemToArrayBuffer(pem);
    return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
