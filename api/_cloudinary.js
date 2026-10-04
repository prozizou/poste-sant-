// ═══════════════════════════════════════════════════════════════════════
//  api/_cloudinary.js — Envoi des images de médicaments vers Cloudinary
//  et fiche correspondante dans le nœud RTDB « gallery ».
//  (Le « _ » initial : Vercel n'en fait pas une route, c'est un module.)
//
//  Variables d'environnement : CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
//  CLOUDINARY_API_SECRET (le secret ne quitte jamais le serveur).
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const DOSSIER = 'poste-sante/medicaments';

function config() {
    const c = { cloud: process.env.CLOUDINARY_CLOUD_NAME, key: process.env.CLOUDINARY_API_KEY, secret: process.env.CLOUDINARY_API_SECRET };
    return c.cloud && c.key && c.secret ? c : null;
}

// Signature Cloudinary : paramètres triés « k=v&… » + secret, en SHA-1.
function signer(params, secret) {
    const chaine = Object.keys(params).sort().filter(k => params[k] !== undefined && params[k] !== '')
        .map(k => `${k}=${params[k]}`).join('&');
    return crypto.createHash('sha1').update(chaine + secret).digest('hex');
}

// URL de diffusion : vignette carrée (produit entier, fond blanc) et grand format.
function urls(cloud, publicId, version) {
    const base = `https://res.cloudinary.com/${cloud}/image/upload`;
    return {
        thumb: `${base}/c_pad,b_white,w_240,h_240,f_auto,q_auto/v${version}/${publicId}`,
        hd: `${base}/c_limit,w_800,h_800,f_auto,q_auto/v${version}/${publicId}`,
    };
}

// « file » : URL distante (Cloudinary va la chercher) ou data:image/… (photo).
async function televerser(file, medId, c = config()) {
    if (!c) throw new Error('Cloudinary non configuré');
    const params = { public_id: `${DOSSIER}/${medId}`, overwrite: 'true', invalidate: 'true', timestamp: Math.floor(Date.now() / 1000) };
    const body = new URLSearchParams({ ...params, file, api_key: c.key, signature: signer(params, c.secret) });
    const r = await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/image/upload`, { method: 'POST', body });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error((d.error && d.error.message) || ('HTTP ' + r.status));
    return { ...d, ...urls(c.cloud, d.public_id, d.version) };
}

async function supprimer(medId, c = config()) {
    if (!c) return;
    const params = { public_id: `${DOSSIER}/${medId}`, invalidate: 'true', timestamp: Math.floor(Date.now() / 1000) };
    const body = new URLSearchParams({ ...params, api_key: c.key, signature: signer(params, c.secret) });
    await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/image/destroy`, { method: 'POST', body }).catch(() => {});
}

// Essaie les sources dans l'ordre (image d'origine, puis miniature Google) :
// certains sites refusent qu'un tiers télécharge leurs images.
async function televerserPremiere(sources, medId, c = config()) {
    let derniere;
    for (const s of sources.filter(Boolean)) {
        try { return { ...(await televerser(s, medId, c)), source_utilisee: s.startsWith('data:') ? 'photo' : s }; }
        catch (e) { derniere = e; }
    }
    throw derniere || new Error('aucune source');
}

// Écrit l'image Cloudinary sur le produit et la fiche gallery/{medId}.
async function enregistrer(db, medId, m, up, meta = {}) {
    const fiche = {
        med_id: medId, nom: m.nom || '', forme: m.forme || '', dosage: m.dosage || '', categorie: m.categorie || '',
        cloudinary: { public_id: up.public_id, version: up.version, secure_url: up.secure_url, format: up.format || '', width: up.width || 0, height: up.height || 0, bytes: up.bytes || 0 },
        thumb: up.thumb, hd: up.hd,
        origine: meta.origine || '', origine_url: up.source_utilisee === 'photo' ? '' : (up.source_utilisee || ''),
        page: meta.page || '', site: meta.site || '', titre: meta.titre || '', requete: meta.requete || '',
        auto: !!meta.auto, par: meta.par || '', ts: Date.now(),
    };
    await db.ref('gallery/' + medId).set(fiche);
    await db.ref('db_pharmacie_stock/' + medId).update({
        image_url: up.thumb, image_hd: up.hd, image_cloudinary_id: up.public_id, image_data: null,
        image_source: meta.origine || 'google', image_page: meta.page || null, image_site: meta.site || null,
        image_titre: meta.titre || null, image_requete: meta.requete || null, image_auto: !!meta.auto,
        image_origine_url: fiche.origine_url || null, image_ts: Date.now(), image_par: meta.par || '',
        image_aucune: null, image_recherche_ts: null, image_recherche_moteur: null,
    });
    return fiche;
}

module.exports = { config, televerser, televerserPremiere, supprimer, enregistrer, DOSSIER };
