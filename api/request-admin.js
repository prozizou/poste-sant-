'use strict';
// Demande publique d'accès administrateur depuis la page de connexion.
// L'utilisateur n'est pas authentifié : l'écriture passe par le SDK Admin
// (jamais un accès direct à la base), avec validation et garde anti-abus.
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com';
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const val = (s, max) => String(s || '').trim().slice(0, max);
const PHONE = /^\+?[0-9]{8,15}$/;
const PLAFOND_EN_ATTENTE = 300; // au-delà, on refuse pour éviter l'inondation

function firebase() {
    const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    if (!getApps().length) {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw fail(503, 'Configurer FIREBASE_SERVICE_ACCOUNT sur le serveur.');
        const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (creds.project_id !== 'poste-sante-280b2') throw fail(503, 'Projet Firebase incorrect.');
        initializeApp({ credential: cert(creds), databaseURL: DB_URL });
    }
    return { db: getDatabase(getApp()) };
}

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
        if (req.method !== 'POST') throw fail(405, 'Méthode non autorisée.');
        const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
        const prenom = val(b.prenom, 60);
        const nom = val(b.nom, 60);
        const village = val(b.village, 80);
        // Normalise le numéro : on ne garde que + et chiffres (format WhatsApp international).
        const whatsapp = val(b.whatsapp, 25).replace(/[\s().-]/g, '');
        if (prenom.length < 2 || nom.length < 2) throw fail(422, 'Prénom et nom obligatoires.');
        if (village.length < 2) throw fail(422, 'Indiquez le village ou la localité.');
        if (!PHONE.test(whatsapp)) throw fail(422, 'Numéro WhatsApp invalide (format international, ex : +221770000000).');

        const { db } = firebase();
        const ref = db.ref('admin_requests');
        const snap = await ref.once('value');
        const actuelles = snap.val() || {};
        const entrees = Object.entries(actuelles);
        if (entrees.length >= PLAFOND_EN_ATTENTE) throw fail(429, 'Trop de demandes en attente : réessayez plus tard ou appelez l’assistance.');

        // Même numéro déjà en attente : on met à jour au lieu de créer un doublon.
        const existante = entrees.find(([, r]) => r && r.whatsapp === whatsapp && r.status === 'nouveau');
        const donnee = { prenom, nom, village, whatsapp, status: 'nouveau', ts: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 160) };
        if (existante) await ref.child(existante[0]).update(donnee);
        else await ref.push(donnee);

        res.status(200).json({ ok: true });
    } catch (e) {
        const status = e.status || 500;
        if (status >= 500) console.error('request-admin', e);
        res.status(status).json({ ok: false, error: status >= 500 ? 'Service temporairement indisponible.' : e.message });
    }
};
