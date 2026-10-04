// ═══════════════════════════════════════════════════════════════════════
//  api/image-medoc.js — Recherche Google Images pour les miniatures
//  Poste de Santé de Diandioly
//
//  La page Stock envoie la requête (« DEXCHLORPHENIRAMINE 2MG CP. en
//  comprimé ») ; cette fonction interroge Google Images via Serper.dev
//  (l'API officielle Google Custom Search est fermée aux nouveaux comptes
//  et s'arrête le 1er janvier 2027) et renvoie les résultats dans l'ordre
//  de Google. La clé reste ici, jamais dans le navigateur.
//
//  Réservé à l'administration : jeton Firebase obligatoire, rôle « admin ».
//
//  Variables d'environnement (Vercel → Settings → Environment Variables) :
//    SERPER_API_KEY            clé de https://serper.dev (2 500 recherches offertes)
//    FIREBASE_SERVICE_ACCOUNT  déjà configurée pour api/notifier.js
// ═══════════════════════════════════════════════════════════════════════

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';

function initFirebase() {
    if (getApps().length) return true;
    const brut = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!brut) return false;
    initializeApp({ credential: cert(JSON.parse(brut)), databaseURL: DATABASE_URL });
    return true;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'image-medoc', configure: !!process.env.SERPER_API_KEY });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    if (!process.env.SERPER_API_KEY) return res.status(503).json({ error: 'SERPER_API_KEY manquant', non_configure: true });
    try {
        if (!initFirebase()) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT manquant' });
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (!m) return res.status(401).json({ error: 'jeton manquant' });
        let user;
        try { user = await getAuth().verifyIdToken(m[1]); }
        catch { return res.status(401).json({ error: 'jeton invalide' }); }
        const role = (await getDatabase().ref(`db_users/${user.uid}/role`).once('value')).val();
        if (role !== 'admin') return res.status(403).json({ error: 'réservé à l\'administration' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const q = String(body.q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (q.length < 2) return res.status(400).json({ error: 'requête vide' });
        const num = Math.min(20, Math.max(1, parseInt(body.num, 10) || 10));

        const r = await fetch('https://google.serper.dev/images', {
            method: 'POST',
            headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q, gl: 'sn', hl: 'fr', num }),
        });
        if (!r.ok) return res.status(502).json({ error: 'Google Images indisponible', statut: r.status });
        const d = await r.json();
        const images = (d.images || []).map(x => ({
            title: x.title || '', image: x.imageUrl || '', thumb: x.thumbnailUrl || x.imageUrl || '',
            source: x.source || x.domain || '', page: x.link || '', width: x.imageWidth || 0, height: x.imageHeight || 0,
        })).filter(x => x.thumb);
        return res.status(200).json({ ok: true, q, images });
    } catch (e) {
        console.error('[image-medoc]', e);
        return res.status(500).json({ error: 'erreur serveur' });
    }
};
