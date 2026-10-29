'use strict';
const { readJsonBody, privateResponse } = require('./_http.js');
const { identifierVillage } = require('./_village.js');
const { executeBusiness } = require('./_business.js');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

module.exports = async (req,res) => {
  privateResponse(res);
  if (req.method !== 'POST') return res.status(405).json({error:'Méthode non autorisée.'});
  try {
    const body=readJsonBody(req,65536);
    const token=/^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!token) return res.status(401).json({error:'Authentification requise.'});
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(503).json({error:'Service temporairement indisponible.'});
      const creds=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (creds.project_id!=='poste-sante-280b2') throw Error('Projet Firebase incorrect');
      initializeApp({credential:cert(creds),databaseURL:process.env.FIREBASE_DATABASE_URL || 'https://poste-sante-280b2-default-rtdb.firebaseio.com'});
    }
    let user;
    try { user=await getAuth().verifyIdToken(token[1],true); }
    catch { return res.status(401).json({error:'Session invalide.'}); }
    const {db,role}=await identifierVillage(getDatabase(),user,['admin','caissier','tresorier']);
    const result=await executeBusiness(db,String(body.action || ''),body,user,role);
    return res.status(200).json(result);
  } catch(e) {
    if (!e.status) console.error('[business-operations]',e);
    return res.status(e.status || 500).json({error:e.status ? e.message : 'Opération non confirmée : réessayer la même commande.',not_committed:e.notCommitted===true});
  }
};
