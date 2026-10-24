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
//  Actions (champ « action » du corps de la requête) :
//    « recherche »  (défaut) : résultats Google Images pour « q » ;
//    « enregistrer » : envoie l'image choisie sur Cloudinary, puis met à
//                      jour le produit et sa fiche gallery/{med_id} ;
//    « retirer »     : supprime l'image Cloudinary et la fiche gallery
//                      (et vide l'image du produit, sauf « sans_produit »).
//
//  Réservé à l'administration : jeton Firebase obligatoire, rôle « admin ».
//
//  Variables d'environnement (Vercel → Settings → Environment Variables) :
//    SERPER_API_KEY            clé de https://serper.dev (2 500 recherches offertes)
//    CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
//    FIREBASE_SERVICE_ACCOUNT  déjà configurée pour api/notifier.js
// ═══════════════════════════════════════════════════════════════════════

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const cloudinary = require('./_cloudinary.js');
const { identifierVillage } = require('./_village.js');

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';

function initFirebase() {
    if (getApps().length) return true;
    const brut = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!brut) return false;
    initializeApp({ credential: cert(JSON.parse(brut)), databaseURL: DATABASE_URL });
    return true;
}

const sansAccent = x => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

// Google Images (Serper) : résultats dans l'ordre de Google.
async function rechercheGoogle(q, num = 10) {
    const r = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, gl: 'sn', hl: 'fr', num }),
    });
    if (!r.ok) throw new Error('Google Images indisponible (HTTP ' + r.status + ')');
    const d = await r.json();
    return (d.images || []).map(x => ({
        title: x.title || '', image: x.imageUrl || '', thumb: x.thumbnailUrl || x.imageUrl || '',
        source: x.source || x.domain || '', page: x.link || '', width: x.imageWidth || 0, height: x.imageHeight || 0,
    })).filter(x => x.thumb);
}

// Image d'un médicament, dans cet ordre :
//   1. Firebase : fiche gallery/{id} déjà existante ;
//   2. Firebase : fiche gallery d'un produit de même nom et même forme
//      (même image Cloudinary réutilisée, sans nouvel envoi) ;
//   3. seulement ensuite Google Images (Serper) → Cloudinary → gallery.
async function imageAuto(db, villageId, medId, m, { q, cles = [] }, par) {
    const g = (await db.ref('gallery').once('value')).val() || {};
    const appliquer = async (fiche, origine) => {
        const up = { ...fiche.cloudinary, thumb: fiche.thumb, hd: fiche.hd, source_utilisee: fiche.origine_url || '' };
        await cloudinary.enregistrer(db, medId, m, up, { origine: fiche.origine || 'google', page: fiche.page, site: fiche.site, titre: fiche.titre, requete: fiche.requete, auto: true, par });
        return { ok: true, origine, thumb: fiche.thumb };
    };
    if (g[medId] && g[medId].thumb) return appliquer(g[medId], 'firebase');
    const memeProduit = Object.values(g).find(f => f && f.thumb && sansAccent(f.nom) === sansAccent(m.nom) && sansAccent(f.forme) === sansAccent(m.forme));
    if (memeProduit) return appliquer(memeProduit, 'firebase-doublon');

    if (!process.env.SERPER_API_KEY) return { ok: false, non_configure: true };
    const res = await rechercheGoogle(q, 10);
    if (!res.length) return { ok: false, aucun: true };
    // Ordre de Google ; premier résultat qui nomme la molécule, sinon le premier.
    const t = x => sansAccent(`${x.title} ${x.source} ${x.page}`);
    const choix = res.find(x => !/\.svg(\?|$)/i.test(x.image) && cles.some(k => k && k.length >= 4 && t(x).includes(k))) || res[0];
    const up = await cloudinary.televerserPremiere([choix.image, choix.thumb], `${villageId}/${medId}`);
    const fiche = await cloudinary.enregistrer(db, medId, m, up, { origine: 'google', page: choix.page, site: choix.source, titre: choix.title, requete: q, auto: true, par });
    return { ok: true, origine: 'google', thumb: fiche.thumb };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'image-medoc', configure: !!process.env.SERPER_API_KEY, cloudinary: !!cloudinary.config() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    try {
        if (!initFirebase()) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT manquant' });
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (!m) return res.status(401).json({ error: 'jeton manquant' });
        let user;
        try { user = await getAuth().verifyIdToken(m[1], true); }
        catch { return res.status(401).json({ error: 'jeton invalide' }); }
        const { db, villageId } = await identifierVillage(getDatabase(), user, ['admin']);

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const action = body.action || 'recherche';

        if (action === 'auto') {
            if (!cloudinary.config()) return res.status(503).json({ error: 'Cloudinary non configuré', non_configure: true });
            const medId = String(body.med_id || '');
            if (!/^[-_A-Za-z0-9]{6,40}$/.test(medId)) return res.status(400).json({ error: 'med_id invalide' });
            const prod = (await db.ref('db_pharmacie_stock/' + medId).once('value')).val();
            if (!prod) return res.status(404).json({ error: 'médicament introuvable' });
            if (prod.image_cloudinary_id) return res.status(200).json({ ok: true, origine: 'deja' });
            const q = String(body.q || prod.nom || '').replace(/\s+/g, ' ').trim().slice(0, 200);
            const cles = (Array.isArray(body.cles) ? body.cles : []).map(sansAccent).slice(0, 4);
            const r = await imageAuto(db, villageId, medId, prod, { q, cles }, user.email || '');
            if (r.non_configure) return res.status(503).json({ error: 'SERPER_API_KEY manquant', non_configure: true });
            if (r.aucun) {
                await db.ref('db_pharmacie_stock/' + medId).update({ image_recherche_ts: Date.now(), image_recherche_moteur: 'google' });
                return res.status(200).json({ ok: false, aucun: true });
            }
            return res.status(200).json(r);
        }

        if (action === 'enregistrer' || action === 'retirer') {
            if (!cloudinary.config()) return res.status(503).json({ error: 'Cloudinary non configuré', non_configure: true });
            const medId = String(body.med_id || '');
            if (!/^[-_A-Za-z0-9]{6,40}$/.test(medId)) return res.status(400).json({ error: 'med_id invalide' });
                        const m = (await db.ref('db_pharmacie_stock/' + medId).once('value')).val();
            if (action === 'retirer') {
                await cloudinary.supprimer(`${villageId}/${medId}`);
                await db.ref('gallery/' + medId).remove();
                if (m && !body.sans_produit) await db.ref('db_pharmacie_stock/' + medId).update({
                    image_url: null, image_hd: null, image_cloudinary_id: null, image_data: null, image_source: null, image_page: null,
                    image_site: null, image_titre: null, image_requete: null, image_auto: null, image_origine_url: null,
                    image_aucune: true, image_ts: Date.now(), image_par: user.email || '',
                });
                return res.status(200).json({ ok: true });
            }
            if (!m) return res.status(404).json({ error: 'médicament introuvable' });
            const sources = [body.data, body.image, body.thumb]
                .filter(x => typeof x === 'string' && (/^https?:\/\//.test(x) || /^data:image\/(jpeg|png|webp);base64,/.test(x)));
            if (!sources.length) return res.status(400).json({ error: 'aucune image' });
            let up;
            try { up = await cloudinary.televerserPremiere(sources, `${villageId}/${medId}`); }
            catch (e) { return res.status(502).json({ error: 'Envoi Cloudinary impossible : ' + e.message }); }
            const meta = body.meta || {};
            const fiche = await cloudinary.enregistrer(db, medId, m, up, {
                origine: body.data ? 'photo' : (meta.origine || 'google'), page: meta.page, site: meta.site, titre: meta.titre,
                requete: meta.requete, auto: !!meta.auto, par: user.email || '',
            });
            return res.status(200).json({ ok: true, thumb: fiche.thumb, hd: fiche.hd });
        }

        if (!process.env.SERPER_API_KEY) return res.status(503).json({ error: 'SERPER_API_KEY manquant', non_configure: true });
        const q = String(body.q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (q.length < 2) return res.status(400).json({ error: 'requête vide' });
        const num = Math.min(20, Math.max(1, parseInt(body.num, 10) || 10));

        let images;
        try { images = await rechercheGoogle(q, num); }
        catch (e) { return res.status(502).json({ error: e.message }); }
        return res.status(200).json({ ok: true, q, images });
    } catch (e) {
        console.error('[image-medoc]', e);
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'erreur serveur' });
    }
};
