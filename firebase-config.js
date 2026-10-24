// Firebase public config (API key is public; NEVER expose service-account secrets).
// MODE MULTI-VILLAGES : toute donnée métier doit se trouver sous
// /villages/{villageId}/..., et chaque utilisateur doit avoir un rôle +
// village_id dans /db_users/{uid}. Les règles RTDB bloquent les autres villages.
// Les nouveaux agents/villages sont créés côté serveur avec scripts/provision-village.js.
// ATTENTION : migrer les données ET les affectations avant la mise en ligne des règles.
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
//   fcm_tokens_admin      → jetons de notification push (application fermée)
//                           d'un(e) administrateur(rice), un par appareil ;
//                           lus uniquement par la Cloud Function (voir
//                           functions/) via le SDK Admin

export { app, db, auth, analytics };
