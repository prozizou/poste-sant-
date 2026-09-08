// ═══════════════════════════════════════════════════════════════════════
//  firebase-config.js — Configuration Firebase
//  Poste de Santé de Diandioly
//  ✅ MIGRÉ : Firestore → Realtime Database (RTDB)
// ═══════════════════════════════════════════════════════════════════════
//
//  ⚠️  IMPORTANT – SÉCURITÉ :
//  Ces clés sont exposées côté client (comportement normal pour Firebase).
//  La sécurité réelle repose sur les RÈGLES RTDB & AUTHENTICATION.
//
//  ⚠️  ATTENTION : la règle ".read"/".write": "auth != null" ne suffit PAS.
//  Elle autorise N'IMPORTE QUEL utilisateur authentifié (donc un(e) caissier(ère))
//  à lire/écrire TOUTES les données, y compris le stock pharmacie, les rapports,
//  etc., même si l'interface (UI) le lui interdit. Le contrôle de rôle actuel
//  (sessionStorage côté navigateur) n'est qu'un confort d'affichage : il peut
//  être contourné en modifiant le sessionStorage ou en appelant l'API REST
//  Firebase directement.
//
//  RECOMMANDATION : stocker le rôle de chaque utilisateur côté serveur, dans
//  un nœud "db_users/{uid}/role" écrit UNIQUEMENT par un administrateur (ou
//  via des "custom claims" Firebase Auth), puis écrire des règles RTDB du
//  type ci-dessous. Ce jeu de règles reflète les nœuds RÉELLEMENT utilisés
//  par le code (facturation, stock, dépenses, compteur d'attente) et le
//  modèle de rôles déjà appliqué côté UI (admin / caissier / trésorier) :
//
//    {
//      "rules": {
//        ".read": false,
//        ".write": false,
//
//        "db_users": {
//          "$uid": {
//            ".read":  "auth != null && (auth.uid === $uid || root.child('db_users').child(auth.uid).child('role').val() === 'admin')",
//            ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin'",
//            ".validate": "newData.child('role').val() === 'admin' || newData.child('role').val() === 'caissier' || newData.child('role').val() === 'tresorier'"
//          }
//        },
//
//        "administration": {
//          "auth_db": {
//            ".indexOn": "email",
//            ".read":  "auth != null && query.orderByChild === 'email' && query.equalTo === auth.token.email",
//            ".write": false
//          }
//        },
//
//        "ticket_dbase":      { ".read": "auth != null", ".write": "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'caissier')" },
//        "vente_medicaments": { ".read": "auth != null", ".write": "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'caissier')" },
//        "db_pharmacie_stock":{ ".read": "auth != null", ".write": "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'caissier')" },
//        "compteurs":         { ".read": "auth != null", ".write": "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'caissier')" },
//
//        "db_pharmacie_reappro": { ".read": "auth != null", ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin'" },
//
//        "db_depenses": {
//          ".read":  "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'tresorier')",
//          ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'tresorier'"
//        },
//
//        "notifications_caisse": {
//          ".indexOn": "ts",
//          ".read":  "auth != null && root.child('db_users').child(auth.uid).child('role').val() === 'admin'",
//          ".write": "auth != null && (root.child('db_users').child(auth.uid).child('role').val() === 'admin' || root.child('db_users').child(auth.uid).child('role').val() === 'caissier')"
//        }
//      }
//    }
//
//  Étape préalable (manuelle, une fois par compte, pas d'écran dédié dans
//  l'app) : pour chaque utilisateur déjà créé, ajouter dans la Console
//  Firebase → Realtime Database le nœud "db_users/{UID}/role" avec la
//  valeur "admin", "caissier" ou "tresorier" — l'UID se trouve dans
//  Authentication > Users. Répéter à chaque nouveau compte créé.
//
//  Tout nœud non listé ci-dessus (db_patients, db_consultations,
//  db_suivi_vulnerables, db_agenda — pas encore utilisés par le code) reste
//  bloqué par le refus par défaut (".read"/".write": false) tant qu'il n'est
//  pas explicitement ouvert avec ses propres règles.
//
//  Règles Authentication recommandées :
//  - Activer uniquement Email/Password dans Firebase Console
//  - Activer la protection "App Check" pour les environnements de production
//  - Limiter les domaines autorisés dans Authentication > Settings
//
//  ⚠️  IMPORTANT – databaseURL :
//  Remplacez "poste-sante-280b2-default-rtdb" par votre ID RTDB réel.
//  Vous le trouvez dans Firebase Console > Realtime Database > URL de la base.
//  Format : https://<projet>-default-rtdb.firebaseio.com
//
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAnalytics }      from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { getDatabase }       from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { getAuth }           from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAN_XP-qqacK5P0HZZ-VWaqpEHHaCXvqOI",
    authDomain:        "poste-sante-280b2.firebaseapp.com",
    // ⚠️ Remplacez cette URL par celle de votre base RTDB (Firebase Console > Realtime Database)
    databaseURL:       "https://poste-sante-280b2-default-rtdb.firebaseio.com",
    projectId:         "poste-sante-280b2",
    storageBucket:     "poste-sante-280b2.firebasestorage.app",
    messagingSenderId: "204790038326",
    appId:             "1:204790038326:web:8a24c27204e296de577d97",
    measurementId:     "G-FVSGF6X7D1"
};

// Initialisation des services Firebase
const app = initializeApp(firebaseConfig);

// Google Analytics n'est utilisé nulle part ailleurs dans l'application —
// getAnalytics() peut lever une exception synchrone dans certains contextes
// (navigateur/webview qui bloque le stockage tiers, mode privé, connexion
// hors-ligne au démarrage…). Si elle n'était pas isolée dans son propre
// try/catch, une telle exception faisait échouer TOUT ce module : plus
// aucune page ne pouvait alors importer { auth, db }, cassant l'authentification
// et la connexion automatique sur l'ensemble de l'application — y compris la
// page de connexion elle-même, qui redemandait alors email + code à chaque
// ouverture puisque le script gérant la session ne s'exécutait jamais.
let analytics = null;
try { analytics = getAnalytics(app); } catch (e) { console.warn('[Firebase] Analytics indisponible (ignoré) :', e); }

const db   = getDatabase(app);        // ✅ Realtime Database
const auth = getAuth(app);            // Authentification

// Noeuds RTDB utilisés dans l'application
//   db_pharmacie_stock    → inventaire des médicaments
//   db_pharmacie_sorties  → journal des délivrances
//   db_pharmacie_reappro  → journal des réapprovisionnements
//   db_patients           → dossiers patients
//   db_consultations      → consultations médicales
//   db_suivi_vulnerables  → suivis CPN / Vaccination / Planning familial
//   db_agenda             → rendez-vous
//   notifications_caisse  → notifications temps réel vers l'administration à
//                           chaque encaissement de ticket/médicaments (voir
//                           notifications-admin.js et facturation/script.js)

export { app, db, auth, analytics };
